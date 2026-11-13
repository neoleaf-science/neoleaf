# Plan: an AI assistant inside the editor (bring your own key)

Status: **all steps done (1.42.0), the feature is switched on for the public site; browser agents (WebMCP) added in 1.43.0.** 1.41.0 is the last version with it off. Written 2026-11-12, after 1.38.2 ( reviewed the same day against the code and the providers, see "What the review changed" at the end).

Step 1 as built: `config::ai_enabled` (preview variable plus `[ai] enabled` for institution installs), `ai_blocks` in `views/editor_page.rs`, `static/js/ai-settings.js` (`AISettings`), the project rule in `project-store.js`, the removal on sign out in `storage-manager.js`, 32 interface strings in 14 languages, tests in `tests/e2e/specs/ai-settings.test.ts` (13) and unit tests in `config.rs` and `editor_page.rs`. Two things differ from the text below: sign out removes the key **without an extra question** (it only names the key when it was going to ask anyway, and "Delete all local data" always names it), and the `[ai]` switch is not in `neoleaf.example.toml` yet (it goes there in step 6, when it starts to work without the preview variable). Decided with the owner in chat: first target is the public site (neoleaf.science); the assistant can comment and suggest edits; proposals are drafts first; AI authorship is visible; a consent notice appears the first time.

