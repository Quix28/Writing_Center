# Writing Centre

A local, Obsidian-style writing app built with Electron, CodeMirror 6 and React Flow. It has Claude-powered review and writing help, a companion crab named Clawd, and per-file Google Docs sync. Your notes are plain `.md` files in a folder you choose (the "vault").

## Setup

Requirements: macOS (Apple Silicon or Intel), Node 24+, npm 11+, Homebrew.

```bash
npm install
npm run app        # builds dist/Writing Centre.app
```

Double-click **dist/Writing Centre.app**, or drag it into Applications or the Dock. You don't need `npm run dev` after that. Run `npm run app` again whenever the code changes.

The app is signed locally (ad-hoc), not notarized by Apple. It runs on the Mac that built it. Copying it to another Mac would make Gatekeeper ask for confirmation.

On first launch, click **Open a vault folder** and pick any folder of markdown files. An existing Obsidian vault works. The app remembers the choice.

### Connecting Claude and Google

Click the **Claude** or **Google Docs** dot in the status bar (bottom left), or run *Connections* from ⌘P.

**Claude:** pick one of these.

- **Use my Claude subscription** (recommended if you have Pro, Max or Team)
  - Every AI request runs through your own Claude Code (`claude -p`, its documented headless mode).
  - Usage counts against your plan's limits, so there's no API bill.
  - It runs from an empty folder with your Claude Code settings, hooks, plugins and MCP servers left out, and with no API keys passed in. Your personal Claude Code setup doesn't change the app's output, and the app doesn't change your setup.
  - If Claude Code isn't signed in, the button runs `claude auth login`, which opens claude.ai in your browser.
  - In this mode **Clawd only reviews when you click him**, to save your limits. The model picker offers Sonnet, Opus and Haiku; Sonnet is the default.
  - This is meant for your own use on your own Mac. Anthropic doesn't allow apps to offer subscription login to other people.
- **Pay as you go with the API: Sign in with browser**
  - Needs Anthropic's official CLI once: `brew install anthropics/tap/ant`.
  - The app runs `ant auth login --profile writing-centre`. Your browser opens platform.claude.com, and you approve access.
  - The login is saved in a profile of its own, `writing-centre`, so it doesn't affect other tools you've signed in to.
- **Use an API key instead**
  - Create a key at <https://platform.claude.com/settings/keys> and paste it.
  - It's stored encrypted with Electron `safeStorage`, which uses a key kept in the macOS Keychain.

**Google Docs:** Google only allows sign-in through an OAuth client that you own, so there is a one-time setup. It's also linked step by step on the Connections sheet.

1. Open <https://console.cloud.google.com/> and create a project, or pick an existing one.
2. Enable the **Google Docs API** and the **Google Drive API**.
3. Configure the **OAuth consent screen**:
   - User type: External, or Internal if you have Google Workspace.
   - Add your own Google account under **Test users**.
   - Add the scopes `.../auth/documents` and `.../auth/drive.readonly`.
4. Go to **Credentials → Create credentials → OAuth client ID** and choose type **Desktop app**. Paste the ID and secret into Connections.
5. Click **Sign in with Google**. Your browser opens Google's consent page. After you approve, the sheet shows "Signed in as …".
   - The refresh token is encrypted with Electron `safeStorage`, which uses a key held in the macOS Keychain.

While the consent screen is in **Testing** status, Google expires refresh tokens after 7 days, so you'll be asked to sign in again weekly. Publishing the app to "In production" without verification avoids that, but shows an "unverified app" warning.

