// Layout raiz: barra superior, sidebar (configurações), chat e painel direito
// com abas (Alterações / Arquivos / Histórico). Em telas pequenas, as três
// áreas viram abas na navegação inferior.

import { useState } from 'react'
import ChangesPanel from './components/ChangesPanel'
import Chat from './components/Chat'
import FilesPanel from './components/FilesPanel'
import HistoryPanel from './components/HistoryPanel'
import Sidebar from './components/Sidebar'
import VaultGate from './components/VaultGate'
import { useApp } from './lib/store'

type PanelTab = 'changes' | 'files' | 'history'
type MobileView = 'config' | 'chat' | 'panel'

export default function App() {
  const { vaultStatus, theme, toggleTheme, proposals } = useApp()
  const [tab, setTab] = useState<PanelTab>('changes')
  const [view, setView] = useState<MobileView>('chat')

  if (vaultStatus !== 'unlocked') return <VaultGate />

  const pendingCount = proposals.filter((p) => p.status === 'pending').length

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <img src="/icon.svg" alt="" />
          AI Workspace
        </div>
        <div className="spacer" />
        {pendingCount > 0 && (
          <span
            className="badge"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setTab('changes')
              setView('panel')
            }}
          >
            {pendingCount} alteração(ões) aguardando aprovação
          </span>
        )}
        <button
          className="btn icon ghost"
          title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button
          className="btn icon ghost"
          title="Travar cofre (recarrega o app)"
          onClick={() => window.location.reload()}
        >
          🔒
        </button>
      </header>

      <div className="main" data-view={view}>
        <Sidebar />
        <Chat />
        <aside className="rightpanel">
          <div className="tabs">
            <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
              Alterações
              {pendingCount > 0 && <span className="badge count">{pendingCount}</span>}
            </button>
            <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
              Arquivos
            </button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
              Histórico
            </button>
          </div>
          {tab === 'changes' && <ChangesPanel />}
          {tab === 'files' && <FilesPanel />}
          {tab === 'history' && <HistoryPanel />}
        </aside>
      </div>

      <nav className="mobilenav">
        <button className={view === 'config' ? 'active' : ''} onClick={() => setView('config')}>
          <span className="icon">⚙</span> Configurar
        </button>
        <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>
          <span className="icon">💬</span> Chat
        </button>
        <button className={view === 'panel' ? 'active' : ''} onClick={() => setView('panel')}>
          <span className="icon">±</span> Alterações{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
      </nav>
    </div>
  )
}
