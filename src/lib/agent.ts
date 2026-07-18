// Loop do agente: a IA recebe ferramentas de leitura (executadas na hora) e a
// ferramenta propose_changes, que apenas ENFILEIRA uma proposta. Nenhuma
// escrita chega ao GitHub sem o usuário aprovar explicitamente na interface.

import type { ChangeProposal, ChatMessage, FileChange, HistoryEntry, RepoRef, ToolCall } from '../types'
import { GitHubClient } from './github'
import { chat, type ChatRequest, type ToolDefinition } from './providers'
import type { VercelClient, VercelDeploymentInfo } from './vercel'

const MAX_ITERATIONS = 24

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'list_files',
    description:
      'Lista todos os arquivos de um repositório (árvore completa). Use antes de ler ou editar.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repositório no formato dono/nome' },
        branch: { type: 'string', description: 'Branch (padrão: branch principal)' },
      },
      required: ['repo'],
    },
  },
  {
    name: 'read_file',
    description: 'Lê o conteúdo de um arquivo do repositório.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        path: { type: 'string', description: 'Caminho do arquivo' },
        branch: { type: 'string' },
      },
      required: ['repo', 'path'],
    },
  },
  {
    name: 'search_code',
    description: 'Pesquisa texto/código em todo o repositório e retorna os arquivos que contêm o termo.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        query: { type: 'string', description: 'Termo de busca' },
      },
      required: ['repo', 'query'],
    },
  },
  {
    name: 'list_branches',
    description: 'Lista as branches de um repositório.',
    parameters: {
      type: 'object',
      properties: { repo: { type: 'string' } },
      required: ['repo'],
    },
  },
  {
    name: 'propose_changes',
    description:
      'Envia um conjunto atômico de alterações (criar/editar/apagar arquivos) como um commit. ' +
      'Opcionalmente cria uma branch nova e abre um Pull Request. Dependendo do modo configurado ' +
      '(descrito no prompt do sistema), a alteração é aplicada imediatamente no GitHub ou fica ' +
      'pendente até o usuário aprovar. ' +
      'Para arquivos que JÁ EXISTEM, use "edits" (edição cirúrgica) em vez de reescrever o arquivo ' +
      'inteiro — é muito mais seguro e evita apagar partes do arquivo por engano. Leia o arquivo com ' +
      'read_file primeiro para copiar o texto exato.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        base_branch: { type: 'string', description: 'Branch de partida (padrão: principal)' },
        new_branch: {
          type: 'string',
          description: 'Se informado, cria esta branch a partir da base e commita nela',
        },
        commit_message: { type: 'string' },
        pr_title: { type: 'string', description: 'Se informado junto com new_branch, abre um PR' },
        pr_body: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              action: { type: 'string', enum: ['create', 'update', 'delete'] },
              edits: {
                type: 'array',
                description:
                  'PREFERIDO para action "update": lista de edições cirúrgicas aplicadas em ordem. ' +
                  'Cada uma substitui old_string por new_string no arquivo atual (buscado automaticamente ' +
                  'do GitHub). Não reescreve o resto do arquivo, então nada além do pedido é alterado.',
                items: {
                  type: 'object',
                  properties: {
                    old_string: {
                      type: 'string',
                      description:
                        'Texto exato a substituir — precisa casar caractere por caractere com o arquivo ' +
                        'atual (indentação e quebras de linha incluídas). Inclua algumas linhas de ' +
                        'contexto ao redor para garantir que o trecho seja único no arquivo.',
                    },
                    new_string: { type: 'string', description: 'Texto que substitui old_string.' },
                    replace_all: {
                      type: 'boolean',
                      description:
                        'Se true, substitui TODAS as ocorrências de old_string. Padrão false: exige que ' +
                        'old_string apareça exatamente uma vez (erro caso contrário, para evitar edição ambígua).',
                    },
                  },
                  required: ['old_string', 'new_string'],
                },
              },
              content: {
                type: 'string',
                description:
                  'Conteúdo completo do arquivo. Obrigatório para action "create". Para "update", use ' +
                  'SOMENTE se o arquivo inteiro precisa ser reescrito (raro) — prefira sempre "edits".',
              },
            },
            required: ['path', 'action'],
          },
        },
      },
      required: ['repo', 'commit_message', 'files'],
    },
  },
]