Environment variables still work as a fallback (`ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). A key saved on the Connections sheet takes priority. The app rejects values containing characters a real key can't have, such as `…` or spaces.

Everything else (editing, canvas, graph, Harper) works without signing in.

**Keychain prompt:** the first time the app saves an API key or a Google token, macOS asks for your login password so the app can use its "writing-centre Safe Storage" encryption key. Click **Always Allow**. Because the app is signed locally, rebuilding it with `npm run app` can make macOS ask once more. Subscription mode stores no secrets, so it doesn't trigger the prompt.

### Other commands

```bash
npm run app       # build and package dist/Writing Centre.app
npm run dev       # development mode with hot reload
npm run build     # production build into out/
npm start         # run the production build without packaging
npm run icon      # re-render build/icon.icns from the Clawd sprite
npm test           # unit tests (node:test)
npm run e2e        # build, then drive the real app headless through all 5 phases
npm run typecheck
```

`npm run e2e` covers phases 1–5 plus the Connections sheet. To run the same suites against the packaged app, set `WC_APP="$PWD/dist/Writing Centre.app/Contents/MacOS/Electron"`.

The e2e tests run Electron **headless**: the window is never shown, there's no Dock icon, and it never takes focus. They use a throwaway copy of `test-vault/` and local mock servers for the Claude and Google APIs, so they never touch the network or your real vault.

Test-only variables (leave them unset in normal use): `WC_HEADLESS`, `WC_VAULT`, `WC_USER_DATA`, `WC_GOOGLE_API_ROOT`, `WC_GOOGLE_TEST_TOKEN`, and `ANTHROPIC_BASE_URL` (the latter is the SDK's own setting).

## Using it

- **⌘P** opens the command palette: files, plus every command below.
- **File tree:** hover a row for rename/move (✎) and trash (✕). Folders get + note and + folder buttons.
- **Wikilinks:** type `[[` to autocomplete. Click a rendered link, or ⌘-click anywhere, to open it. A link to a note that doesn't exist creates that note.
- **Canvas:** use the **Canvas** button or *New canvas (mind map)*.
  - Drag notes from the tree onto the canvas.
  - Double-click empty space for a text card.
  - Drag between the side handles to draw an edge.
  - Double-click a note card to open the note.
  - Backspace deletes the selection.
- **Graph:** the **Graph** button. It's built from `[[wikilinks]]`; click a note to open it.
- **Review content:** palette command or the **Review** tab. Click a quote to jump to it in the editor. **Propose fix** opens the fix as a suggestion diff.
- **Assistant:** in the **Assistant** tab.
  - Pick the Claude model at the top. The choice is saved and used by every AI feature.
  - **Suggest** mode shows Claude's proposals as an inline diff with Accept/Reject on each change. Only accepted text is written to disk.
  - **Write** mode rewrites the selection, or the section under the cursor, and streams it into the editor. One ⌘Z undoes it.
- **Clawd:** the crab in the bottom-right corner.
  - He reviews what's on screen after 8 seconds without typing, or when you click him. At most once a minute.
  - Turn him on or off with the **Clawd on/off** button.
- **Google Docs:** palette commands *Link to a new doc*, *Link to an existing doc…*, *Push note → Doc*, *Pull Doc → note*, *Sign out*.
  - The link is stored in the note's frontmatter as `gdoc_id`, along with `gdoc_synced_at` and `gdoc_hash`.

## What is verified, and what is not

### Verified (automated, headless, against the built app)

| Area | How |
|---|---|
| Editing writes the `.md` (500 ms debounce, atomic write); external edits reload in the app without losing the cursor; pending saves flush when the window closes; restart keeps content | `test/e2e-phase1.mjs` |
| Writes outside the vault are rejected (`../`, absolute paths; symlinks are guarded in code) | e2e + `test/logic.test.ts` |
| Wikilink autocomplete, ⌘-click navigation, backlinks, live preview hiding syntax | e2e phase 1 |
| Canvas: drag from tree, text cards, drawing edges, double-click to open; the `.canvas` reopens after restart with the same nodes and edges and is not rewritten on open; valid JSON Canvas (integer coordinates, `fromSide`/`toSide`) | `test/e2e-phase2.mjs` |
| Graph view nodes and edges from wikilinks | e2e phase 2 |
| Harper: wavy underline and hover quick-fix, with no network call | `test/e2e-phase3.mjs` |
| Model picker lists models from the Models API and persists the choice; requests use the chosen model and carry `fallbacks: "default"` | e2e phase 3 (mock API) |
| Review findings render and highlight; quotes Claude invented are marked as not found | e2e phase 3 (mock API) |
| Suggest mode never writes the proposal to disk; accept/reject per hunk | e2e phase 3 (mock API) |
| Write mode streams live, locks typing, is a single undo step | e2e phase 3 (mock API) |
| A connection drop mid-stream restores the original text; an API 500 shows a toast; the file is never corrupted | e2e phase 3 (mock API) |
| Clawd: idle/typing/thinking/walking/pointing states, 8 s auto-review, points at the right paragraph, never takes focus, typing works while he points, 60 s limit, toggle persists | `test/e2e-phase4.mjs` (mock API) |
| Find inspiration sends the web search tool, and items whose URL is not in the search results are dropped | e2e phase 4 + `test/inspiration.test.ts` |
| Google sync: link new or existing; push and pull; diff instead of overwrite whenever the other side changed; Cancel changes nothing; network/API errors leave both sides untouched | `test/e2e-phase5.mjs` (mock Google) |
| Markdown → Docs request generation (headings, bold, italic, links, nested lists, index maths) | `test/gdocs.test.ts` |
| `npm run dev` renderer loads with no console errors | manual headless check |
| Connections sheet: an API key connects (stored encrypted, never as plain text); a pasted "…" is rejected with a clear message; disconnect works; browser sign-in runs `ant auth login --profile writing-centre`; Google client is saved | `test/e2e-phase6-connections.mjs` (mock API, stand-in `ant`) |
| Subscription mode: requests go through `claude -p` with isolated settings and no API key in the environment; review, write streaming, click-only Clawd, WebSearch inspiration filtered to real URLs, usage-limit message | `test/e2e-phase7-subscription.mjs` (stand-in `claude`) |
| **Real** subscription run: a Review through the actual Claude Code login returned correct findings with exact quotes | one manual headless run on Haiku |
| The packaged **Writing Centre.app** passes every e2e suite above | `WC_APP=… npm run e2e` |
| Headless tests never touch the real macOS Keychain (Chromium mock keychain) | checked with a throwaway app name |

### Untested

- **Real Claude sign-in and API calls.** Neither a real `ant auth login` nor a real API key was used while building, so every Claude feature was checked only against `test/mock-claude.mjs`. Untested for real: model listing, structured JSON output, streaming, `web_search_20260209`, and whether the API accepts `fallbacks: "default"`.
- **Real Google APIs:**
  - The OAuth loopback sign-in in a real browser, and storing and refreshing the token through `safeStorage`.
  - Real Docs `batchUpdate` and Drive export calls. The request shapes follow Google's documentation and pass the mock, but Google never saw them.
  - What Google's Markdown export actually produces.
- Obsidian opening a `.canvas` made here. The format follows the JSON Canvas spec, but no file was opened in Obsidian.
- Drag and drop and edge drawing with a real mouse. The tests use Playwright's synthetic events.
- How smooth the Clawd animations look, beyond static screenshots.
- Windows and Linux. Large vaults (thousands of notes).

## Limitations

### Google Docs round-trip losses

- **Pushed with formatting:** headings, bold, italic, links, bulleted and numbered lists (including nesting), and line breaks.
- **Pushed as plain text:**
  - `[[wikilinks]]` become their alias or target name, so the link itself is lost.
  - Inline code and code blocks lose monospace.
  - Blockquotes, tables, and raw HTML.
  - `~~strikethrough~~` and task-list `[ ]` boxes stay as literal characters.
  - Images become their alt text. Horizontal rules are dropped.
- A list that mixes bullet and number styles takes the style of its top level.
- YAML frontmatter is never pushed; it stays in the local file.
- **Pull** uses Google's own Markdown export, so the note comes back in Google's markdown style. Expect different escaping, list markers, and emphasis characters. Wikilinks, frontmatter-only data, and anything listed above that was flattened don't come back.
  - In practice, a push followed by a pull rewrites the note's syntax even when nobody edited the Doc. ⌘Z undoes a pull.
- Push replaces the whole Doc body. Comments anchored to replaced text in the Doc may be lost or orphaned.
- **Change detection:**
  - Remote changes are detected with the Doc's Drive `modifiedTime`. Anything that bumps it counts as a change, which can produce an unnecessary (but safe) conflict dialog.
  - Local changes are detected with a content hash rather than file modified time, because writing the sync metadata itself changes the file's mtime.
- Google refresh tokens expire after 7 days while the OAuth app is in Testing mode.

### Everything else

- **Live preview:** hides markdown syntax and styles headings, emphasis, links and wikilinks. It doesn't render tables, images, callouts, or embeds.
- **Files:**
  - Renaming a note doesn't update links that point to it.
  - Dotfiles and dot-folders (e.g. `.obsidian`) are hidden and not watched.
  - Delete moves to the OS Trash.
- If a file changes on disk while you have unsaved edits, an open suggestion, or a running rewrite in the app, the app's version wins and you get a toast.
- **Graph:** the layout is a simple O(n²) force layout that isn't saved. It's fine up to a few hundred notes.
- **Canvas:** Obsidian group and link nodes show as plain cards and can't be edited, but they're kept when saving. Node colours and edge labels can't be edited.
- **Harper:** American English only, and it misses some grammar errors (for example, it doesn't flag "This are").
- **Claude context:** the current note plus the notes it links to directly, capped at roughly 100k tokens using a 4-characters-per-token estimate.
- **Suggest-mode edits:** each edit must quote the note exactly. Edits whose text can't be found are skipped and reported in the chat.
- **Write mode:**
  - It rewrites the selection, the `##`-or-deeper section under the cursor, or else the paragraph. A `#` heading counts as the note's title, so Write mode never rewrites the whole note by accident.
  - It locks the editor and tab switching until it finishes or you press Stop.
- **Subscription mode:** each request starts Claude Code, which adds a few seconds. Plan usage limits apply, and there are no refusal fallbacks.
- **Clawd:**
  - He reviews only the visible text, without linked notes.
  - If the same sentence appears twice, he points at the first copy.
  - **Apply** waits if another suggestion diff is still open.
- **Find inspiration:** quality depends on Claude's web search. If none of the returned items has a URL from the search results, you get an error instead of a list.
- **Keychain:** the Google token uses Electron `safeStorage` instead of `keytar`. Approved during planning, because keytar is archived and needs native rebuilds.
- The `.app` is ad-hoc signed and not notarized. It runs on the Mac that built it. There's no auto-update; rebuild with `npm run app`.
- Browser sign-in for Claude needs Homebrew's `ant` CLI. Without it, use the API key option.
- Secrets saved on the Connections sheet are encrypted with a Keychain key that belongs to the app build that saved them. If you sign in from `npm run dev`, you may need to sign in again in the packaged app.
