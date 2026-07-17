// Cofre local: as chaves de API e o token do GitHub são criptografados com
// AES-256-GCM, com chave derivada da senha do usuário via PBKDF2 (SHA-256).
// Nada é enviado para servidor algum — tudo fica no localStorage do dispositivo.

const VAULT_KEY = 'aiw.vault.v1'
const PBKDF2_ITERATIONS = 310_000

export interface VaultSecrets {
  githubToken?: string
  /** connectionId -> API key */
  apiKeys: Record<string, string>
}

interface VaultFile {
  salt: string
  iv: string
  data: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function vaultExists(): boolean {
  return localStorage.getItem(VAULT_KEY) !== null
}

export async function saveVault(passphrase: string, secrets: VaultSecrets): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(JSON.stringify(secrets)),
  )
  const file: VaultFile = { salt: toB64(salt), iv: toB64(iv), data: toB64(data) }
  localStorage.setItem(VAULT_KEY, JSON.stringify(file))
}

/** Retorna null se a senha estiver incorreta. */
export async function openVault(passphrase: string): Promise<VaultSecrets | null> {
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) return { apiKeys: {} }
  const file = JSON.parse(raw) as VaultFile
  try {
    const key = await deriveKey(passphrase, fromB64(file.salt))
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(file.iv) as BufferSource },
      key,
      fromB64(file.data) as BufferSource,
    )
    return JSON.parse(dec.decode(plain)) as VaultSecrets
  } catch {
    return null
  }
}

export function deleteVault(): void {
  localStorage.removeItem(VAULT_KEY)
}
