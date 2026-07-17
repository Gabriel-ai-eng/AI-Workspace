// Loop do agente: a IA recebe ferramentas de leitura (executadas na hora) e a
// ferramenta propose_changes, que apenas ENFILEIRA uma proposta. Nenhuma
// escrita chega ao GitHub sem o usuário aprovar explicitamente na interface.

import type { ChangeProposal, ChatMessage, FileChange, RepoRef, ToolCall } from '../types'
import { GitHubClient } from './github'
import { chat, type ChatRequest, type ToolDefinition } from './providers'

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
      'Propõe um conjunto atômico de alterações (criar/editar/apagar arquivos) como um commit. ' +
      'Opcionalmente cria uma branch nova e abre um Pull Request. NADA é executado imediatamente: ' +
      'a proposta fica pendente até o usuário aprovar na interface. Envie o conteúdo COMPLETO de cada arquivo.',
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
              content: { type: 'string', description: 'Conteúdo completo (omitir para delete)' },
            },
            required: ['path', 'action'],
          },
        },
      },
      required: ['repo', 'commit_message', 'files'],
    },
  },
]

export function buildSystemPrompt(repos: RepoRef[]): string {
  const repoList = repos
    .map((r) => `- ${r.fullName} (branch principal: ${r.defaultBranch}, permissão da IA: ${r.permission})`)
    .join('\n')
  return [
    'Você é o assistente de programação do AI Workspace. Você trabalha diretamente nos repositórios GitHub do usuário através de ferramentas.',
    '',
    'Repositórios que o usuário liberou para esta conversa:',
    repoList || '(nenhum repositório selecionado — avise o usuário para selecionar um na barra lateral)',
    '',
    'Regras:',
    '1. Antes de alterar qualquer coisa, explore o código com list_files, read_file e search_code para entender o contexto.',
    '2. Explique em linguagem clara o que pretende modificar e por quê, ANTES de chamar propose_changes.',
    '3. Toda alteração deve ser enviada via propose_changes com o conteúdo COMPLETO de cada arquivo alterado. O usuário verá o diff e decidirá aprovar ou rejeitar — nunca presuma que foi aprovado.',
    '4. Só proponha alterações em repositórios com permissão "write" ou "admin".',
    '5. Para mudanças grandes, prefira criar uma branch nova (new_branch) e abrir um PR (pr_title).',
    '6. Responda sempre no idioma do usuário.',
  ].join('\n')
}

export interface AgentCallbacks {
  /** Mensagens novas produzidas durante o turno (assistant/tool). */
  onMessage: (msg: ChatMessage) => void
  /** Nova proposta de alteração aguardando aprovação. */
  onProposal: (proposal: ChangeProposal) => void
  /** Status curto exibido enquanto o agente trabalha. */
  onStatus: (status: string) => void
}

export interface AgentContext {
  request: Omit<ChatRequest, 'messages' | 'system' | 'tools'>
  github: GitHubClient
  repos: RepoRef[]
  messages: ChatMessage[]
  callbacks: AgentCallbacks
  signal?: AbortSignal
}

/** Executa um turno completo do agente (pode envolver várias chamadas de ferramenta). */
export async function runAgentTurn(ctx: AgentContext): Promise<void> {
  const system = buildSystemPrompt(ctx.repos)
  const history: ChatMessage[] = [...ctx.messages]

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    ctx.callbacks.onStatus(i === 0 ? 'Pensando…' : 'Analisando resultados…')
    const result = await chat({
      ...ctx.request,
      system,
      messages: history,
      tools: AGENT_TOOLS,
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

  // Busca o conteúdo atual de cada arquivo para o usuário ver o diff real.
  const files: FileChange[] = []
  for (const f of rawFiles) {
    const path = String(f.path ?? '')
    const action = (f.action === 'delete' ? 'delete' : f.action === 'create' ? 'create' : 'update') as FileChange['action']
    if (!path) continue
    let previousContent: string | undefined
    if (action !== 'create') {
      previousContent = (await ctx.github.readFile(repo.fullName, path, baseBranch)) ?? undefined
    }
    files.push({
      path,
      action,
      content: action === 'delete' ? undefined : String(f.content ?? ''),
      previousContent,
    })
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
  ctx.callbacks.onProposal(proposal)

  return (
    `Proposta registrada e aguardando aprovação do usuário (${files.length} arquivo(s) em ${repo.fullName}, ` +
    `branch ${targetBranch}${proposal.pr ? ', com abertura de PR' : ''}). ` +
    'O usuário verá o diff e decidirá. Não presuma que foi aprovada.'
  )
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
