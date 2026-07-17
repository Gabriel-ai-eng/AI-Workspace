// Tela de criação/destravamento do cofre local de segredos.

import { useState, type FormEvent } from 'react'
import { useApp } from '../lib/store'

export default function VaultGate() {
  const { vaultStatus, createVault, unlockVault, resetVault } = useApp()
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isNew = vaultStatus === 'new'

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
            ? 'Crie uma senha para o cofre local. Suas chaves de API e o token do GitHub serão criptografados (AES-256) e guardados apenas neste dispositivo.'
            : 'Digite a senha do cofre para destravar suas chaves.'}
        </p>
        <input
          type="password"
          placeholder="Senha do cofre"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoFocus
        />
        {isNew && (
          <input
            type="password"
            placeholder="Confirmar senha"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
