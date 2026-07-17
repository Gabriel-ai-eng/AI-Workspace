// Tela de criação/destravamento do cofre local de segredos.

import { useState, type FormEvent } from 'react'
import { useApp } from '../lib/store'
import PasswordInput from './PasswordInput'

export default function VaultGate() {
  const { vaultStatus, createVault, unlockVault, resetVault } = useApp()
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isNew = vaultStatus === 'new'

  // Sessão salva encontrada: o cofre está sendo destravado automaticamente.
  if (vaultStatus === 'restoring') {
    return (
      <div className="gate">
        <div className="box">
          <h1>
            <img src="/icon.svg" alt="" /> AI Workspace
          </h1>
          <p className="dim small">
            <span className="pulse">●</span> Entrando automaticamente…
          </p>
        </div>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (isNew) {
      if (pass.length < 6) return setError('Use pelo menos 6 caracteres.')
      if (pass !== confirm) return setError('As senhas não coincidem.')
      setBusy(true)
      await createVault(pass)
    } else {
      setBusy(true)
      const ok = await unlockVault(pass)
      setBusy(false)
      if (!ok) setError('Senha incorreta.')
    }
  }

  return (
    <div className="gate">
      <form className="box" onSubmit={submit}>
        <h1>
          <img src="/icon.svg" alt="" /> AI Workspace
        </h1>
        <p className="dim small">
          {isNew
            ? 'Crie uma senha para o cofre local. Suas chaves de API e o token do GitHub serão criptografados (AES-256) e guardados apenas neste dispositivo. Você continuará conectado até usar o botão Sair.'
            : 'Digite a senha do cofre para destravar suas chaves. Você continuará conectado neste dispositivo até usar o botão Sair.'}
        </p>
        {/* Único lugar onde o navegador deve salvar/preencher a senha do cofre. */}
        <PasswordInput
          placeholder="Senha do cofre"
          value={pass}
          onChange={setPass}
          autoFocus
          name="password"
          autoComplete={isNew ? 'new-password' : 'current-password'}
        />
        {isNew && (
          <PasswordInput
            placeholder="Confirmar senha"
            value={confirm}
            onChange={setConfirm}
            name="confirm-password"
            autoComplete="new-password"
          />
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy || !pass}>
          {busy ? 'Aguarde…' : isNew ? 'Criar cofre' : 'Destravar'}
        </button>
        {!isNew && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              if (window.confirm('Apagar o cofre e TODOS os dados locais? As chaves salvas serão perdidas.'))
                resetVault()
            }}
          >
            Esqueci a senha — apagar tudo e recomeçar
          </button>
        )}
      </form>
    </div>
  )
}
