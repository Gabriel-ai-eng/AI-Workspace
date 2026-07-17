// Histórico de tudo o que foi aplicado (ou rejeitado) nos repositórios.

import { useApp } from '../lib/store'

const KIND_LABEL: Record<string, string> = {
  commit: 'Commit',
  pr: 'Pull Request',
  branch: 'Branch',
  rejected: 'Rejeitado',
}

export default function HistoryPanel() {
  const { history } = useApp()

  if (!history.length) {
    return (
      <div className="panel-body">
        <div className="dim small" style={{ textAlign: 'center', marginTop: 24 }}>
          O histórico de commits, PRs e propostas rejeitadas aparecerá aqui.
        </div>
      </div>
    )
  }

  return (
    <div className="panel-body">
      {history.map((h) => (
        <div key={h.id} className="card stack" style={{ gap: 4 }}>
          <div className="row">
            <span className={`badge ${h.kind === 'rejected' ? 'red' : 'green'}`}>
              {KIND_LABEL[h.kind] ?? h.kind}
            </span>
            <span className="small dim grow ellipsis">{h.repo}</span>
            <span className="small dim">{new Date(h.at).toLocaleString()}</span>
          </div>
          <div className="ellipsis" title={h.summary}>
            {h.summary}
          </div>
          {h.url && (
            <a className="small" href={h.url} target="_blank" rel="noreferrer">
              Ver no GitHub ↗
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
