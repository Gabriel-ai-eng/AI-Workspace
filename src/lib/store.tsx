// Estado global do aplicativo. Dados não sensíveis são persistidos em
// localStorage; segredos (chaves de API, token do GitHub) vivem apenas no
// cofre criptografado (crypto.ts) e, quando destravados, em memória.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AIConnection,
  ChangeProposal,
  ChatMessage,
  Conversation,
  HistoryEntry,
  RepoRef,
  SavedKey,
} from '../types'
import {
  clearSession,
  deleteVault,
  loadSession,
  openVault,
  saveSession,
  saveVault,
  sessionExists,
  vaultExists,
  type VaultSecrets,
} from './crypto'
import { GitHubClient, type GhRepo } from './github'
import { VercelClient } from './vercel'

const STATE_KEY = 'aiw.state.v1'

interface PersistedState {
  theme: 'dark' | 'light'
  connections: AIConnection[]
  activeConnectionId: string | null
  /** Se true, propostas da IA são aplicadas no GitHub imediatamente, sem aprovação manual. */
  autoApply: boolean
  selectedRepos: RepoRef[]
  conversations: Conversation[]
  activeConversationId: string | null
  proposals: ChangeProposal[]
  history: HistoryEntry[]
  savedKeys: SavedKey[]
}

const DEFAULT_STATE: PersistedState = {
  theme: 'dark',
  connections: [],
  activeConnectionId: null,
  autoApply: true,
  selectedRepos: [],
  conversations: [],
  activeConversationId: null,
  proposals: [],
  history: [],
  savedKeys: [],
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return DEFAULT_STATE
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<PersistedState>) }
  } catch {
    return DEFAULT_STATE
  }
}

export type VaultStatus = 'new' | 'restoring' | 'locked' | 'unlocked'

export interface AppStore {
  // tema
  theme: 'dark' | 'light'
  toggleTheme: () => void

  // cofre
  vaultStatus: VaultStatus
  unlockVault: (passphrase: string) => Promise<boolean>
  createVault: (passphrase: string) => Promise<void>
  resetVault: () => void
  /** Encerra a sessão salva e volta para a tela de login (o cofre continua existindo). */
  signOut: () => void
  secrets: VaultSecrets | null

  // conexões de IA
  connections: AIConnection[]
  activeConnection: AIConnection | null
  addConnection: (conn: AIConnection, apiKey: string) => Promise<void>
  removeConnection: (id: string) => Promise<void>
  setActiveConnection: (id: string) => void

  // GitHub
  github: GitHubClient | null
  githubUser: string | null
  connectGitHub: (token: string) => Promise<void>
  disconnectGitHub: () => Promise<void>
  availableRepos: GhRepo[]
  refreshRepos: () => Promise<void>
  selectedRepos: RepoRef[]
  toggleRepo: (repo: GhRepo) => void
  setRepoPermission: (fullName: string, permission: RepoRef['permission']) => void

  // modo de execução
  autoApply: boolean
  setAutoApply: (v: boolean) => void

  // Vercel
  vercel: VercelClient | null
  vercelUser: string | null
  connectVercel: (token: string) => Promise<void>
  disconnectVercel: () => Promise<void>

  // conversas
  conversations: Conversation[]
  activeConversation: Conversation | null
  newConversation: () => string
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  appendMessage: (conversationId: string, msg: ChatMessage) => void

  // propostas e histórico
  proposals: ChangeProposal[]
  addProposal: (p: ChangeProposal) => void
  updateProposal: (id: string, patch: Partial<ChangeProposal>) => void
  history: HistoryEntry[]
  addHistory: (h: HistoryEntry) => void

  // chaves de API salvas para uso futuro (guardadas no cofre, sem conectar a nada)
  savedKeys: SavedKey[]
  addSavedKey: (label: string, value: string) => Promise<void>
  removeSavedKey: (id: string) => Promise<void>
  revealSavedKey: (id: string) => string | null
}