/** Ferramentas de consulta ao Vercel — disponíveis quando o usuário conecta o token. */
export const VERCEL_TOOLS: ToolDefinition[] = [
  {
    name: 'vercel_list_projects',
    description: 'Lista os projetos do Vercel do usuário (nome, id e time).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'vercel_list_deployments',
    description:
      'Lista os deploys mais recentes de um projeto do Vercel: estado (BUILDING/READY/ERROR), ' +
      'alvo (production ou preview), branch e commit de origem, URL e data. ' +
      'Use para saber se a última alteração já está em produção.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Nome ou id do projeto no Vercel' },
        limit: { type: 'number', description: 'Quantos deploys retornar (padrão 10, máx 25)' },
      },
      required: ['project'],
    },
  },
  {
    name: 'vercel_get_deployment',
    description:
      'Detalhes de um deploy específico do Vercel (estado, alvo, domínios/aliases, commit de origem).',
    parameters: {
      type: 'object',
      properties: {
        deployment: { type: 'string', description: 'ID (dpl_…) ou URL do deploy' },
      },
      required: ['deployment'],
    },
  },
  {
    name: 'vercel_get_build_logs',
    description: 'Últimas linhas do log de build de um deploy do Vercel — útil quando o build falha.',
    parameters: {
      type: 'object',
      properties: {
        deployment: { type: 'string', description: 'ID do deploy (dpl_…)' },
      },
      required: ['deployment'],
    },
  },
]

export function buildSystemPrompt(repos: RepoRef[], autoApply: boolean, hasVercel: boolean): string {
  const repoList = repos
    .map((r) => `- ${r.fullName} (branch principal: ${r.defaultBranch}, permissão da IA: ${r.permission})`)
    .join('\n')
  return [
    'Você é o assistente de programação do AI Workspace. Você trabalha diretamente nos repositórios GitHub do usuário através de ferramentas.',
    '',
    'Repositórios que o usuário liberou para esta conversa:',
    repoList || '(nenhum repositório selecionado — avise o usuário para selecionar um na barra lateral)',
    '',
    hasVercel
      ? 'O Vercel do usuário está conectado: use vercel_list_projects, vercel_list_deployments, vercel_get_deployment e vercel_get_build_logs para verificar se uma alteração já foi publicada (production) ou está em preview, e para diagnosticar builds que falharam.\n'
      : '',
    'Regras:',
    '1. Antes de alterar qualquer coisa, explore o código com list_files, read_file e search_code para entender o contexto.',
    '2. Explique em linguagem clara o que pretende modificar e por quê, ANTES de chamar propose_changes.',
    autoApply
      ? '3. O MODO AUTOMÁTICO está LIGADO: cada chamada de propose_changes é aplicada IMEDIATAMENTE no GitHub (commit direto na branch indicada, ex.: a principal), sem aprovação manual. Revise com cuidado antes de chamar a ferramenta — o resultado (URL do commit) virá na resposta da ferramenta.'
      : '3. Toda alteração deve ser enviada via propose_changes. O usuário verá o diff e decidirá aprovar ou rejeitar — nunca presuma que foi aprovado.',
    '3b. Para arquivos EXISTENTES, use SEMPRE "edits" (old_string → new_string) em vez de reescrever o arquivo inteiro em "content" — isso evita apagar partes do arquivo por acidente. Leia o arquivo com read_file antes, copie o trecho exato (indentação e quebras de linha inclusas) para old_string, e inclua contexto suficiente para o trecho ser único. Use "content" (arquivo inteiro) apenas para criar arquivos novos (action "create") ou nos raros casos em que o arquivo inteiro precisa mudar.',
    '4. Só proponha alterações em repositórios com permissão "write" ou "admin".',
    autoApply
      ? '5. Commite direto na branch principal, a menos que o usuário peça uma branch nova ou um PR.'
      : '5. Para mudanças grandes, prefira criar uma branch nova (new_branch) e abrir um PR (pr_title).',
    '6. Responda sempre no idioma do usuário.',
  ].join('\n')
}

