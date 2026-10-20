import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Keys pasted on the Connections page. Encrypted with the OS keychain (Electron safeStorage), never stored in plain text. */
export type Secrets = { anthropicKey?: string; googleClientId?: string; googleClientSecret?: string }

const file = () => join(app.getPath('userData'), 'secrets.bin')

export function loadSecrets(): Secrets {
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(file())))
  } catch {
    return {}
  }
}

export function saveSecrets(patch: Partial<Record<keyof Secrets, string | null>>): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is unavailable, so the key was not saved.')
  const next: Record<string, string> = { ...loadSecrets() }
  for (const [k, v] of Object.entries(patch)) {
    if (v) next[k] = v
    else delete next[k]
  }
  writeFileSync(file(), safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 })
}

/** Credentials end up in HTTP headers, which allow only printable ASCII; catch pasted placeholders like "…" early. */
export function checkSecret(name: string, value: string | undefined): string | undefined {
  const v = value?.trim()
  if (v && !/^[\x21-\x7e]+$/.test(v)) throw new Error(`${name} contains characters a real key never has (such as "…" or spaces). Paste the actual value.`)
  return v || undefined
}
