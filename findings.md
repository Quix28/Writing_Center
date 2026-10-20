# Claude Writing Editor with AI Detector: Research Findings

Date: 2026-10-19

## Goal

Find a UI that:

1. Looks like Google Docs or Microsoft Word
2. Uses Claude as the writer / writing helper
3. Has a built-in AI detector

## Bottom line

No single project or product found has all three. The closest options cover two of the three. The fastest path to all three is to combine a Claude-powered Word-like editor with a self-hosted detector (see [Recommendation](#recommendation)).

## How the search was done

- GitHub repo search by name and description (e.g. "claude writer", "ai writing editor", "tiptap claude", "ai detector claude").
- GitHub topics: `ai-detector`, `ai-detection`, `ai-humanizer`, `ai-writing-assistant`, `ai-editor`, `document-editor`.
- GitHub code search for `package.json` files that use `@anthropic-ai/sdk` together with a rich-text editor (TipTap, Lexical, BlockNote, Quill, Slate, CKEditor). This returned 444 repos. Each README was then filtered for detector terms (AI detection, GPTZero, humanizer, burstiness).
- Google searches for commercial tools and review roundups.

## Open-source editors (closest matches)

| Project | Word/Docs-like UI | Claude | AI detector | Stars | Notes |
|---|---|---|---|---|---|
| [tenzing-lunn/essay-editor ("Margin")](https://github.com/tenzing-lunn/essay-editor) | Partial (essay editor) | Yes (own key, or OpenAI) | Yes (AI-pattern check) | 0 | Grades essays and marks lines. Does not write text for you; only suggests fixes. |
| [guea14012/koppaword-2026](https://github.com/guea14012/koppaword-2026) | Yes (ribbon toolbar, .docx import) | Yes (Claude only: Opus, Sonnet, Haiku) | No | 0 | Electron + React + TipTap. Small hobby project. |
| [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice) | Yes (full Office clone, real .docx/.xlsx/.pptx) | Yes (bring your own key, many providers) | No | ~10k | Most mature option. AI edits show as tracked changes. |
| [Figstranmedia/scriptorium](https://github.com/Figstranmedia/scriptorium) | Yes (TipTap + InDesign-style layout) | Yes (or Ollama) | No | 0 | Academic writing, citations, PDF export. |
| [docwriter-org/docwriter](https://github.com/docwriter-org/docwriter) | No (Markdown editor) | Yes | No | 37 | CMU / UC Berkeley research project. You and the agent edit the same draft; accept or reject its edits. |
| [ilrein/openwrite](https://github.com/ilrein/openwrite) | Partial (TipTap) | Yes (Anthropic among providers) | No | 65 | Built for fiction writers. |

## Open-source AI detectors (can be plugged into an editor)

| Project | Type | Notes |
|---|---|---|
| [pablocaeg/sloptotal](https://github.com/pablocaeg/sloptotal) | Self-hosted web app + API | 23 detection engines combined into one calibrated score. Accepts text, .docx, .pdf, URLs. Per-paragraph heat map. Runs with `docker run -p 8000:8000 ghcr.io/pablocaeg/sloptotal`. |
| [lucadagati/ai-text-detector](https://github.com/lucadagati/ai-text-detector) | Local service | Sentence-level highlighting. Reports 97% detection of Claude-written academic text at 1% false positives. |
| [lynote-ai/ai-text-detector](https://github.com/lynote-ai/ai-text-detector) | CLI / Python library | Explainable signals, no network calls. 622 stars. |
| [wuisabel-gif/Cadence](https://github.com/wuisabel-gif/Cadence) | Web page, CLI, Claude Code plugin, Chrome extension | Grades text and names each "robotic" pattern. |
| [Aboudjem/humanizer-skill](https://github.com/Aboudjem/humanizer-skill) | Claude Code plugin + CLI | 0-100 "AI-tell" score from four measurable signals. |
| [JayOfemi/byakugan](https://github.com/JayOfemi/byakugan) | Browser app + MCP server | Runs fully in the browser. Can be connected to Claude Desktop. |
| [conorbronsdon/avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing) | Skill + MCP server | Deterministic 0-100 score, `score_text` and `audit_text` tools. |

## Commercial tools

| Tool | Docs-like editor | Claude | AI detector | Notes |
|---|---|---|---|---|
| [Grammarly Docs](https://support.grammarly.com/hc/en-us/articles/38552281546765-Docs-Grammarly-s-new-AI-writing-surface) | Yes | Not confirmed (model not disclosed) | Yes (AI Detector agent, Pro only at launch) | Also has Humanizer, Proofreader, Citation Finder and other agents. Best UI match. |
| [Type.ai](https://type.ai/type-vs-claude) | Yes | Yes (Claude Sonnet) | No | Long-form document editor. |
| [Smodin](https://cybernews.com/ai-tools/best-essay-writing-ai/) | Partial | No | Yes | Essay generator with detector and humanizer. |
| [Yomu AI](https://www.yomu.ai/resources/yomu-ai-vs-jenni-ai-which-ai-writing-tool-is-right-for-you) | Yes | Yes (Ultra plan) | Unclear (sources disagree) | Academic editor. |
| [Jenni AI](https://storyflow.so/blog/best-jenni-ai-alternatives-2026) | Yes | Not confirmed | No | Autocomplete-first editor. |
| [Claude for Google Workspace](https://workspace.google.com/marketplace/app/claude/12459801340) | Yes (it is Google Docs) | Yes | No | Official add-on. Pair with a separate detector. |

## Caveats

- AI detectors give an estimate, not proof. All of them produce false positives on human writing, and several are biased against non-native English writers.
- Claude output is not invisible to detectors. One open-source detector reports 97% detection of Claude-written academic text.
- Most commercial claims above come from vendor pages or affiliate reviews and were not independently verified. Check current pricing and features on each vendor's site.

## Recommendation

Fastest way to get all three features:

1. Start from **KOPPAWORD 2026** (Word-like, already Claude-only) or **GenOffice** (more mature, real .docx support).
2. Run **SlopTotal** locally with Docker.
3. Add a sidebar panel that sends the document text to SlopTotal's local API and shows the score and per-paragraph heat map.

## Sources

- https://github.com/tenzing-lunn/essay-editor
- https://github.com/guea14012/koppaword-2026
- https://github.com/genspark-ai/genoffice
- https://github.com/Figstranmedia/scriptorium
- https://github.com/docwriter-org/docwriter
- https://github.com/ilrein/openwrite
- https://github.com/git-init-priyanshu/Docx
- https://github.com/suitenumerique/docs
- https://github.com/aieditor-team/AiEditor
- https://github.com/pablocaeg/sloptotal
- https://github.com/lucadagati/ai-text-detector
- https://github.com/lynote-ai/ai-text-detector
- https://github.com/wuisabel-gif/Cadence
- https://github.com/Aboudjem/humanizer-skill
- https://github.com/JayOfemi/byakugan
- https://github.com/conorbronsdon/avoid-ai-writing
- https://github.com/blader/humanizer
- https://support.grammarly.com/hc/en-us/articles/38552281546765-Docs-Grammarly-s-new-AI-writing-surface
- https://www.thurrott.com/?p=324719
- https://type.ai/type-vs-claude
- https://cybernews.com/ai-tools/best-essay-writing-ai/
- https://www.yomu.ai/resources/yomu-ai-vs-jenni-ai-which-ai-writing-tool-is-right-for-you
- https://storyflow.so/blog/best-jenni-ai-alternatives-2026
- https://storyflow.so/blog/best-ai-document-editors-2026
- https://write-it.us/blog/best-ai-writing-assistants-for-google-docs
- https://workspace.google.com/marketplace/app/claude/12459801340
- https://paperguide.ai/blog/ai-essay-writing-tools/
