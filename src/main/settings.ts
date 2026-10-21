import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Settings = {
  vault?: string
  model: string
  clawd: boolean
  claudeAuth?: 'browser' | 'subscription'
  /** Google's own docs treat a Desktop-app client secret as non-confidential, so it lives here, not in the Keychain. */
  googleClientId?: string
  googleClientSecret?: string
}

const file = () => join(app.getPath('userData'), 'settings.json')
const defaults: Settings = { model: 'claude-opus-5-5', clawd: true }

export function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(next, null, 2))
  return next
}

