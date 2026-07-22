// Tipos compartilhados do AI Workspace.

export type ProviderKind = 'anthropic' | 'openai'

export interface ProviderPreset {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  defaultModel: string
  keyHint: string
  docsUrl: string
}

/** Uma conexão de IA configurada pelo usuário (chave fica no cofre criptografado). */
export interface AIConnection {
  id: string
  presetId: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
}

/**
 * Metadados de uma chave de API salva para uso futuro (o valor em si fica
 * no cofre criptografado, indexado por `id`). Serve para guardar qualquer
 * chave — de um serviço ainda não integrado ao app, por exemplo — sem
 * precisar conectá-la a nada agora.
 */
export interface SavedKey {
  id: string
  label: string
  createdAt: number
}

export type RepoPermission = 'read' | 'write' | 'admin'

export interface RepoRef {
  fullName: string // "dono/repositorio"
  defaultBranch: string
  /** O que a IA pode fazer neste repositório. */
  permission: RepoPermission
  private: boolean
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** Anexo enviado pelo usuário no chat (imagem, vídeo ou arquivo genérico). */
export interface Attachment {
  id: string
  kind: 'image' | 'video' | 'file'
  name: string
  mimeType: string
  size: number
  /**
   * Data URL (base64) do arquivo — usada para exibir no chat e enviar ao
   * provedor. Pode ficar vazia se os dados foram descartados para liberar
   * espaço de armazenamento.
   */
  dataUrl: string
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; attachments?: Attachment[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export type FileAction = 'create' | 'update' | 'delete'

export interface FileChange {
  path: string
  action: FileAction
  content?: string
  /** Conteúdo atual no GitHub, buscado para exibir o diff. */
  previousContent?: string
}

/** Proposta atômica da IA: branch + commit + PR opcional. Nada executa sem aprovação. */
export interface ChangeProposal {
  id: string
  repo: string
  baseBranch: string
  /** Se diferente de baseBranch, a branch será criada a partir da base. */
  targetBranch: string
  commitMessage: string
  files: FileChange[]
  pr?: { title: string; body: string }
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed'
  error?: string
  resultUrl?: string
  createdAt: number
}

export interface HistoryEntry {
  id: string
  at: number
  repo: string
  summary: string
  kind: 'commit' | 'pr' | 'branch' | 'rejected'
  url?: string
}

export interface Conversation {
  id: string
  title: string
  connectionId: string | null
  messages: ChatMessage[]
  createdAt: number
}