const AppContext = createContext<AppStore | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState)
  const [secrets, setSecrets] = useState<VaultSecrets | null>(null)
  const [passphrase, setPassphrase] = useState<string>('')
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>(() =>
    vaultExists() ? (sessionExists() ? 'restoring' : 'locked') : 'new',
  )
  const [githubUser, setGithubUser] = useState<string | null>(null)
  const [availableRepos, setAvailableRepos] = useState<GhRepo[]>([])
  const [vercelUser, setVercelUser] = useState<string | null>(null)

  // Login persistente: se há uma sessão salva, destrava o cofre sozinho.
  const restoreRef = useRef(false)
  useEffect(() => {
    if (vaultStatus !== 'restoring' || restoreRef.current) return
    restoreRef.current = true
    void (async () => {
      const pass = await loadSession()
      const opened = pass ? await openVault(pass) : null
      if (pass && opened) {
        setPassphrase(pass)
        setSecrets(opened)
        setVaultStatus('unlocked')
      } else {
        // Sessão inválida (ex.: senha do cofre mudou) — pede login normal.
        clearSession()
        setVaultStatus('locked')
      }
    })()
  }, [vaultStatus])

  // Persiste estado não sensível a cada mudança.
  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state))
    } catch {
      // Cota do localStorage excedida (anexos grandes): persiste sem os dados
      // binários dos anexos para não perder o restante do estado.
      try {
        const slim: PersistedState = {
          ...state,
          conversations: state.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.role === 'user' && m.attachments?.length
                ? { ...m, attachments: m.attachments.map((a) => ({ ...a, dataUrl: '' })) }
                : m,
            ),
          })),
        }
        localStorage.setItem(STATE_KEY, JSON.stringify(slim))
      } catch {
        // Sem espaço mesmo assim — o estado segue apenas em memória.
      }
    }
  }, [state])

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme
  }, [state.theme])

  const github = useMemo(
    () => (secrets?.githubToken ? new GitHubClient(secrets.githubToken) : null),
    [secrets?.githubToken],
  )

  const vercel = useMemo(
    () => (secrets?.vercelToken ? new VercelClient(secrets.vercelToken) : null),
    [secrets?.vercelToken],
  )

  // Valida o token do Vercel salvo e carrega o nome da conta.
  useEffect(() => {
    if (!vercel) {
      setVercelUser(null)
      return
    }
    vercel
      .getUser()
      .then((u) => setVercelUser(u.username))
      .catch(() => setVercelUser(null))
  }, [vercel])

  // Ao destravar com token salvo, valida e carrega repositórios.
  const bootedRef = useRef(false)
  useEffect(() => {
    if (!github || bootedRef.current) return
    bootedRef.current = true
    github
      .getUser()
      .then((u) => setGithubUser(u.login))
      .catch(() => setGithubUser(null))
    github
      .listRepos()
      .then(setAvailableRepos)
      .catch(() => setAvailableRepos([]))
  }, [github])

  const persistSecrets = useCallback(
    async (next: VaultSecrets, pass?: string) => {
      const p = pass ?? passphrase
      await saveVault(p, next)
      setSecrets(next)
    },
    [passphrase],
  )

  const store: AppStore = {
    theme: state.theme,
    toggleTheme: () =>
      setState((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' })),

    vaultStatus,
    secrets,
    createVault: async (pass) => {
      await saveVault(pass, { apiKeys: {} })
      await saveSession(pass)
      setPassphrase(pass)
      setSecrets({ apiKeys: {} })
      setVaultStatus('unlocked')
    },
    unlockVault: async (pass) => {
      const opened = await openVault(pass)
      if (!opened) return false
      await saveSession(pass)
      setPassphrase(pass)
      setSecrets(opened)
      setVaultStatus('unlocked')
      return true
    },
    signOut: () => {
      clearSession()
      setSecrets(null)
      setPassphrase('')
      setVaultStatus('locked')
      setGithubUser(null)
      setAvailableRepos([])
      bootedRef.current = false
      restoreRef.current = false
    },
    resetVault: () => {
      deleteVault()
      clearSession()
      localStorage.removeItem(STATE_KEY)
      setSecrets(null)
      setPassphrase('')
      setState(DEFAULT_STATE)
      setVaultStatus('new')
      setGithubUser(null)
      setAvailableRepos([])
      bootedRef.current = false
    },

    connections: state.connections,
    activeConnection:
      state.connections.find((c) => c.id === state.activeConnectionId) ??
      state.connections[0] ??
      null,
    addConnection: async (conn, apiKey) => {
      if (!secrets) return
      await persistSecrets({ ...secrets, apiKeys: { ...secrets.apiKeys, [conn.id]: apiKey } })
      setState((s) => ({
        ...s,
        connections: [...s.connections, conn],
        activeConnectionId: s.activeConnectionId ?? conn.id,
      }))
    },
    removeConnection: async (id) => {
      if (secrets) {
        const apiKeys = { ...secrets.apiKeys }
        delete apiKeys[id]
        await persistSecrets({ ...secrets, apiKeys })
      }
      setState((s) => ({
        ...s,
        connections: s.connections.filter((c) => c.id !== id),
        activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
      }))
    },
    setActiveConnection: (id) => setState((s) => ({ ...s, activeConnectionId: id })),

    github,
    githubUser,
    connectGitHub: async (token) => {
      if (!secrets) return
      const client = new GitHubClient(token)
      const user = await client.getUser() // valida o token antes de salvar
      await persistSecrets({ ...secrets, githubToken: token })
      setGithubUser(user.login)
      setAvailableRepos(await client.listRepos())
    },
    disconnectGitHub: async () => {
      if (secrets) await persistSecrets({ ...secrets, githubToken: undefined })
      setGithubUser(null)
      setAvailableRepos([])
      setState((s) => ({ ...s, selectedRepos: [] }))
      bootedRef.current = false
    },
    availableRepos,
    refreshRepos: async () => {
      if (github) setAvailableRepos(await github.listRepos())
    },
    selectedRepos: state.selectedRepos,
    toggleRepo: (repo) =>
      setState((s) => {
        const exists = s.selectedRepos.some((r) => r.fullName === repo.full_name)
        return {
          ...s,
          selectedRepos: exists
            ? s.selectedRepos.filter((r) => r.fullName !== repo.full_name)
            : [
                ...s.selectedRepos,
                {
                  fullName: repo.full_name,
                  defaultBranch: repo.default_branch,
                  permission: 'write',
                  private: repo.private,
                },
              ],
        }
      }),
    autoApply: state.autoApply,
    setAutoApply: (v) => setState((s) => ({ ...s, autoApply: v })),

    vercel,
    vercelUser,
    connectVercel: async (token) => {
      if (!secrets) return
      const client = new VercelClient(token)
      const user = await client.getUser() // valida o token antes de salvar
      await persistSecrets({ ...secrets, vercelToken: token })
      setVercelUser(user.username)
    },
    disconnectVercel: async () => {
      if (secrets) await persistSecrets({ ...secrets, vercelToken: undefined })
      setVercelUser(null)
    },

    setRepoPermission: (fullName, permission) =>
      setState((s) => ({
        ...s,
        selectedRepos: s.selectedRepos.map((r) =>
          r.fullName === fullName ? { ...r, permission } : r,
        ),
      })),

    conversations: state.conversations,
    activeConversation:
      state.conversations.find((c) => c.id === state.activeConversationId) ?? null,
    newConversation: () => {
      const conv: Conversation = {
        id: crypto.randomUUID(),
        title: 'Nova conversa',
        connectionId: state.activeConnectionId,
        messages: [],
        createdAt: Date.now(),
      }
      setState((s) => ({
        ...s,
        conversations: [conv, ...s.conversations],
        activeConversationId: conv.id,
      }))
      return conv.id
    },
    selectConversation: (id) => setState((s) => ({ ...s, activeConversationId: id })),
    deleteConversation: (id) =>
      setState((s) => ({
        ...s,
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
      })),
    appendMessage: (conversationId, msg) =>
      setState((s) => ({
        ...s,
        conversations: s.conversations.map((c) => {
          if (c.id !== conversationId) return c
          const title =
            c.messages.length === 0 && msg.role === 'user'
              ? (msg.content || (msg.attachments?.[0] ? `📎 ${msg.attachments[0].name}` : c.title)).slice(0, 48)
              : c.title
          return { ...c, title, messages: [...c.messages, msg] }
        }),
      })),

    proposals: state.proposals,
    addProposal: (p) => setState((s) => ({ ...s, proposals: [p, ...s.proposals] })),
    updateProposal: (id, patch) =>
      setState((s) => ({
        ...s,
        proposals: s.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      })),

    history: state.history,
    addHistory: (h) => setState((s) => ({ ...s, history: [h, ...s.history].slice(0, 200) })),

    savedKeys: state.savedKeys,
    addSavedKey: async (label, value) => {
      if (!secrets) return
      const key: SavedKey = { id: crypto.randomUUID(), label: label.trim() || 'Sem nome', createdAt: Date.now() }
      await persistSecrets({
        ...secrets,
        savedKeys: { ...secrets.savedKeys, [key.id]: value },
      })
      setState((s) => ({ ...s, savedKeys: [key, ...s.savedKeys] }))
    },
    removeSavedKey: async (id) => {
      if (secrets) {
        const savedKeys = { ...secrets.savedKeys }
        delete savedKeys[id]
        await persistSecrets({ ...secrets, savedKeys })
      }
      setState((s) => ({ ...s, savedKeys: s.savedKeys.filter((k) => k.id !== id) }))
    },
    revealSavedKey: (id) => secrets?.savedKeys?.[id] ?? null,
  }

  return <AppContext.Provider value={store}>{children}</AppContext.Provider>
}

export function useApp(): AppStore {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp deve ser usado dentro de <AppProvider>')
  return ctx
}
