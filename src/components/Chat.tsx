// Chat principal: envia comandos à IA ativa, que trabalha nos repositórios
// selecionados através do loop de agente.

import { useEffect, useRef, useState } from 'react'
import { runAgentTurn } from '../lib/agent'
import { formatBytes } from '../lib/providers'
import { useApp } from '../lib/store'
import type { Attachment, ChatMessage } from '../types'

const SUGGESTIONS = [
  'Analise este projeto e me explique a arquitetura',
  'Corrija os bugs que você encontrar',
  'Crie um sistema de login',
  'Refatore o código para melhorar a legibilidade',
  'Crie uma branch nova e implemente testes',
]

/** Limites por anexo. Acima disso o navegador (e o provedor) sofrem. */
const MAX_ATTACHMENT_SIZE: Record<Attachment['kind'], number> = {
  image: 5 * 1024 * 1024,
  video: 20 * 1024 * 1024,
  file: 10 * 1024 * 1024,
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function Chat() {
  const app = useApp()
  const {
    activeConnection,
    connections,
    setActiveConnection,
    secrets,
    github,
    githubUser,
    selectedRepos,
    conversations,
    activeConversation,
    appendMessage,
    addProposal,
    addHistory,
    autoApply,
    vercel,
  } = app

  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState('')
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const conversation = activeConversation ?? conversations[0] ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages.length, status])

  const ready = !!activeConnection && !!secrets && !!github && selectedRepos.length > 0

  /** Abre o seletor de arquivos com o filtro da opção escolhida no menu. */
  function pickFiles(accept: string) {
    setAttachMenuOpen(false)
    const el = fileInputRef.current
    if (!el) return
    if (accept) el.setAttribute('accept', accept)
    else el.removeAttribute('accept')
    el.value = ''
    el.click()
  }

  async function onFilesPicked(list: FileList | null) {
    if (!list?.length) return
    setAttachError('')
    const added: Attachment[] = []
    const errors: string[] = []
    for (const file of Array.from(list)) {
      const kind: Attachment['kind'] = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : 'file'
      if (file.size > MAX_ATTACHMENT_SIZE[kind]) {
        errors.push(`${file.name} excede o limite de ${formatBytes(MAX_ATTACHMENT_SIZE[kind])}`)
        continue
      }
      try {
        added.push({
          id: crypto.randomUUID(),
          kind,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: await readAsDataUrl(file),
        })
      } catch {
        errors.push(`Não foi possível ler ${file.name}`)
      }
    }
    if (added.length) setAttachments((prev) => [...prev, ...added])
    if (errors.length) setAttachError(errors.join(' · '))
  }

  async function send(text?: string) {
    const content = (text ?? input).trim()
    const attached = attachments
    if ((!content && !attached.length) || running) return
    if (!activeConnection || !secrets || !github) return
    const apiKey = secrets.apiKeys[activeConnection.id]
    if (!apiKey) return

    setInput('')
    setAttachments([])
    setAttachError('')
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller

    const convId = conversation?.id ?? app.newConversation()
    const userMsg: ChatMessage = attached.length
      ? { role: 'user', content, attachments: attached }
      : { role: 'user', content }
    appendMessage(convId, userMsg)

    const baseMessages = [...(conversation?.messages ?? []), userMsg]

    try {
      await runAgentTurn({
        request: {
          kind: activeConnection.kind,
          baseUrl: activeConnection.baseUrl,
          apiKey,
          model: activeConnection.model,
        },
        github,
        repos: selectedRepos,
        messages: baseMessages,
        autoApply,
        vercel,
        signal: controller.signal,
        callbacks: {
          onMessage: (msg) => appendMessage(convId, msg),
          onProposal: addProposal,
          onHistory: addHistory,
          onStatus: setStatus,
        },
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        appendMessage(convId, {
          role: 'assistant',
          content: `⚠️ ${e instanceof Error ? e.message : String(e)}`,
        })
      }
    } finally {
      setRunning(false)
      setStatus('')
      abortRef.current = null
    }
  }

  return (
    <section className="chatarea">
      <div className="chat-toolbar">
        {connections.length > 0 && (
          <select
            value={activeConnection?.id ?? ''}
            onChange={(e) => setActiveConnection(e.target.value)}
            title="IA ativa nesta conversa"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <span className="small dim ellipsis grow">
          {selectedRepos.length
            ? selectedRepos.map((r) => r.fullName).join(' · ')
            : 'Nenhum repositório selecionado'}
        </span>
      </div>

      {conversation && conversation.messages.length > 0 ? (
        <div className="chat-messages">
          {conversation.messages.map((m, i) => (
            <Message key={i} msg={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      ) : (
        <div className="chat-empty">
          <img src="/icon.svg" alt="" width={44} height={44} />
          <div>
            <strong>AI Workspace</strong>
            <br />
            {ready
              ? 'Diga o que a IA deve fazer nos repositórios selecionados.'
              : 'Configure uma IA, conecte o GitHub e selecione repositórios na barra lateral.'}
          </div>
          {ready && (
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn small" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {!githubUser && (
            <div className="small dim">Suas chaves nunca saem deste dispositivo.</div>
          )}
        </div>
      )}

      {status && (
        <div className="status-line">
          <span className="pulse">●</span> {status}
        </div>
      )}

      <div className="chat-input">
        {attachError && <div className="error small">{attachError}</div>}
        {attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((a) => (
              <span key={a.id} className="chip" title={a.name}>
                {a.kind === 'image' ? (
                  <img src={a.dataUrl} alt="" />
                ) : (
                  <span>{a.kind === 'video' ? '🎬' : '📎'}</span>
                )}
                <span className="ellipsis">{a.name}</span>
                <span className="dim">{formatBytes(a.size)}</span>
                <button
                  className="x"
                  title="Remover anexo"
                  onClick={() => setAttachments((prev) => prev.filter((p) => p.id !== a.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-input-row">
          <div className="attach">
            <button
              className="btn icon"
              disabled={!ready || running}
              title="Anexar imagens, vídeos ou arquivos"
              onClick={() => setAttachMenuOpen((v) => !v)}
            >
              ＋
            </button>
            {attachMenuOpen && (
              <>
                <div className="attach-backdrop" onClick={() => setAttachMenuOpen(false)} />
                <div className="attach-menu">
                  <button onClick={() => pickFiles('image/*')}>🖼️ Imagens</button>
                  <button onClick={() => pickFiles('video/*')}>🎬 Vídeos</button>
                  <button onClick={() => pickFiles('')}>📎 Arquivos</button>
                </div>
              </>
            )}
          </div>
          <textarea
            className="grow"
            rows={1}
            placeholder={
              ready ? 'Ex.: "Crie um sistema de login" ou "Corrija os bugs deste projeto"' : 'Complete a configuração na barra lateral…'
            }
            value={input}
            disabled={!ready || running}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          {running ? (
            <button className="btn reject" onClick={() => abortRef.current?.abort()}>
              Parar
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={!ready || (!input.trim() && !attachments.length)}
              onClick={() => void send()}
            >
              Enviar
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void onFilesPicked(e.target.files)}
        />
      </div>
    </section>
  )
}

function Message({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'system') return null
  if (msg.role === 'tool') {
    return (
      <div className="msg tool" title={msg.content.slice(0, 400)}>
        ⚙ {toolLabel(msg.name)} concluído
      </div>
    )
  }
  if (msg.role === 'assistant') {
    if (!msg.content && msg.toolCalls?.length) {
      return (
        <div className="msg tool">
          ⚙ {msg.toolCalls.map((t) => toolLabel(t.name)).join(', ')}…
        </div>
      )
    }
    if (!msg.content) return null
    return <div className="msg assistant">{msg.content}</div>
  }
  return (
    <div className="msg user">
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="msg-attachments">
          {msg.attachments.map((a) => (
            <AttachmentView key={a.id} a={a} />
          ))}
        </div>
      )}
      {msg.content}
    </div>
  )
}

function AttachmentView({ a }: { a: Attachment }) {
  if (!a.dataUrl) {
    return (
      <span className="file-chip dim" title="Os dados deste anexo foram descartados para liberar espaço">
        📎 {a.name} (indisponível)
      </span>
    )
  }
  if (a.kind === 'image') {
    return (
      <a href={a.dataUrl} download={a.name} title={a.name}>
        <img src={a.dataUrl} alt={a.name} />
      </a>
    )
  }
  if (a.kind === 'video') {
    return <video src={a.dataUrl} controls preload="metadata" />
  }
  return (
    <a className="file-chip" href={a.dataUrl} download={a.name} title={a.name}>
      📎 <span className="ellipsis">{a.name}</span>
      <span className="dim">({formatBytes(a.size)})</span>
    </a>
  )
}

function toolLabel(name: string): string {
  switch (name) {
    case 'list_files':
      return 'Listar arquivos'
    case 'read_file':
      return 'Ler arquivo'
    case 'search_code':
      return 'Pesquisar código'
    case 'list_branches':
      return 'Listar branches'
    case 'propose_changes':
      return 'Propor alterações'
    case 'vercel_list_projects':
      return 'Projetos do Vercel'
    case 'vercel_list_deployments':
      return 'Deploys do Vercel'
    case 'vercel_get_deployment':
      return 'Detalhes do deploy'
    case 'vercel_get_build_logs':
      return 'Logs de build'
    default:
      return name
  }
}
