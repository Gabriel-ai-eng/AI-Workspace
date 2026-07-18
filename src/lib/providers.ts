// Adaptadores de provedores de IA. Dois formatos cobrem todos os provedores:
//  - 'anthropic': API Messages da Anthropic.
//  - 'openai': qualquer endpoint compatível com Chat Completions da OpenAI
//    (OpenAI, Gemini, Grok, DeepSeek, OpenRouter, Mistral, APIs customizadas).

import type { Attachment, ChatMessage, ProviderPreset, ToolCall } from '../types'

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-5',
    keyHint: 'sk-ant-...',
    docsUrl: 'https://platform.claude.com/',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.1',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    keyHint: 'AIza...',
    docsUrl: 'https://aistudio.google.com/',
  },
  {
    id: 'grok',
    name: 'Grok (xAI)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    keyHint: 'xai-...',
    docsUrl: 'https://console.x.ai/',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-5',
    keyHint: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    keyHint: '...',
    docsUrl: 'https://console.mistral.ai/',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    keyHint: 'gsk_...',
    docsUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    kind: 'openai',
    baseUrl: 'https://router.huggingface.co/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    keyHint: 'hf_...',
    docsUrl: 'https://huggingface.co/settings/tokens',
  },
  {
    id: 'custom',
    name: 'API customizada (compatível com OpenAI)',
    kind: 'openai',
    baseUrl: '',
    defaultModel: '',
    keyHint: 'sua chave',
    docsUrl: '',
  },
]

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ModelInfo {
  id: string
  name?: string
  /**
   * true = grátis, false = pago. Sempre definido: quando o provedor não
   * informa preço no catálogo, assumimos pago (é o caso da esmagadora
   * maioria dos provedores — só o OpenRouter expõe variantes ":free" em
   * escala), para o filtro Grátis/Pagos funcionar em qualquer provedor.
   */
  free: boolean
}

/** Busca o catálogo de modelos do provedor (GET /models). */
export async function listModels(
  kind: 'anthropic' | 'openai',
  baseUrl: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  if (kind === 'anthropic') {
    const res = await fetch(`${baseUrl}/v1/models?limit=1000`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    if (!res.ok) throw new Error(await apiError(res))
    const data = (await res.json()) as { data: { id: string; display_name?: string }[] }
    // A Anthropic não tem modelos gratuitos na API.
    return data.data.map((m) => ({ id: m.id, name: m.display_name, free: false }))
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(await apiError(res))
  const data = (await res.json()) as {
    data: { id: string; name?: string; pricing?: Record<string, string | number> }[]
  }
  return (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    free: modelIsFree(m.id, m.name, m.pricing),
  }))
}

/**
 * Deduz se um modelo é gratuito: IDs/nomes ":free" ou "(free)" (OpenRouter e
 * afins) ou tabela de preços zerada. Sem nenhum sinal, assume pago — é o
 * comportamento real da maioria dos provedores (OpenAI, Grok, DeepSeek,
 * Mistral, Hugging Face não têm tier de inferência grátis por modelo).
 */
function modelIsFree(id: string, name: string | undefined, pricing?: Record<string, string | number>): boolean {
  if (/(:|\()\s*free\s*\)?$/i.test(id) || /(:|\()\s*free\s*\)?$/i.test(name ?? '')) return true
  if (!pricing) return false
  const values = Object.values(pricing)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
  if (!values.length) return false
  return values.every((n) => n === 0)
}

/**
 * Converte o que o usuário digitou no ID real do modelo: aceita o próprio ID,
 * o nome de exibição (ex.: "Qwen3 Coder 480B A35B (free)") ou um trecho único.
 * Retorna null se o catálogo foi carregado e nada corresponde.
 */
export function resolveModelId(input: string, models: ModelInfo[]): string | null {
  const t = input.trim()
  if (!t) return null
  if (!models.length) return t // sem catálogo (ex.: API customizada) — usa como digitado
  const lower = t.toLowerCase()
  const exactId = models.find((m) => m.id.toLowerCase() === lower)
  if (exactId) return exactId.id
  const exactName = models.find((m) => (m.name ?? '').toLowerCase() === lower)
  if (exactName) return exactName.id
  const contains = models.filter(
    (m) => m.id.toLowerCase().includes(lower) || (m.name ?? '').toLowerCase().includes(lower),
  )
  if (contains.length >= 1) {
    // Prefere a variante gratuita se o usuário escreveu "free"; senão, a primeira.
    if (lower.includes('free')) {
      const free = contains.find((m) => m.id.endsWith(':free'))
      if (free) return free.id
    }
    return contains[0].id
  }
  return null
}

export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
}

export interface ChatRequest {
  kind: 'anthropic' | 'openai'
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  signal?: AbortSignal
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  return req.kind === 'anthropic' ? chatAnthropic(req) : chatOpenAI(req)
}

// ---------------------------------------------------------------- Anthropic

