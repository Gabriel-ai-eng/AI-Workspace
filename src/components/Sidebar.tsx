// Barra lateral: conexões de IA, conta do GitHub, repositórios e conversas.

import { useEffect, useMemo, useState } from 'react'
import { PROVIDER_PRESETS, listModels, resolveModelId, type ModelInfo } from '../lib/providers'
import { useApp } from '../lib/store'
import type { AIConnection } from '../types'
import PasswordInput from './PasswordInput'

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <AISection />
      <GitHubSection />
      <VercelSection />
      <ReposSection />
      <ExecutionSection />
      <ConversationsSection />
    </aside>
  )
}

// Modelos fortes recomendados para tarefas de código, por provedor. São
// pistas de busca (não IDs exatos) — tocar preenche o campo e filtra as
// sugestões reais do catálogo carregado, então sempre resolve para um
// modelo que existe de verdade.
const CODE_MODEL_HINTS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-5', 'claude-opus-4-8'],
  openai: ['gpt-5.1'],
  gemini: ['gemini-2.5-pro'],
  grok: ['grok-4'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openrouter: ['claude-sonnet-5', 'gpt-5.1', 'deepseek', 'qwen3-coder'],
  mistral: ['codestral', 'mistral-large'],
  huggingface: ['Qwen2.5-Coder-32B', 'Llama-3.3-70B'],
}

// ------------------------------------------------------------ IA