export interface AgentCallbacks {
  /** Mensagens novas produzidas durante o turno (assistant/tool). */
  onMessage: (msg: ChatMessage) => void
  /** Nova proposta de alteração (pendente ou, no modo automático, já aplicada/falha). */
  onProposal: (proposal: ChangeProposal) => void
  /** Registro de histórico (usado no modo automático ao aplicar direto). */
  onHistory: (entry: HistoryEntry) => void
  /** Status curto exibido enquanto o agente trabalha. */
  onStatus: (status: string) => void
}

export interface AgentContext {
  request: Omit<ChatRequest, 'messages' | 'system' | 'tools'>
  github: GitHubClient
  repos: RepoRef[]
  messages: ChatMessage[]
  /** Se true, propose_changes aplica o commit imediatamente, sem aprovação. */
  autoApply: boolean
  /** Cliente do Vercel, quando o usuário conectou o token. */
  vercel?: VercelClient | null
  callbacks: AgentCallbacks
  signal?: AbortSignal
}

/** Executa um turno completo do agente (pode envolver várias chamadas de ferramenta). */
export async function runAgentTurn(ctx: AgentContext): Promise<void> {
  const system = buildSystemPrompt(ctx.repos, ctx.autoApply, !!ctx.vercel)
  const tools = ctx.vercel ? [...AGENT_TOOLS, ...VERCEL_TOOLS] : AGENT_TOOLS
  const history: ChatMessage[] = [...ctx.messages]

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    ctx.callbacks.onStatus(i === 0 ? 'Pensando…' : 'Analisando resultados…')
    const result = await chat({
      ...ctx.request,
      system,
      messages: history,
      tools,
      signal: ctx.signal,
    })

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
    }
    history.push(assistantMsg)
    ctx.callbacks.onMessage(assistantMsg)

    if (!result.toolCalls.length) return

    for (const call of result.toolCalls) {
      ctx.callbacks.onStatus(statusFor(call))
      let output: string
      try {
        output = await executeTool(ctx, call)
      } catch (e) {
        output = `Erro: ${e instanceof Error ? e.message : String(e)}`
      }
      const toolMsg: ChatMessage = {
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: output,
      }
      history.push(toolMsg)
      ctx.callbacks.onMessage(toolMsg)
    }
  }
  ctx.callbacks.onMessage({
    role: 'assistant',
    content: 'Limite de passos do turno atingido. Envie uma nova mensagem para continuar.',
  })
}

function statusFor(call: ToolCall): string {
  if (call.name.startsWith('vercel_')) return 'Consultando o Vercel…'
  const repo = typeof call.args.repo === 'string' ? call.args.repo : ''
  switch (call.name) {
    case 'list_files':
      return `Listando arquivos de ${repo}…`
    case 'read_file':
      return `Lendo ${call.args.path ?? ''}…`
    case 'search_code':
      return `Pesquisando em ${repo}…`
    case 'list_branches':
      return `Listando branches de ${repo}…`
    case 'propose_changes':
      return 'Preparando proposta de alterações…'
    default:
      return 'Executando ferramenta…'
  }
}

