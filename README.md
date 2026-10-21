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

### Local AI detector (optional)

The **AI check** panel shows two separate scores: Claude's reading of how AI-written the prose sounds, and a score from **SlopTotal**, an open-source detector that runs entirely on your Mac.

To install SlopTotal, run this once:

```bash
zsh scripts/install-detector.sh
```

- It goes into `~/Library/Application Support/writing-centre/sloptotal`, pinned to commit `adc3116`, using `uv` and Python 3.11.
- It takes about 0.8 GB of Python packages, plus about 3.8 GB of models downloaded on the first check. That first check takes a few minutes.
- The app starts the detector only when you run a check:
  - It listens only on `127.0.0.1`, in the lite profile (about 4 GB of RAM).
  - It stops after 10 idle minutes, or when you quit.
  - Your text never leaves the Mac.

### Connecting Claude and Google

Click the **Claude** or **Google Docs** dot in the status bar (bottom left), or run *Connections* from ⌘P.

**Claude:** pick one of these.

- **Use my Claude subscription** (recommended if you have Pro, Max or Team)
  - Every AI request runs through your own Claude Code (`claude -p`, its documented headless mode).
  - Usage counts against your plan's limits, so there's no API bill.
  - **The Assistant runs as your normal Claude Code session.** It loads your global CLAUDE.md, user settings, plugins, hooks and skills.
    - It runs in the app's own empty folder and loads only your *user* settings, never project settings from the vault. A shared vault can't add hooks that run commands.
    - Its only tool is Skill. Notes can contain pasted, untrusted text, so it has no file or web tools that a prompt injection could use to read your files and send them out. The note and its linked notes are already in its prompt.
    - An app instruction keeps personal response-format rules (such as a required prefix) out of the note. This was checked against a real CLAUDE.md with an "Answer:" rule.
    - MCP servers are left out to keep each request fast.
  - Review, Clawd, AI check and Find inspiration run in an isolated mode: an empty folder, no settings, hooks, plugins or MCP servers, and no API keys. That keeps them fast and predictable.
  - If a hook or plugin keeps Claude Code running after it has answered, the app takes the answer and stops the process.
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

- **Keyboard:**
  - **⌘P** opens the command palette: files, plus every command below.
  - **⌘F** opens find & replace in the open note, from anywhere in the app. **⌘G** / **⇧⌘G** go to the next / previous match, **Esc** closes it.
  - **⌃Tab** / **⌃⇧Tab** go to the next / previous tab, even from inside the Claude Code terminal.
- **File tree:** hover a row for rename/move (✎) and trash (✕). Folders get + note and + folder buttons.
- **Wikilinks:** type `[[` to autocomplete. Click a rendered link, or ⌘-click anywhere, to open it. A link to a note that doesn't exist creates that note.
- **Canvas:** use the **Canvas** button or *New canvas (mind map)*.
  - Drag notes from the tree onto the canvas.
  - Double-click empty space for a text card.
  - Drag between the side handles to draw an edge.
  - Double-click a note card to open the note.
  - Backspace deletes the selection.
- **Any file in the vault:** the tree lists everything except dotfiles.
  - Notes (`.md`, `.txt`) open in the editor and canvases (`.canvas`) open as mind maps.
  - PDFs open in the built-in PDF viewer. Images display directly.
  - `.docx` files are converted with macOS `textutil` and shown read-only, in a frame that can't run scripts.
  - `.pptx` files show the text of each slide.
  - Documents and media (Office, iWork, CSV, audio, video…) get **Open in default app**.
  - Anything else, including programs and scripts such as `.app` or `.command`, only gets **Show in Finder**, so a file in a shared vault can't run code from inside the app.