function AISection() {
  const { connections, activeConnection, addConnection, removeConnection, setActiveConnection } =
    useApp()
  const [adding, setAdding] = useState(connections.length === 0)
  const [presetId, setPresetId] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [error, setError] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [priceFilter, setPriceFilter] = useState<'all' | 'free' | 'paid'>('all')

  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)!

  const freeCount = useMemo(() => models.filter((m) => m.free === true).length, [models])
  const paidCount = useMemo(() => models.filter((m) => m.free === false).length, [models])

  // Se o texto digitado casar com um modelo do catálogo, avisa quando ele é
  // grátis — modelos grátis costumam cometer mais erros em tarefas de código.
  const typedModelInfo = useMemo(() => {
    const t = model.trim().toLowerCase()
    if (!t) return null
    return models.find((m) => m.id.toLowerCase() === t) ?? null
  }, [model, models])

  const codeHints = CODE_MODEL_HINTS[presetId] ?? []

  // Sugestões renderizadas pelo próprio app (datalist nativo não aparece em
  // vários navegadores mobile). Com o filtro Grátis/Pagos ativo, lista mesmo
  // sem texto digitado, para dar visão de todos os modelos daquele tipo.
  const modelSuggestions = useMemo(() => {
    if (!models.length) return []
    const t = model.trim().toLowerCase()
    let list = models
    if (priceFilter === 'free') list = list.filter((m) => m.free === true)
    else if (priceFilter === 'paid') list = list.filter((m) => m.free === false)
    if (t) {
      if (priceFilter === 'all' && models.some((m) => m.id.toLowerCase() === t)) return []
      list = list.filter(
        (m) => m.id.toLowerCase().includes(t) || (m.name ?? '').toLowerCase().includes(t),
      )
    } else if (priceFilter === 'all') {
      return []
    }
    return list.slice(0, priceFilter === 'all' ? 8 : 100)
  }, [model, models, priceFilter])

  // Com a chave colada, busca o catálogo de modelos do provedor para o usuário
  // escolher pelo nome — evita erros de "model ID inválido".
  useEffect(() => {
    setModels([])
    setPriceFilter('all')
    const key = apiKey.trim()
    const base = presetId === 'custom' ? baseUrl.trim().replace(/\/$/, '') : preset.baseUrl
    if (!key || key.length < 8 || !base) return
    const timer = setTimeout(() => {
      setLoadingModels(true)
      listModels(preset.kind, base, key)
        .then(setModels)
        .catch(() => setModels([]))
        .finally(() => setLoadingModels(false))
    }, 500)
    return () => clearTimeout(timer)
  }, [apiKey, presetId, baseUrl, preset.kind, preset.baseUrl])

  async function save() {
    setError('')
    if (!apiKey.trim()) return setError('Cole a chave de API.')
    const finalBase = presetId === 'custom' ? baseUrl.trim().replace(/\/$/, '') : preset.baseUrl
    if (!finalBase) return setError('Informe a URL base da API.')
    const typed = model.trim() || preset.defaultModel
    if (!typed) return setError('Informe o modelo.')
    const finalModel = resolveModelId(typed, models)
    if (!finalModel) {
      return setError(
        `"${typed}" não existe no catálogo deste provedor. Comece a digitar no campo de modelo e escolha uma das sugestões.`,
      )
    }
    const conn: AIConnection = {
      id: crypto.randomUUID(),
      presetId,
      name: `${preset.name} · ${finalModel}`,
      kind: preset.kind,
      baseUrl: finalBase,
      model: finalModel,
    }
    await addConnection(conn, apiKey.trim())
    setApiKey('')
    setModel('')
    setBaseUrl('')
    setAdding(false)
  }

  return (
    <div className="section">
      <h3>Inteligência artificial</h3>
      <div className="stack">
        {connections.map((c) => (
          <div key={c.id} className={`repo-item ${activeConnection?.id === c.id ? 'selected' : ''}`}>
            <label onClick={() => setActiveConnection(c.id)}>
              <input
                type="radio"
                checked={activeConnection?.id === c.id}
                onChange={() => setActiveConnection(c.id)}
              />
              <span className="grow ellipsis">{c.name}</span>
              <button
                className="del btn ghost icon small"
                title="Remover conexão"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void removeConnection(c.id)
                }}
              >
                ✕
              </button>
            </label>
          </div>
        ))}

        {adding ? (
          <div className="card stack">
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {presetId === 'custom' && (
              <input
                type="text"
                placeholder="URL base (ex.: https://minha-api.com/v1)"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            )}
            <PasswordInput
              placeholder={`Chave de API (${preset.keyHint})`}
              value={apiKey}
              onChange={setApiKey}
              name="ai-api-key"
            />
            <input
              type="text"
              placeholder={preset.defaultModel ? `Modelo (padrão: ${preset.defaultModel})` : 'Modelo'}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            {codeHints.length > 0 && (
              <div className="row small" style={{ flexWrap: 'wrap' }}>
                <span className="dim">Fortes p/ código:</span>
                {codeHints.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    className="btn small ghost"
                    onClick={() => setModel(hint)}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            )}
            {typedModelInfo?.free === true && (
              <div className="small" style={{ color: 'var(--red)' }}>
                ⚠ Modelo grátis: costuma cometer mais erros em edições de código, especialmente com
                o modo automático ligado. Para resultados mais confiáveis, prefira um modelo pago.
              </div>
            )}
            {freeCount + paidCount > 0 && (
              <div className="row small">
                <button
                  type="button"
                  className={`btn small ${priceFilter === 'all' ? 'primary' : ''}`}
                  onClick={() => setPriceFilter('all')}
                >
                  Todos ({models.length})
                </button>
                <button
                  type="button"
                  className={`btn small ${priceFilter === 'free' ? 'approve' : ''}`}
                  onClick={() => setPriceFilter('free')}
                >
                  Grátis ({freeCount})
                </button>
                <button
                  type="button"
                  className={`btn small ${priceFilter === 'paid' ? 'primary' : ''}`}
                  onClick={() => setPriceFilter('paid')}
                >
                  Pagos ({paidCount})
                </button>
              </div>
            )}
            {modelSuggestions.length > 0 && (
              <div className="suggest-list">
                {modelSuggestions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="suggest-item"
                    onClick={() => setModel(m.id)}
                  >
                    <span className="row">
                      <span className="ellipsis grow">{m.name ?? m.id}</span>
                      {m.free === true && <span className="badge green">grátis</span>}
                      {m.free === false && <span className="badge dim">pago</span>}
                    </span>
                    <span className="small dim mono ellipsis">{m.id}</span>
                  </button>
                ))}
              </div>
            )}
            {loadingModels && <div className="small dim">Carregando modelos disponíveis…</div>}
            {!loadingModels && models.length > 0 && (
              <div className="small dim">
                {models.length} modelos disponíveis — digite parte do nome ou use os filtros
                Grátis/Pagos e toque na sugestão.
              </div>
            )}
            {error && <div className="error">{error}</div>}
            <div className="row">
              <button className="btn primary grow" onClick={() => void save()}>
                Salvar conexão
              </button>
              {connections.length > 0 && (
                <button className="btn ghost" onClick={() => setAdding(false)}>
                  Cancelar
                </button>
              )}
            </div>
            <div className="small dim">A chave é criptografada e fica só neste dispositivo.</div>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => setAdding(true)}>
            + Adicionar IA
          </button>
        )}
      </div>
    </div>
  )
}

// -------------------------------------------------------- GitHub