async function chatAnthropic(req: ChatRequest): Promise<ChatResult> {
  type Block =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string }

  const messages: { role: 'user' | 'assistant'; content: Block[] | string }[] = []
  for (const m of req.messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      if (m.attachments?.length) {
        const blocks: Block[] = []
        for (const a of m.attachments) {
          if (!a.dataUrl) {
            blocks.push({ type: 'text', text: attachmentUnavailableNote(a) })
          } else if (a.kind === 'image' && ANTHROPIC_IMAGE_TYPES.has(a.mimeType)) {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: a.mimeType, data: dataUrlBase64(a.dataUrl) },
            })
          } else if (a.mimeType === 'application/pdf') {
            blocks.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: dataUrlBase64(a.dataUrl) },
            })
          } else if (isTextAttachment(a)) {
            blocks.push({ type: 'text', text: textAttachmentBlock(a) })
          } else {
            blocks.push({ type: 'text', text: attachmentNote(a) })
          }
        }
        if (m.content) blocks.push({ type: 'text', text: m.content })
        messages.push({ role: 'user', content: blocks })
      } else {
        messages.push({ role: 'user', content: m.content })
      }
    } else if (m.role === 'assistant') {
      const blocks: Block[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
      }
      if (blocks.length) messages.push({ role: 'assistant', content: blocks })
    } else {
      // Resultados de ferramenta viram blocos tool_result em um turno de usuário.
      const block: Block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
      const last = messages[messages.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        messages.push({ role: 'user', content: [block] })
      }
    }
  }

  const res = await fetch(`${req.baseUrl}/v1/messages`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: 8192,
      system: req.system,
      messages,
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    }),
  })
  if (!res.ok) throw new Error(await apiError(res))

  const data = (await res.json()) as {
    content: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> })[]
  }
  let text = ''
  const toolCalls: ToolCall[] = []
  for (const block of data.content) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: block.input })
  }
  return { text, toolCalls }
}

// ------------------------------------------------- OpenAI Chat Completions

async function chatOpenAI(req: ChatRequest): Promise<ChatResult> {
  type OaPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  type OaMsg =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string | OaPart[] }
    | {
        role: 'assistant'
        content: string | null
        tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
      }
    | { role: 'tool'; tool_call_id: string; content: string }

  const messages: OaMsg[] = [{ role: 'system', content: req.system }]
  for (const m of req.messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      if (m.attachments?.length) {
        const parts: OaPart[] = []
        for (const a of m.attachments) {
          if (!a.dataUrl) {
            parts.push({ type: 'text', text: attachmentUnavailableNote(a) })
          } else if (a.kind === 'image') {
            parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
          } else if (isTextAttachment(a)) {
            parts.push({ type: 'text', text: textAttachmentBlock(a) })
          } else {
            parts.push({ type: 'text', text: attachmentNote(a) })
          }
        }
        if (m.content) parts.push({ type: 'text', text: m.content })
        messages.push({ role: 'user', content: parts })
      } else {
        messages.push({ role: 'user', content: m.content })
      }
    } else if (m.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls?.length
          ? m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            }))
          : undefined,
      })
    } else {
      messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }

  const res = await fetch(`${req.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      messages,
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    }),
  })
  if (!res.ok) throw new Error(await apiError(res))

  const data = (await res.json()) as {
    choices: {
      message: {
        content: string | null
        tool_calls?: { id: string; function: { name: string; arguments: string } }[]
      }
    }[]
  }
  const msg = data.choices[0]?.message
  const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    args: safeParseJson(tc.function.arguments),
  }))
  return { text: msg?.content ?? '', toolCalls }
}

// ------------------------------------------------------------------ anexos

/** Tipos de imagem aceitos pela API Messages da Anthropic. */
const ANTHROPIC_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

const TEXT_MIME_SET = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/x-sh',
  'application/x-yaml',
  'application/yaml',
  'image/svg+xml',
])

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|json|jsonc|xml|yml|yaml|csv|tsv|ts|tsx|js|jsx|mjs|cjs|css|scss|html|htm|svg|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|sql|sh|bash|toml|ini|cfg|conf|env|log|gitignore|dockerfile)$/i

function dataUrlBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

function isTextAttachment(a: Attachment): boolean {
  return (
    a.mimeType.startsWith('text/') || TEXT_MIME_SET.has(a.mimeType) || TEXT_EXTENSIONS.test(a.name)
  )
}

function decodeTextAttachment(a: Attachment): string {
  try {
    const bin = atob(dataUrlBase64(a.dataUrl))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return '(não foi possível decodificar o conteúdo do arquivo)'
  }
}

function textAttachmentBlock(a: Attachment): string {
  const text = decodeTextAttachment(a)
  const truncated =
    text.length > 60_000 ? `${text.slice(0, 60_000)}\n… (arquivo truncado)` : text
  return `Conteúdo do arquivo anexado "${a.name}" (${a.mimeType || 'texto'}):\n\n${truncated}`
}

function attachmentNote(a: Attachment): string {
  return (
    `[O usuário anexou "${a.name}" (${a.mimeType || 'tipo desconhecido'}, ${formatBytes(a.size)}), ` +
    'mas este tipo de anexo não pode ser enviado à API deste provedor. ' +
    'Se o conteúdo for necessário, peça ao usuário em outro formato.]'
  )
}

function attachmentUnavailableNote(a: Attachment): string {
  return `[Anexo "${a.name}" não está mais disponível neste dispositivo.]`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function apiError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const msg = body?.error?.message ?? body?.message ?? JSON.stringify(body)
    return `Erro da API (${res.status}): ${msg}`
  } catch {
    return `Erro da API (${res.status} ${res.statusText})`
  }
}