- **Claude Code:** the **Claude Code** tab runs your real, interactive `claude` inside the app, in the vault folder, in a proper terminal.
  - It's exactly your terminal Claude Code: your settings, CLAUDE.md, skills, plugins, permission mode and prompts, using your Claude plan.
  - **Ask about this note** mentions the open note (`@note.md`). **Send selection** pastes the editor selection as one block. **Restart** starts a fresh session.
  - When Claude edits a note, the editor updates right away. The session keeps running while you switch tabs or notes.
  - The side panel widens for the terminal; drag its left edge to resize any tab.
  - The app starts it through your login shell, so `claude` must work in Terminal.app.
  - In this tab Claude can do whatever your own Claude Code may do in that folder, including edits in auto mode if that's your setting.
- **AI check:** the **AI check** tab, or ⌘P → *AI check*.
  - Shows two independent scores (Claude and the local detector), a score for each paragraph from both, and highlights coloured by whichever score you pick.
  - Claude also lists the clearest tells, each with **Propose rewrite**.
  - Neither score proves who wrote a text.
- **Graph:** the **Graph** button. It's built from `[[wikilinks]]`; click a note to open it.
- **Review content:** palette command or the **Review** tab. Click a quote to jump to it in the editor. **Propose fix** opens the fix as a suggestion diff.
- **Assistant:** in the **Assistant** tab.
  - Pick the Claude model at the top. The choice is saved and used by every AI feature.
  - **Suggest** mode shows Claude's proposals as an inline diff with Accept/Reject on each change. Only accepted text is written to disk.
  - **Write** mode rewrites the selection, or the section under the cursor, and streams it into the editor. One ⌘Z undoes it.
- **Clawd:** the crab in the bottom-right corner.
  - Once you pause for about 10 seconds, he keeps busy: wandering the margins, hanging from the end of a line, hopping, waving, dancing, or glancing around.
  - After 90 quiet seconds he naps, with little z's; typing or clicking wakes him.
  - He walks to every real problem he finds, with no fixed limit. When there's nothing worth changing, he says "All good!", smiles and shows a heart.
  - He never takes focus, and reduced-motion settings turn the animations off.
  - He reviews what's on screen after 8 seconds without typing, or when you click him. At most once a minute.
  - Turn him on or off with the **Clawd on/off** button.
- **Google Docs:** palette commands *Link to a new doc*, *Link to an existing doc…*, *Push note → Doc*, *Pull Doc → note*, *Sign out*.
  - For a Doc with **document tabs**, linking asks which tab the note should mirror. Push and pull then touch only that tab; the other tabs stay as they are.
  - An edit in another tab doesn't count as a conflict.
  - A Doc with several tabs can't be linked as a whole document, because Google's API would only write its first tab.
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
| Google Docs tabs: tab picker, pull/push of one tab only (every request carries its `tabId`), no false conflicts from other tabs, whole-document links refused on tabbed Docs; tab → markdown conversion (headings, emphasis, links, nested and numbered lists, tables) | `test/e2e-phase14-gdocs-tabs.mjs` (mock Google) + `test/docsToMd.test.ts` |
| `npm run dev` renderer loads with no console errors | manual headless check |
| Connections sheet: an API key connects (stored encrypted, never as plain text); a pasted "…" is rejected with a clear message; disconnect works; browser sign-in runs `ant auth login --profile writing-centre`; Google client is saved | `test/e2e-phase6-connections.mjs` (mock API, stand-in `ant`) |
| Subscription mode: requests go through `claude -p` with isolated settings and no API key in the environment; review, write streaming, click-only Clawd, WebSearch inspiration filtered to real URLs, usage-limit message | `test/e2e-phase7-subscription.mjs` (stand-in `claude`) |
| **Real** subscription run: a Review through the actual Claude Code login returned correct findings with exact quotes | one manual headless run on Haiku |
| The packaged **Writing Centre.app** passes every e2e suite above | `WC_APP=… npm run e2e` |
| Headless tests never touch the real macOS Keychain (Chromium mock keychain) | checked with a throwaway app name |
| Claude Code tab: real terminal (node-pty + xterm.js) in the vault folder; typing, **Ask about this note**, the session surviving tab switches; the panel widening; Clawd staying in the editor area; side-panel tabs keeping their state; AI check highlighting low scores too | `test/e2e-phase12-terminal.mjs` (stand-in `claude`) |
| **Real** Claude Code starts in the app's terminal (banner, model, plan, prompt), including with a Finder-like bare PATH | headless runs + screenshot |
| ⌘F find (in the editor and from elsewhere) highlights matches; ⌃Tab / ⌃⇧Tab cycle and wrap, also from the terminal | `test/e2e-phase13-keys.mjs` |
| Every file type is listed; PNG, PDF (built-in viewer), `.docx` (sandboxed) and `.pptx` (slide text) open; unknown types offer the default app; `vault://` refuses paths outside the vault | `test/e2e-phase8-files.mjs` (files generated with macOS tools) |
| AI check: two separate scores, per-paragraph scores from both, highlights by either source, tells become suggest-mode rewrites | `test/e2e-phase9-aicheck.mjs` (mock detector by default) |
| **Real** SlopTotal: installed, started by the app on 127.0.0.1, scored a note, and stopped when the app quit | `WC_REAL_DETECTOR=1 node test/e2e-phase9-aicheck.mjs` |
| **Real** Assistant as a full Claude Code session (your CLAUDE.md, hooks, skills): Suggest returned a diff; Write streamed clean prose with no "Answer:" prefix | manual headless runs on Haiku |
| Clawd wanders, hangs, hops, waves, dances and naps when idle; shows every finding (no cap); says "All good!" with a happy animation when there are none | `test/e2e-phase11-clawd.mjs` + pose screenshots |
| Language: English notes are checked by Harper; Turkish notes get no English suggestions and switch to macOS spellcheck; mixed notes check only English sentences; right-click builds a spelling and edit menu; Claude is told to reply in the note's language | `test/e2e-phase10-language.mjs` + `test/language.test.ts` |

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
- **Hidden paths:** the app never creates or writes hidden paths such as `.claude/`, `.git/` or `.obsidian/`.
- **Files:**
  - Renaming a note doesn't update links that point to it.
  - Dotfiles and dot-folders (e.g. `.obsidian`) are hidden and not watched.
  - Delete moves to the OS Trash.
