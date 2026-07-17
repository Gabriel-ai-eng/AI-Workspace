// Painel de alterações: mostra cada proposta da IA com diff completo e os
// botões de aprovar (executa no GitHub) ou rejeitar (descarta).

import { useState } from 'react'
import { applyProposal } from '../lib/agent'
import { useApp } from '../lib/store'
import type { ChangeProposal } from '../types'
import DiffView from './DiffView'

export default function ChangesPanel() {
  const { proposals } = useApp()
  const pending = proposals.filter((p) => p.status === 'pending')
  const resolved = proposals.filter((p) => p.status !== 'pending').slice(0, 10)

  if (!proposals.length) {
    return (
      <div className="panel-body">
        <div className="dim small" style={{ textAlign: 'center', marginTop: 24 }}>
          Quando a IA propuser alterações, elas aparecerão aqui para você revisar o diff e aprovar
          ou rejeitar. Nada é aplicado sem a sua confirmação.
        </div>
      </div>
    )
  }

  return (
    <div className="panel-body">
      {pending.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
      {resolved.length > 0 && (
        <>
          <div className="small dim" style={{ marginTop: 6 }}>
            Resolvidas recentemente
          </div>
          {resolved.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </>
      )}
    </div>
  )
}

function ProposalCard({ proposal: p }: { proposal: ChangeProposal }) {
  const { github, updateProposal, addHistory } = useApp()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(p.status === 'pending')

  async function approve() {
    if (!github) return
    setBusy(true)
    updateProposal(p.id, { status: 'approved' })
    try {
      const result = await applyProposal(github, p)
      updateProposal(p.id, { status: 'applied', resultUrl: result.prUrl ?? result.commitUrl })
      addHistory({
        id: crypto.randomUUID(),
        at: Date.now(),
        repo: p.repo,
        summary: p.commitMessage,
        kind: result.prUrl ? 'pr' : 'commit',
        url: result.prUrl ?? result.commitUrl,
      })
    } catch (e) {
      updateProposal(p.id, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
    }
  }

  function reject() {
    updateProposal(p.id, { status: 'rejected' })
    addHistory({
      id: crypto.randomUUID(),
      at: Date.now(),
      repo: p.repo,
      summary: `Rejeitado: ${p.commitMessage}`,
      kind: 'rejected',
    })
  }

  const statusBadge = {
    pending: <span className="badge">aguardando aprovação</span>,
    approved: <span className="badge">aplicando…</span>,
    applied: <span className="badge green">aplicada</span>,
    rejected: <span className="badge red">rejeitada</span>,
    failed: <span className="badge red">falhou</span>,
  }[p.status]

  return (
    <div className="card stack">
      <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis" title={p.commitMessage}>
            <strong>{p.commitMessage}</strong>
          </div>
          <div className="small dim ellipsis">
            {p.repo} · {p.baseBranch}
            {p.targetBranch !== p.baseBranch ? ` → ${p.targetBranch} (branch nova)` : ''}
            {p.pr ? ' · abre PR' : ''} · {p.files.length} arquivo(s)
          </div>
        </div>
        {statusBadge}
      </div>

      {open && (
        <>
          {p.files.map((f) => (
            <DiffView key={f.path} change={f} />
          ))}
          {p.pr && (
            <div className="small dim">
              PR proposto: <strong>{p.pr.title}</strong>
            </div>
          )}
          {p.error && <div className="error">{p.error}</div>}
          {p.resultUrl && (
            <a href={p.resultUrl} target="_blank" rel="noreferrer" className="small">
              Ver no GitHub ↗
            </a>
          )}
          {p.status === 'pending' && (
            <div className="row">
              <button className="btn approve grow" disabled={busy} onClick={() => void approve()}>
                {busy ? 'Aplicando…' : '✓ Aprovar e executar'}
              </button>
              <button className="btn reject" disabled={busy} onClick={reject}>
                ✕ Rejeitar
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
