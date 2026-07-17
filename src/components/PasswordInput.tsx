// Campo de senha com botão de olho para mostrar/ocultar o que está digitado.

import { useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Nome do campo para o gerenciador de senhas do navegador. */
  name?: string
  /**
   * Papel do campo para o preenchimento automático. Use 'current-password' /
   * 'new-password' APENAS na tela de login do cofre. Campos de chave de API e
   * tokens usam o padrão 'off' + 'new-password' para o navegador NÃO preencher
   * a senha do cofre neles.
   */
  autoComplete?: string
}

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  name,
  autoComplete = 'new-password',
}: Props) {
  const [show, setShow] = useState(false)
  return (
    <div className="pwd">
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        name={name}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="pwd-toggle"
        title={show ? 'Ocultar' : 'Mostrar'}
        aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="4" y1="20" x2="20" y2="4" />
    </svg>
  )
}