async function executeTool(ctx: AgentContext, call: ToolCall): Promise<string> {
  if (call.name.startsWith('vercel_')) return executeVercelTool(ctx, call)
  const args = call.args
  const repoName = String(args.repo ?? '')
  const repo = ctx.repos.find((r) => r.fullName === repoName)
  if (!repo) {
    return `Repositório "${repoName}" não está liberado nesta conversa. Repositórios disponíveis: ${ctx.repos.map((r) => r.fullName).join(', ') || 'nenhum'}.`
  }

  switch (call.name) {
    case 'list_files': {
      const branch = String(args.branch ?? repo.defaultBranch)
      const tree = await ctx.github.getTree(repoName, branch)
      const files = tree.filter((t) => t.type === 'blob').map((t) => t.path)
      const listed = files.slice(0, 600)
      const extra = files.length > listed.length ? `\n… e mais ${files.length - listed.length} arquivos` : ''
      return `${files.length} arquivos em ${repoName}@${branch}:\n${listed.join('\n')}${extra}`
    }
    case 'read_file': {
      const branch = String(args.branch ?? repo.defaultBranch)
      const content = await ctx.github.readFile(repoName, String(args.path), branch)
      if (content === null) return `Arquivo não encontrado: ${args.path} em ${repoName}@${branch}`
      return truncate(content, 60_000)
    }
    case 'search_code': {
      const items = await ctx.github.searchCode(repoName, String(args.query))
      if (!items.length) return 'Nenhum resultado.'
      return items.map((i) => i.path).join('\n')
    }
    case 'list_branches': {
      const branches = await ctx.github.listBranches(repoName)
      return branches.join('\n')
    }
    case 'propose_changes':
      return proposeChanges(ctx, repo, args)
    default:
      return `Ferramenta desconhecida: ${call.name}`
  }
}