Step 2 as built: `static/js/ai-providers.js` (`AIProviders`: `listModels`, `newConversation`, `addUser`, `addToolResults`, `send`, `describe`), "List the models" in the form and "Test the connection" on the ready screen (`ai-settings.js`), 15 more interface strings in 14 languages, the fake provider `tests/fake-ai/server.ts` and `tests/e2e/specs/ai-providers.test.ts` (20 tests). Differences from the text below: the base URL field is shown only for "Other (OpenAI-compatible)" (a stored `baseUrl` still overrides any provider's address, which is what the tests use; there is no "Advanced" field for Anthropic); server-side refusal fallbacks and eager tool-input streaming are not used (a refusal is reported as such; tool inputs here are small); the output ceiling is the model's own, as the provider reports it, capped at 32000 (16000 when unknown). **Still to do for this step: one real request per provider by the owner** ("Test the connection" with a real key), which is the only thing that proves the real endpoints behave like the fake.

Step 3 as built: `static/js/ai-tools.js` (`AITools`: `defs`, `run`, `begin`, `sent`, `total`) and `tests/e2e/specs/ai-tools.test.ts` (12 tests). Differences from the text below: the files come from `BrowserGit.listFiles()` instead of `FT.entries()` (the same tree, without depending on the interface); `git_diff` became `changed_files` (which files changed since the last commit; the assistant reads them if it wants the text); the limits count characters, not bytes; the "What was sent" data exists (`AITools.sent()`) and its view arrives with the chat panel in step 4; the per-question token ceiling also belongs to the loop in step 4.

Step 4 as built: `static/js/ai-chat.js` (`AIChat`: `mount`, `ask`, `stop`, `reset`), 17 more interface strings in 14 languages and `tests/e2e/specs/ai-chat.test.ts` (16 tests). The token ceiling of one question is 500 000 input tokens (all rounds added); the estimate before sending is characters divided by four and says it is an estimate; a conversation over 1.5 million characters is not kept after a reload (the panel says so). `AIProviders.addUser` joins a question to a preceding unanswered user message on the Anthropic dialect, so roles always alternate. Not done here: a test with a live collaborative session (the assistant writes nothing to the editor in this step, so there is nothing for it to disturb; the test belongs to step 5, where accepting a proposal edits the text).

Step 5 as built: `add_comment` and `add_suggestion` in `ai-tools.js` (`AITools.drafts()`), the cards and the three choices in `ai-chat.js`, `Comments.applyReplacement` (the one code path behind both Accept in the Comments tab and Accept now), `ai` in `applyCommentOp`, the AI mark in the Comments tab, in the editor hover and in the authorship list, `window.__aiEdit` in `collab.js` (the accepted text is its own authorship entry, marked, in the person's file), 10 interface strings in 14 languages and `tests/e2e/specs/ai-proposals.test.ts` (13 tests, including two people in live editing). Differences from the text above: an insertion is expressed as a suggestion on the line after which the text goes (the tool description says so); a draft the model proposes twice on the same passage is refused; a file that is not yet in the tree (a pull just brought it) is refreshed before Accept now gives up.

Selection menu as built (1.41.0, asked for by the owner on 2026-11-12): six actions in the editor's context menu for the selected text, described in `AGENTS.md`. Decisions: the instructions are fixed English prompts that also tell the model to reply in the interface language; translation asks the language once and remembers it per account; a passage over 20 000 characters is refused; the actions do nothing but open the panel when the assistant is not set up, and nothing is sent when the project switched it off. `tests/e2e/specs/ai-menu.test.ts` (12 tests). Not done: custom actions the person writes and saves (left for later, as agreed).

Step 6 as built (1.42.0): the preview variable is gone. `config::ai_enabled` is on without a `neoleaf.toml`, off in an institution install unless `[ai] enabled = true`, and `NEOLEAF_AI=off` switches it off anywhere. Privacy page: a paragraph in section 2 (the assistant works the same way: only if turned on, straight from the browser), an item in section 5 (the `neoleaf.ai.*` storage) and a paragraph in section 6 (the AI providers, what is sent, that NeoLeaf does not choose or control them, that the use is charged to the person). Terms: an item in section 4 (own key, provider's terms, responsibility for what is sent, including co-authors' text, and for the cost) and a paragraph in section 5 (answers can be wrong; check every suggestion). Both pages say "Last updated: November 2026"; the new texts are in English, Portuguese, Spanish and Chinese like the rest. `docs/self-hosting.md` and `neoleaf.example.toml` document `[ai]`. **Not done: the owner's check with a real key on a real provider** (see the end of step 2); the whole suite only knows a fake provider, so what real models and real endpoints do is unverified.

Step 7 as built (1.43.0), browser agents (WebMCP): decided with the owner after reading Chrome's documentation (WebMCP is a proposed standard in an origin trial since Chrome 149; the current API is `document.modelContext`, `navigator.modelContext` is deprecated; the third-party `webmcp.dev` library, a widget plus a local bridge with a token, was rejected: it would put third-party script and a local bridge next to the project text). `static/js/ai-webmcp.js` registers the seven tools (five read only, two that make drafts) from their own `AITools.create()` instance, off by default and per account, only when the browser offers the API, with `ai: "off"` checked on every call; proposals are cards in the AI tab and a number on the tab. The privacy page has a paragraph and a storage item, the terms an item (Chrome also warns that extensions can call the tools of a page, and the texts say so). `tests/e2e/specs/ai-webmcp.test.ts` (10) fakes the browser API. **Not verified: no real agent was used** (Chrome's flag `chrome://flags/#enable-webmcp-testing` and the Model Context Tool Inspector extension are the way to try it by hand).

## Goal

A side tab in the editor where a person picks an AI provider, pastes their own API key and talks to an assistant that can read **the open project** and answer, comment on the code and propose changes. Every change goes through the review features that already exist (comments, suggestions, accept and reject). The assistant never writes a file by itself.

Fixed rules for the whole work:
- **Rule number one holds.** The server never sees the key, the prompts, the answers or any project text. Calls go **from the browser straight to the provider the person chose**. There is no proxy and no new server route that carries AI traffic. The only server change allowed is a flag that says whether the feature is on.
- **Nothing happens without the person.** No request leaves the browser until the person has turned the assistant on, accepted the notice and typed a key. Opening the editor never calls a provider.
- **No silent edits.** The assistant has no tool that changes a file, only tools that create a comment or a suggestion draft. Applying anything is the person's click on the existing "Accept".
- **Hidden on the public site until the last step.** Steps 1 to 5 ship with the feature off in production (a server flag, on only in development and tests). It is switched on together with the privacy and terms texts, never before: no version may send project text to a provider while the privacy page does not say so.
- **Institution installs start with it off.** When `neoleaf.toml` exists the assistant is off unless `[ai] enabled = true`. The public site (no file) has it available. Nothing changes for people who never open it.
- Every step ends with: `cargo test`, clippy, fmt, the full E2E suite, and a note of what was and was not verified. Commit, push, deploy and the public copy only when the owner asks, one version bump per delivery.

## What exists today (checked in the code)

- `static/js/comments.js` and `Project.comments` (`project-store.js`, `applyCommentOp`): threads of `kind` `comment` or `suggestion` in `.neoleaf/comments.json` (versioned in Git). A suggestion has `quote` (up to 2000 characters), `range`, `suggestion.replacement` and `suggestion.status` (`pending`, `accepted`, `rejected`). Limits: 500 threads, `MAX_COMMENT_TEXT` per message, 200 messages per thread.
- `accept(th)` finds the passage again, checks that it still equals `th.quote`, applies it with `editor.executeEdits('ld-suggestion', ...)` (so Ctrl+Z and live editing keep working) and records the decision. Only the author can delete a thread (`sameAuthor` compares e-mails).
- `bib-complete.js` is the model for "show the window first, never apply without it".
- Pages under `/project/{id}` have **no Content-Security-Policy** (only the sandboxed iframes do), so a call to a provider needs no header change. It also means a key in `localStorage` is exposed to any XSS: see "Key storage".
- Sign out and "Delete all local data" empty everything the site keeps in the browser except `localStorage` preferences (`storage-manager.js`). **A session that ends by itself (`/auth/logout?expired=1`) deletes nothing**, and several people can use one browser (the Storage tab already separates copies by account).
- The authorship log (`Project.recordAuthorship`, called by `collab.js`) counts what a person's editor inserted. Text accepted from a suggestion is counted as written by whoever accepted it.
- Compiling reads the files from `BrowserGit` **plus the editor's unsaved text**; what is on disk can be a few seconds behind what is on the screen.
- Checked on 2026-11-12 with a CORS preflight from the origin `https://neoleaf.science` (no key, no data): `api.anthropic.com/v1/messages` (with the `anthropic-dangerous-direct-browser-access` header), `api.openai.com/v1/chat/completions`, Gemini's compatible endpoint (`generativelanguage.googleapis.com/v1beta/openai/...`) and `openrouter.ai/api/v1/chat/completions` all allow the call. A real request with a key was not made.

## Design

### Where it lives

A new tab in the editor's side area, next to comments, with a chat. Scripts (classic, no bundler, listed in `src/views/editor_page.rs` after the ones they use): `ai-settings.js` (provider, key, model, notice), `ai-providers.js` (the two adapters), `ai-tools.js` (what the assistant can read and propose), `ai-chat.js` (panel and the loop). Interface texts go through `T()` with an entry in all 14 `i18n-<code>.js` files.

### Providers

Two adapters cover almost everything:
- **Anthropic** (Messages API over `fetch`, no SDK: the editor has no bundler. Headers `x-api-key`, `anthropic-version` and `anthropic-dangerous-direct-browser-access: true`).
- **OpenAI-compatible** (chat completions with tools): OpenAI, OpenRouter, Gemini through its compatible endpoint, and local servers (Ollama, LM Studio). The person gives base URL and model; for a local server the base URL is `http://localhost:...` (the browser allows it from an https page; the server must allow the origin, which the guide will explain).

The model is chosen from **the provider's own list** (`GET /v1/models` on both dialects, asked once the key is typed), with a free text field as the fallback. No model name or price is written in the code, so nothing goes stale when models change.

Rules the Anthropic adapter must follow (current API, they are easy to get wrong):
- The assistant turn is sent back **whole and unchanged** (every content block, thinking blocks included), and the history is **append only**. The adapter never trims or rewrites earlier turns to save tokens; when a conversation gets too long the person starts a new one.
- No sampling parameters (`temperature`, `top_p`, `top_k`), no forced `tool_choice` (always `auto`), no assistant prefill: current models reject them.
- Several tool calls can come in one turn: all their results go back in **one** user message; a failed tool returns `is_error`, never a missing result.
- `stop_reason` is read before the content: `refusal`, `max_tokens` and `pause_turn` each get a clear message instead of a half answer.
- The system prompt and the tool list are sent with `cache_control`, so the repeated part of each step in the loop is billed as a cache read.
- Tool inputs are parsed with `JSON.parse` and validated against the tool's schema before anything runs.

Both adapters take a base URL (shown under "Advanced"), which is also how the tests point them at the fake provider. Streaming answers, tool calls, `429` and `529` with `Retry-After` handled like the other proxies' clients do, a stop button that aborts the request.

### Key storage

Decision for the first version: `localStorage`, **one entry per signed-in account** (`neoleaf.ai.<provider>.<numeric id>`), read only when that same account is signed in. A session can end by itself without deleting anything, so a key that was not tied to an account would be found by the next person who signs in on that browser. The key is **never** sent to the server and never put in a prompt, a log or an error text. Because sign-out is the moment a shared computer matters, **sign out and "Delete all local data" also remove the key** (they ask first, naming it, like they do for unsaved work). A "Forget the key" button sits in the settings. Open question below: session-only or a passphrase-encrypted key.

### What the assistant can read (tools)

Read tools, all answered from `BrowserGit` and `Project` in the browser:
- `list_files`, `read_file(path, from_line, to_line)`, `search(text)`, `open_file_and_selection`, `compile_log`, `list_comments`, `git_diff`.

A file that is open in the editor is read **from the editor** (unsaved text and live edits included), like compiling does; the others from the local clone. Quotes are matched against the same source, so a proposal never refers to text that is no longer on the screen.

Limits that are enforced in code and shown to the person: the path must be **an entry of the file tree** (`FT.entries()`), which is stricter than checking its shape; text files only; at most 60 KB per read and a total per conversation; `.neoleaf/` is hidden except the comments list; binaries and files over the limit are named but not sent; at most 12 tool steps per question, and a ceiling on the input tokens of one question (each step resends the conversation, so the cost grows with the square of the steps). Before sending, the panel shows an estimate in tokens, marked as an estimate; after each answer it shows the real numbers the provider returned (`usage`). It shows tokens, not money: prices differ by a factor of eighty between models and are not known to the code. A "What was sent" view lists the files and sizes of the last question.

### What the assistant can propose (the only writes)

- `add_comment(path, quote, text)`.
- `add_suggestion(path, quote, replacement, text)`.

An insertion is a suggestion whose quote is the line it goes after and whose replacement is that line plus the new text. The quote must exist in the file **exactly once** (otherwise the tool answers with the number of matches so the model can pick a longer quote). The quote and replacement obey the existing 2000 and `MAX_COMMENT_TEXT` limits; at most 20 proposals per answer.

### Drafts first, then the existing review

Proposals do not touch `comments.json`. They appear in the AI tab as cards, each with the passage, the diff and three buttons:
- **Accept now**: applies it with `executeEdits` (the same code path as `accept()`), with no thread left behind.
- **Keep as suggestion** (or **Keep as comment**): creates a normal thread, which then follows the usual flow (reply, accept, reject, resolve) and is pushed with the project.
- **Discard**.

Kept threads are authored by **the person who kept them** (so delete and the other rules keep working) and carry `ai: { name, model }`. The thread shows an "AI" badge in grey, and the message author reads "<name> · AI".

**A name for the assistant.** In the settings the person can give the assistant a name (for example "Reviewer"), which is what appears in comments, suggestions and the authorship log. Rules: up to 40 characters, one line, shown as escaped text; when empty the name is the model id; it is a personal setting kept with the key (per account, in this browser). The name never replaces the facts: the grey "AI" badge cannot be removed and the real model id is always stored and shown on hover, so a name cannot make a machine pass for a colleague. `applyCommentOp` accepts `ai` only as a short validated object; old clients ignore the field.

### Shared projects and authorship

- A project can have several authors, and one of them turning the assistant on sends everybody's text. `.neoleaf/config.json` gets `ai: "off"` (a project setting, versioned): when it is set the tab says the project does not allow the assistant and sends nothing. It is a rule the client follows, not a lock (a collaborator can always copy text out), and the notice says so.
- Text that came from the assistant must not be counted as typed by the person. When a proposal is accepted (now or later from the thread), the authorship log records it as accepted from AI, with the model, in that person's own file.

### Text from the model is only text

Answers are shown as plain text with a small safe subset of formatting (code blocks, lists) built with DOM nodes, never `innerHTML` of model output. Tool arguments are validated like any input. Project text and file contents are **data**: the system prompt tells the model so, and since nothing it does can change a file without a click, an instruction hidden in a `.bib` or a pasted template cannot act by itself.

### Privacy and consent

The first time, a notice explains in plain words: the text of the files the assistant reads goes to the provider the person chose, under that provider's terms, and not through NeoLeaf. It names what is sent, says the key stays in this browser, and needs a click (kept in `neoleaf.ai.consent`). The privacy page gets a paragraph (English, Portuguese, Spanish, Chinese, like the rest of it) and the terms a line saying NeoLeaf does not operate the provider. No text claims legal compliance.

### Out of scope here

Agent that edits many files by itself, creating or deleting files, running code, images and PDFs as input, a server-side shared key, usage billing, and the institution switch beyond the default-off rule.

## Steps and how each one is validated

Each step is one delivery (one version). Step 1 changes no behavior for anyone who does not open the tab.

**Step 1: switch, settings and consent (no network).**
- The settings include the assistant's name. The page knows whether the feature is on (`AI_ENABLED`, false when `neoleaf.toml` exists without `[ai] enabled = true`). New tab with provider, key, model, base URL, consent notice, "Forget the key". Sign out and "Delete all local data" remove the key.
- The key is kept per account. The project setting `ai: "off"` is honored.
- Validation: with the feature off the tab does not exist, no AI script is loaded and no AI string is in the page; nothing is requested before consent; the key never appears in any request to the NeoLeaf origin (the test records every request); sign out removes it; a second account on the same browser (and the first one after its session expired) does not see the first one's key; i18n-complete passes.

**Step 2: provider adapters and a fake provider.**
- `ai-providers.js` with streaming and tool calls for both dialects, errors with readable messages, abort. `tests/fake-ai/server.ts` imitates both APIs with scripted answers (tests never call a real provider).
- Validation: text streaming, a tool call round trip, two tool calls in one turn answered in one message, the assistant turn sent back unchanged (the fake checks it byte for byte), `refusal` and `max_tokens`, `429` with `Retry-After`, a refused key, abort in the middle of a stream, the model list.
- **One real request per provider by the owner at the end of this step** (a one-line question, no project text): the preflight says the call is allowed, only a real key proves it. Finding a surprise here costs a day; finding it in step 6 costs the plan.

**Step 3: read tools and context limits.**
- `ai-tools.js` read tools with the limits above and the "What was sent" view.
- Validation: an open file with unsaved text is read as it is on the screen; path tricks (`..`, absolute, hidden `.neoleaf/`) refused; binary and oversize files named, not sent; totals respected; the project text reaches only the fake provider, never the NeoLeaf origin (request log).

**Step 4: the chat panel and the loop.**
- Panel, streaming, stop, step cap (12), token and size estimate before sending, retry, a new conversation per project (kept only in memory unless the person asks to keep it).
- Validation: a question that needs two tool calls; the cap stops a runaway model; stop really aborts; closing the tab ends the loop; an open collaborative session is untouched.

**Step 5: proposals, drafts and review.**
- `add_comment` and `add_suggestion`, the cards, **Accept now**, **Keep**, **Discard**, the AI badge, `ai` in `applyCommentOp`.
- Validation: accepted text is recorded as accepted from AI in the authorship log; a quote that matches once, zero times and twice; a passage edited after the proposal (accept refuses, as `accept()` does today); Ctrl+Z after Accept now; with live editing the change reaches the other participant; kept threads survive a reload and a push and show the badge; a thread with `ai` from a newer client does not break an older one; the 500-thread ceiling is reported, not crashed into; a name with HTML or a line break is shown as plain text, an empty name falls back to the model id, and the badge and the model id are there whatever the name is.

**Step 6: texts, documents and the real run.**
- **The switch is turned on for the public site here**, with the privacy and terms paragraphs, `AGENTS.md` (new section and the exception to "the server stores nothing" being unchanged), `docs/self-hosting.md` (the `[ai]` switch and local models), release notes, i18n in 14 languages.
- Validation: the complete suite; a manual run by the owner with a real key on a real provider, reported as such (the suite only uses the fake provider, so real model behavior, provider limits and CORS from the real endpoints are verified only here).

## Risks to keep in mind

- **Cost is the person's**: a long project and many steps can spend real money. The estimate and the caps are the protection; say so in the notice.
- **A key in `localStorage`** is exposed to XSS. A Content-Security-Policy for the app pages is a separate, worthwhile task; it should be done before or soon after this ships.
- **Real providers differ from the fake**: tool-call formats, streaming details and CORS can surprise. The adapters are kept small so a surprise is a small fix.
- **Models make mistakes**: the whole design (drafts, exact quotes, accept by click) exists so a wrong proposal costs a click, not a lost paragraph.
- **Privacy wording** must stay literal: what is sent, to whom, and that NeoLeaf does not see it.

## Open questions for the owner

1. (Decided 2026-11-12: the standard way. The person picks the provider and pastes an API key, kept in `localStorage` per account and removed on sign out. No OAuth sign-in for now; OpenRouter's and Hugging Face's browser OAuth were checked and stay as a possible shortcut later. Isolating the key in another origin stays as a possible hardening.)
2. (Answered by the review: the model list comes from the provider, nothing is written in the code.)
3. (Decided 2026-11-12: the conversation survives a reload. It is kept in `localStorage`, per account and per project, and "New conversation" clears it; sign out and "Delete all local data" remove it with the key.)
4. Local models (Ollama, LM Studio): proposed **right after** the first delivery, not in it. An https page calling `http://localhost` works in Chrome and Firefox, but Chrome now asks the person for local network permission, Safari may block it, and the local server must be told to accept the origin (`OLLAMA_ORIGINS`). It needs its own guide and its own tests.
5. (Decided 2026-11-12: allowed unless a collaborator turns it off with `ai: "off"` in the project settings.)
6. (Decided 2026-11-12: the authorship panel shows "accepted from AI" as its own line.)

## What the review changed (2026-11-12)

Found by reading the plan against the code and the providers' current rules:
1. **Deploy order was unsafe**: each step was a delivery to the public site, but the privacy text came last. The feature now stays off in production until step 6.
2. **The key could leak between people on one browser**: an expired session deletes nothing. The key is now stored per account.
3. **Co-authors had no say**: added the project setting.
4. **AI text would be counted as the person's writing** in the authorship log: accepted proposals are now recorded as such.
5. **Reads could be stale**: the tools now read open files from the editor, not from disk.
6. **"Same validation as `valid_file_path`"** pointed at a Rust function; the browser check is membership in the file tree.
7. **Model names and prices in the code** would go stale: the list comes from the provider and the panel shows tokens, not money.
8. **Anthropic loop details** (whole assistant turn sent back, append-only history, no forced tool choice, no sampling parameters, refusal handling, caching) were missing and each one is an error or a silent failure on current models.
9. **The real-provider check was at the very end**: one real request per provider now closes step 2. CORS itself was checked today by preflight and is fine on the four hosts.
10. "Byte-identical page" in step 1 was not achievable as written; the check is now "no AI script and no AI string when off".