function GitHubSection() {
  const { githubUser, secrets, connectGitHub, disconnectGitHub } = useApp()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const connected = !!githubUser || !!secrets?.githubToken

  async function connect() {
    setError('')
    setBusy(true)
    try {
      await connectGitHub(token.trim())
      setToken('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section">
      <h3>GitHub</h3>
      {connected ? (
        <div className="card row">
          <span className="grow ellipsis">
            ✓ Conectado{githubUser ? ` como ${githubUser}` : ''}
          </span>
          <button className="btn ghost small" onClick={() => void disconnectGitHub()}>
            Desconectar
          </button>
        </div>
      ) : (
        <div className="card stack">
          <PasswordInput
            placeholder="Personal Access Token (ghp_… ou github_pat_…)"
            value={token}
            onChange={setToken}
            name="github-token"
          />
          {error && <div className="error">{error}</div>}
          <button className="btn primary" disabled={busy || !token.trim()} onClick={() => void connect()}>
            {busy ? 'Conectando…' : 'Conectar GitHub'}
          </button>
          <div className="small dim">
            Crie um token em{' '}
            <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
              github.com/settings/tokens
            </a>{' '}
            com as permissões que você quiser conceder (ex.: repo). Você controla o escopo.
          </div>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------- Vercel

function VercelSection() {
  const { vercelUser, secrets, connectVercel, disconnectVercel } = useApp()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const connected = !!vercelUser || !!secrets?.vercelToken

  async function connect() {
    setError('')
    setBusy(true)
    try {
      await connectVercel(token.trim())
      setToken('')
      setAdding(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="section">
      <h3>Vercel</h3>
      {connected ? (
        <div className="card row">
          <span className="grow ellipsis">✓ Conectado{vercelUser ? ` como ${vercelUser}` : ''}</span>
          <button className="btn ghost small" onClick={() => void disconnectVercel()}>
            Desconectar
          </button>
        </div>
      ) : adding ? (
        <div className="card stack">
          <PasswordInput
            placeholder="Token de API do Vercel"
            value={token}
            onChange={setToken}
            name="vercel-token"
          />
          {error && <div className="error">{error}</div>}
          <button
            className="btn primary"
            disabled={busy || !token.trim()}
            onClick={() => void connect()}
          >
            {busy ? 'Conectando…' : 'Conectar Vercel'}
          </button>
          <div className="small dim">
            Crie um token em{' '}
            <a href="https://vercel.com/account/settings/tokens" target="_blank" rel="noreferrer">
              vercel.com/account/settings/tokens
            </a>
            . Com ele, a IA consegue ver seus projetos e deploys (production/preview) e ler logs de
            build.
          </div>
        </div>
      ) : (
        <button className="btn ghost" onClick={() => setAdding(true)}>
          + Conectar Vercel (opcional)
        </button>
      )}
    </div>
  )
}

// -------------------------------------------------- repositórios

function ReposSection() {
  const { availableRepos, selectedRepos, toggleRepo, setRepoPermission, refreshRepos, githubUser } =
    useApp()
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const f = filter.toLowerCase()
    const list = f
      ? availableRepos.filter((r) => r.full_name.toLowerCase().includes(f))
      : availableRepos
    // Repositórios selecionados primeiro.
    return [...list].sort((a, b) => {
      const sa = selectedRepos.some((r) => r.fullName === a.full_name) ? 0 : 1
      const sb = selectedRepos.some((r) => r.fullName === b.full_name) ? 0 : 1
      return sa - sb
    })
  }, [availableRepos, filter, selectedRepos])

  if (!githubUser) return null

  return (
    <div className="section">
      <h3>
        Repositórios{' '}
        {selectedRepos.length > 0 && <span className="badge">{selectedRepos.length} na conversa</span>}
      </h3>
      <div className="stack">
        <div className="row">
          <input
            type="text"
            placeholder="Filtrar repositórios…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="btn icon" title="Atualizar lista" onClick={() => void refreshRepos()}>
            ⟳
          </button>
        </div>
        {filtered.slice(0, 30).map((repo) => {
          const selected = selectedRepos.find((r) => r.fullName === repo.full_name)
          return (
            <div key={repo.full_name} className={`repo-item ${selected ? 'selected' : ''}`}>
              <label>
                <input type="checkbox" checked={!!selected} onChange={() => toggleRepo(repo)} />
                <span className="grow ellipsis" title={repo.full_name}>
                  {repo.full_name}
                </span>
                {repo.private && <span className="badge dim">privado</span>}
              </label>
              {selected && (
                <div className="row small">
                  <span className="dim">Permissão da IA:</span>
                  <select
                    value={selected.permission}
                    onChange={(e) =>
                      setRepoPermission(repo.full_name, e.target.value as typeof selected.permission)
                    }
                  >
                    <option value="read">somente leitura</option>
                    <option value="write">leitura e escrita</option>
                    <option value="admin">total (branches/PRs)</option>
                  </select>
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="small dim">Nenhum repositório encontrado.</div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------ execução

function ExecutionSection() {
  const { autoApply, setAutoApply, githubUser } = useApp()
  if (!githubUser) return null
  return (
    <div className="section">
      <h3>Execução</h3>
      <div className="card stack">
        <label className="row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoApply}
            onChange={(e) => setAutoApply(e.target.checked)}
          />
          <span className="grow">Aplicar alterações automaticamente</span>
        </label>
        <div className="small dim">
          {autoApply
            ? 'A IA commita direto no repositório (ex.: na main), sem pedir aprovação. Tudo fica registrado nas abas Alterações e Histórico.'
            : 'Cada alteração fica aguardando sua aprovação na aba Alterações antes de ir ao GitHub.'}
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------- conversas

function ConversationsSection() {
  const { conversations, activeConversation, newConversation, selectConversation, deleteConversation } =
    useApp()
  return (
    <div className="section">
      <h3>Conversas</h3>
      <div className="stack">
        <button className="btn ghost" onClick={newConversation}>
          + Nova conversa
        </button>
        {conversations.slice(0, 20).map((c) => (
          <div
            key={c.id}
            className={`conv-item ${activeConversation?.id === c.id ? 'active' : ''}`}
            onClick={() => selectConversation(c.id)}
          >
            <span className="grow ellipsis">{c.title}</span>
            <button
              className="del"
              title="Apagar conversa"
              onClick={(e) => {
                e.stopPropagation()
                deleteConversation(c.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