async function executeVercelTool(ctx: AgentContext, call: ToolCall): Promise<string> {
  const vercel = ctx.vercel
  if (!vercel) {
    return 'O Vercel não está conectado. Peça ao usuário para conectar o token na barra lateral.'
  }
  const args = call.args
  switch (call.name) {
    case 'vercel_list_projects': {
      const projects = await vercel.listProjects()
      if (!projects.length) return 'Nenhum projeto encontrado no Vercel.'
      return projects
        .map((p) => `${p.name} (id: ${p.id}${p.teamName ? `, time: ${p.teamName}` : ''})`)
        .join('\n')
    }
    case 'vercel_list_deployments': {
      const project = await vercel.findProject(String(args.project ?? ''))
      if (!project) {
        return `Projeto "${args.project}" não encontrado no Vercel. Use vercel_list_projects para ver os disponíveis.`
      }
      const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 25)
      const deps = await vercel.listDeployments(project.id, project.teamId, limit)
      if (!deps.length) return `Nenhum deploy encontrado no projeto ${project.name}.`
      return `Deploys de ${project.name} (mais recente primeiro):\n${deps.map(formatDeployment).join('\n')}`
    }
    case 'vercel_get_deployment': {
      const d = await vercel.getDeployment(String(args.deployment ?? ''))
      const meta = (d.meta ?? {}) as Record<string, string>
      const aliases = Array.isArray(d.alias) ? (d.alias as string[]).join(', ') : ''
      return [
        `id: ${String(d.id ?? d.uid ?? '')}`,
        `estado: ${String(d.readyState ?? d.state ?? '?')}`,
        `alvo: ${d.target === 'production' ? 'production' : 'preview'}`,
        `url: https://${String(d.url ?? '')}`,
        aliases ? `domínios: ${aliases}` : '',
        meta.githubCommitRef ? `branch: ${meta.githubCommitRef} @ ${(meta.githubCommitSha ?? '').slice(0, 7)}` : '',
        meta.githubCommitMessage ? `commit: ${meta.githubCommitMessage.split('\n')[0]}` : '',
        d.createdAt ? `criado em: ${new Date(Number(d.createdAt)).toISOString()}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    }
    case 'vercel_get_build_logs': {
      const logs = await vercel.getBuildLogs(String(args.deployment ?? ''))
      return logs.length > 20_000 ? `…${logs.slice(-20_000)}` : logs
    }
    default:
      return `Ferramenta desconhecida: ${call.name}`
  }
}

function formatDeployment(d: VercelDeploymentInfo): string {
  const when = d.createdAt ? new Date(d.createdAt).toISOString() : '?'
  const origin = d.ref ? ` — branch ${d.ref} @ ${(d.sha ?? '').slice(0, 7)}` : ''
  const msg = d.message ? ` — "${d.message.split('\n')[0]}"` : ''
  return `[${d.target}] ${d.state}${origin}${msg} — https://${d.url} — ${when} — id ${d.id}`
}

async function proposeChanges(
  ctx: AgentContext,
  repo: RepoRef,
  args: Record<string, unknown>,
): Promise<string> {
  if (repo.permission === 'read') {
    return `O usuário concedeu apenas permissão de LEITURA em ${repo.fullName}. Não é possível propor alterações aqui.`
  }
  const rawFiles = Array.isArray(args.files) ? (args.files as Record<string, unknown>[]) : []
  if (!rawFiles.length) return 'Nenhum arquivo informado em "files".'

  const baseBranch = String(args.base_branch ?? repo.defaultBranch)
  const newBranch = args.new_branch ? String(args.new_branch) : ''
  const targetBranch = newBranch || baseBranch

  // Busca o conteúdo atual de cada arquivo para o usuário ver o diff real e
  // para aplicar as edições cirúrgicas (quando informadas) em cima dele.
  const files: FileChange[] = []
  for (const f of rawFiles) {
    const path = String(f.path ?? '')
    const action = (f.action === 'delete' ? 'delete' : f.action === 'create' ? 'create' : 'update') as FileChange['action']
    if (!path) continue

    let previousContent: string | undefined
    if (action !== 'create') {
      previousContent = (await ctx.github.readFile(repo.fullName, path, baseBranch)) ?? undefined
    }

    let content: string | undefined
    if (action === 'delete') {
      content = undefined
    } else if (Array.isArray(f.edits) && f.edits.length) {
      if (previousContent === undefined) {
        return `Arquivo "${path}" não encontrado em ${repo.fullName}@${baseBranch} — não é possível aplicar "edits". Use action "create" com "content" para criar um arquivo novo.`
      }
      const result = applyEdits(previousContent, f.edits as Record<string, unknown>[])
      if ('error' in result) {
        return `Falha ao editar "${path}": ${result.error} Nenhuma alteração foi enviada — corrija e chame propose_changes de novo.`
      }
      content = result.content
    } else if (typeof f.content === 'string') {
      content = f.content
    } else if (action === 'create') {
      return `Arquivo "${path}": informe "content" com o conteúdo completo para criá-lo (action "create").`
    } else {
      return `Arquivo "${path}": informe "edits" (preferível) ou "content" completo para atualizá-lo.`
    }

    files.push({ path, action, content, previousContent })
  }

  const proposal: ChangeProposal = {
    id: crypto.randomUUID(),
    repo: repo.fullName,
    baseBranch,
    targetBranch,
    commitMessage: String(args.commit_message ?? 'Alterações propostas pela IA'),
    files,
    pr:
      newBranch && args.pr_title
        ? { title: String(args.pr_title), body: String(args.pr_body ?? '') }
        : undefined,
    status: 'pending',
    createdAt: Date.now(),
  }

  // Modo automático: aplica o commit imediatamente, sem aprovação manual.
  if (ctx.autoApply) {
    ctx.callbacks.onStatus(`Aplicando alterações em ${repo.fullName}@${targetBranch}…`)
    try {
      const result = await applyProposal(ctx.github, proposal)
      const url = result.prUrl ?? result.commitUrl
      proposal.status = 'applied'
      proposal.resultUrl = url
      ctx.callbacks.onProposal(proposal)
      ctx.callbacks.onHistory({
        id: crypto.randomUUID(),
        at: Date.now(),
        repo: repo.fullName,
        summary: proposal.commitMessage,
        kind: result.prUrl ? 'pr' : 'commit',
        url,
      })
      return (
        `Alterações APLICADAS no GitHub (modo automático): ${files.length} arquivo(s) commitados em ` +
        `${repo.fullName}@${targetBranch}.${result.prUrl ? ` PR aberto: ${result.prUrl}.` : ''} URL: ${url}`
      )
    } catch (e) {
      proposal.status = 'failed'
      proposal.error = e instanceof Error ? e.message : String(e)
      ctx.callbacks.onProposal(proposal)
      return `Falha ao aplicar as alterações: ${proposal.error}`
    }
  }

  ctx.callbacks.onProposal(proposal)

  return (
    `Proposta registrada e aguardando aprovação do usuário (${files.length} arquivo(s) em ${repo.fullName}, ` +
    `branch ${targetBranch}${proposal.pr ? ', com abertura de PR' : ''}). ` +
    'O usuário verá o diff e decidirá. Não presuma que foi aprovada.'
  )
}

/**
 * Aplica uma lista de edições old_string → new_string em sequência, cada uma
 * exigindo casamento exato (mesma regra do buscar-e-substituir do editor: sem
 * regex). Evita que o modelo precise reproduzir o arquivo inteiro para mudar
 * um trecho pequeno — a causa mais comum de arquivos corrompidos.
 */
function applyEdits(
  original: string,
  edits: Record<string, unknown>[],
): { content: string } | { error: string } {
  let content = original
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]
    const oldStr = String(e.old_string ?? '')
    const newStr = String(e.new_string ?? '')
    const replaceAll = e.replace_all === true
    const n = i + 1
    if (!oldStr) return { error: `edição ${n}: "old_string" está vazio.` }
    if (oldStr === newStr) return { error: `edição ${n}: "old_string" e "new_string" são idênticos.` }
    const count = countOccurrences(content, oldStr)
    if (count === 0) {
      return {
        error: `edição ${n}: "old_string" não foi encontrado no arquivo. Confira espaços, indentação e quebras de linha exatos (use read_file para copiar o texto atual).`,
      }
    }
    if (count > 1 && !replaceAll) {
      return {
        error: `edição ${n}: "old_string" aparece ${count} vezes no arquivo. Inclua mais linhas de contexto para torná-lo único, ou use replace_all=true se a intenção é mesmo substituir todas.`,
      }
    }
    content = replaceAll ? content.split(oldStr).join(newStr) : replaceFirstOccurrence(content, oldStr, newStr)
  }
  return { content }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) return count
    count++
    from = idx + needle.length
  }
}

