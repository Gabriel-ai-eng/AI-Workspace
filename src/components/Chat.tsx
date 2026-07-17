// Chat principal: envia comandos à IA ativa, que trabalha nos repositórios
// selecionados através do loop de agente.

import { useEffect, useRef, useState } from 'react'
import { runAgentTurn } from '../lib/agent'
import { useApp } from '../lib/store'
import type { ChatMessage } from '../types'

const SUGGESTIONS = [
  'Analise este projeto e me explique a arquitetura',
  'Corrija os bugs que você encontrar',
  'Crie um sistema de login',
  'Refatore o código para melhorar a legibilidade',
  'Crie uma branch nova e implemente testes',
]

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
  } = app

  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const conversation = activeConversation ?? conversations[0] ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages.length, status])

  const ready = !!activeConnection && !!secrets && !!github && selectedRepos.length > 0

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || running) return
    if (!activeConnection || !secrets || !github) return
    const apiKey = secrets.apiKeys[activeConnection.id]
    if (!apiKey) return

    setInput('')
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller

    const convId = conversation?.id ?? app.newConversation()
    const userMsg: ChatMessage = { role: 'user', content }
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
        signal: controller.signal,
        callbacks: {
          onMessage: (msg) => appendMessage(convId, msg),
          onProposal: addProposal,
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
          <button className="btn primary" disabled={!ready || !input.trim()} onClick={() => void send()}>
            Enviar
          </button>
        )}
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
  return <div className="msg user">{msg.content}</div>
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
    default:
      return name
  }
}
