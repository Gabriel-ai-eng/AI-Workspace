// Visualização de diff linha a linha de uma alteração proposta.

import { diffLines } from 'diff'
import type { FileChange } from '../types'

const CONTEXT = 3

export default function DiffView({ change }: { change: FileChange }) {
  const before = change.previousContent ?? ''
  const after = change.action === 'delete' ? '' : (change.content ?? '')
  const parts = diffLines(before, after)

  const rows: { kind: 'add' | 'del' | 'ctx' | 'skip'; text: string; key: number }[] = []
  let key = 0
  parts.forEach((part, i) => {
    const lines = part.value.replace(/\n$/, '').split('\n')
    const kind = part.added ? 'add' : part.removed ? 'del' : 'ctx'
    if (kind === 'ctx' && lines.length > CONTEXT * 2 + 1) {
      const head = i === 0 ? [] : lines.slice(0, CONTEXT)
      const tail = i === parts.length - 1 ? [] : lines.slice(-CONTEXT)
      const hidden = lines.length - head.length - tail.length
      for (const l of head) rows.push({ kind, text: l, key: key++ })
      rows.push({ kind: 'skip', text: `··· ${hidden} linhas sem alteração ···`, key: key++ })
      for (const l of tail) rows.push({ kind, text: l, key: key++ })
    } else {
      for (const l of lines) rows.push({ kind, text: l, key: key++ })
    }
  })

  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0)
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0)

  return (
    <div className="diff">
      <div className="diff-file">
        <span className="mono grow ellipsis">{change.path}</span>
        <span className={`badge ${change.action === 'delete' ? 'red' : change.action === 'create' ? 'green' : ''}`}>
          {change.action === 'create' ? 'novo' : change.action === 'delete' ? 'apagar' : 'editar'}
        </span>
        <span className="small dim">
          <span style={{ color: 'var(--green)' }}>+{added}</span>{' '}
          <span style={{ color: 'var(--red)' }}>−{removed}</span>
        </span>
      </div>
      <pre>
        {rows.map((r) => (
          <div key={r.key} className={`line ${r.kind}`}>
            {r.kind === 'add' ? '+ ' : r.kind === 'del' ? '− ' : r.kind === 'ctx' ? '  ' : ''}
            {r.text}
          </div>
        ))}
      </pre>
    </div>
  )
}