- If a file changes on disk while you have unsaved edits, an open suggestion, or a running rewrite in the app, the app's version wins and you get a toast.
- **Graph:** the layout is a simple O(n²) force layout that isn't saved. It's fine up to a few hundred notes.
- **Canvas:** Obsidian group and link nodes show as plain cards and can't be edited, but they're kept when saving. Node colours and edge labels can't be edited.
- **Languages:** Harper checks English only, and it misses some grammar errors (for example, it doesn't flag "This are").
  - For notes in another language, such as Turkish, Harper stays quiet and macOS's own spellchecker takes over. Right-click a misspelled word for suggestions or **Add to Dictionary**.
  - In mixed notes, Harper checks only the English sentences.
  - Claude answers in the note's language.
  - The macOS underline in the visible window couldn't be checked in headless tests, though macOS itself confirmed it flags "yavas" and suggests "yavaş".
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
- **AI detection is unreliable.** In testing, a deliberately AI-sounding sentence got only 40/100 from the local detector. Treat both scores as hints.
- **Office files:** `.docx` loses images. `.pptx` shows text only, without layout or pictures. Older `.ppt` and `.doc` open only in the default app.
- **One of your Claude Code plugins** reports a Stop-hook error after each run. The app ignores it, but you might want to check your plugins.
- **Find inspiration:** quality depends on Claude's web search. If none of the returned items has a URL from the search results, you get an error instead of a list.
- **Keychain:** the Google token uses Electron `safeStorage` instead of `keytar`. Approved during planning, because keytar is archived and needs native rebuilds.
- The `.app` is ad-hoc signed and not notarized. It runs on the Mac that built it. There's no auto-update; rebuild with `npm run app`.
- Browser sign-in for Claude needs Homebrew's `ant` CLI. Without it, use the API key option.
- Secrets saved on the Connections sheet are encrypted with a Keychain key that belongs to the app build that saved them. If you sign in from `npm run dev`, you may need to sign in again in the packaged app.
