// Adaptadores de provedores de IA. Dois formatos cobrem todos os provedores:
//  - 'anthropic': API Messages da Anthropic.
//  - 'openai': qualquer endpoint compatível com Chat Completions da OpenAI
//    (OpenAI, Gemini, Grok, DeepSeek, OpenRouter, Mistral, APIs customizadas).

import type { ChatMessage, ProviderPreset, ToolCall } from '../types'

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
    defaultModel: 'anthropic/claude-sonnet-4.5',
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
    return data.data.map((m) => ({ id: m.id, name: m.display_name }))
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(await apiError(res))
  const data = (await res.json()) as { data: { id: string; name?: string }[] }
  return (data.data ?? []).map((m) => ({ id: m.id, name: m.name }))
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
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string }

  const messages: { role: 'user' | 'assistant'; content: Block[] | string }[] = []
  for (const m of req.messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content })
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
  type OaMsg =
    | { role: 'system' | 'user'; content: string }
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
      messages.push({ role: 'user', content: m.content })
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
