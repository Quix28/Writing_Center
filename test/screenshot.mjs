// `node test/screenshot.mjs out.png [file]` — opens the e2e vault headless and saves a screenshot.
import { _electron as electron } from 'playwright'
import { join } from 'node:path'
const env = { ...process.env, WC_HEADLESS: '1', WC_VAULT: join(import.meta.dirname, '.tmp-vault'), WC_USER_DATA: join(import.meta.dirname, '.tmp-userdata') }
const app = await electron.launch({ args: ['.'], env })
const page = await app.firstWindow()
await page.getByText(process.argv[3] ?? 'Welcome', { exact: true }).first().click()
await page.waitForTimeout(800)
await page.screenshot({ path: process.argv[2] })
await app.close()
