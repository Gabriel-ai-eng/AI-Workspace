// Painel de arquivos: navega pelos arquivos dos repositórios selecionados.

import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'

export default function FilesPanel() {
  const { github, selectedRepos } = useApp()
  const [repo, setRepo] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const current = selectedRepos.find((r) => r.fullName === repo) ?? selectedRepos[0] ?? null

  useEffect(() => {
    if (!github || !current) {
      setFiles([])
      return
    }
    setLoading(true)
    setError('')
    setOpenFile(null)
    github
      .getTree(current.fullName, current.defaultBranch)
      .then((tree) => setFiles(tree.filter((t) => t.type === 'blob').map((t) => t.path)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [github, current?.fullName, current?.defaultBranch])

  async function view(path: string) {
    if (!github || !current) return
    setLoading(true)
    try {
      const content = await github.readFile(current.fullName, path, current.defaultBranch)
      setOpenFile({ path, content: content ?? '(arquivo binário ou vazio)' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  if (!selectedRepos.length) {
    return (
      <div className="panel-body">
        <div className="dim small" style={{ textAlign: 'center', marginTop: 24 }}>
          Selecione repositórios na barra lateral para navegar pelos arquivos.
        </div>
      </div>
    )
  }

  const visible = filter
    ? files.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
    : files

  return (
    <div className="panel-body">
      {selectedRepos.length > 1 && (
        <select value={current?.fullName ?? ''} onChange={(e) => setRepo(e.target.value)}>
          {selectedRepos.map((r) => (
            <option key={r.fullName} value={r.fullName}>
              {r.fullName}
            </option>
          ))}
        </select>
      )}
      <input
        type="text"
        placeholder="Filtrar arquivos…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      {loading && <div className="small dim">Carregando…</div>}

      {openFile ? (
        <div className="fileviewer stack">
          <div className="row">
            <button className="btn ghost small" onClick={() => setOpenFile(null)}>
              ← voltar
            </button>
            <span className="mono small ellipsis grow">{openFile.path}</span>
          </div>
          <pre>{openFile.content}</pre>
        </div>
      ) : (
        <div className="filetree">
          {visible.slice(0, 400).map((f) => (
            <button key={f} className="file" title={f} onClick={() => void view(f)}>
              {f}
            </button>
          ))}
          {visible.length > 400 && (
            <div className="small dim">… e mais {visible.length - 400} arquivos (use o filtro)</div>
          )}
        </div>
      )}
    </div>
  )
}