function replaceFirstOccurrence(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle)
  return idx === -1 ? haystack : haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length)
}

/** Aplica uma proposta aprovada: cria branch se preciso, commita e abre PR. */
export async function applyProposal(
  github: GitHubClient,
  proposal: ChangeProposal,
): Promise<{ commitUrl: string; prUrl?: string }> {
  if (proposal.targetBranch !== proposal.baseBranch) {
    const baseSha = await github.getBranchSha(proposal.repo, proposal.baseBranch)
    const existing = await github.listBranches(proposal.repo)
    if (!existing.includes(proposal.targetBranch)) {
      await github.createBranch(proposal.repo, proposal.targetBranch, baseSha)
    }
  }

  const commit = await github.commitFiles(
    proposal.repo,
    proposal.targetBranch,
    proposal.commitMessage,
    proposal.files.map((f) => ({
      path: f.path,
      content: f.content,
      delete: f.action === 'delete',
    })),
  )

  let prUrl: string | undefined
  if (proposal.pr) {
    const pr = await github.createPull(
      proposal.repo,
      proposal.pr.title,
      proposal.pr.body,
      proposal.targetBranch,
      proposal.baseBranch,
    )
    prUrl = pr.html_url
  }
  return { commitUrl: commit.url, prUrl }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n… (arquivo truncado, ${s.length} caracteres no total)`
}
