# AI apps and NeoLeaf (MCP bridge)

AI apps that speak MCP (Claude Code and Claude Desktop, Codex, VS Code, Antigravity and others) cannot reach a web page by themselves.
`tools/mcp-bridge/neoleaf-mcp.mjs` is a small program, with no dependencies (Node 20 or newer), that runs **on the person's computer**
and connects them to the NeoLeaf editor tab that is open in the browser.

```text
AI app  --MCP-->  neoleaf-mcp.mjs (127.0.0.1)  <--HTTP long poll--  editor tab (static/js/ai-bridge.js)
```

Nothing goes through the NeoLeaf server, and the server stores nothing (AGENTS.md, rule number one). The project text leaves the browser
only as the answer to a call that an app the person paired asked for, and goes to that app, under its own terms.

## What an app can do

The same tools as a browser agent (`ai-webmcp.js`, `ai-tools.js`): `list_files`, `read_file`, `search`, `compile_log`, `list_comments`
(read), `compile` (runs the compiler the person chose), and three that only make **drafts**: `add_comment`, `add_suggestion` and
`propose_file` (create a file or replace the whole of one). Drafts appear as cards in the AI tab; **only the person's click applies them**.
There is no tool that writes a file. The project switch (`ai: "off"`) and the reading limits are checked on every call.

## Use

1. Start the bridge and leave it open: `node tools/mcp-bridge/neoleaf-mcp.mjs`. It prints a 6 digit pairing code and keeps a token in
   `~/.neoleaf-mcp/token` (mode 600).
2. In the editor open the **AI** tab, find **Local AI apps (MCP bridge)**, type the code and press **Pair with the bridge**.
3. Add the bridge to the AI app.
   * HTTP (Claude Code, VS Code, Codex and others that support it): `http://127.0.0.1:47480/mcp` with the header
     `Authorization: Bearer <token>`. Claude Code: `claude mcp add --transport http neoleaf http://127.0.0.1:47480/mcp --header "Authorization: Bearer <token>"`.
   * Command (Claude Desktop and apps that start MCP servers): `node /path/to/neoleaf-mcp.mjs --stdio`. The command finds the token itself.

Options: `--port 47480`, `--origin https://your-neoleaf.example` (repeatable; `https://neoleaf.science` and `localhost:3000` are built in).

## Security

* Listens only on `127.0.0.1`; the `Host` header must be this machine (no DNS rebinding).
* The app side (`/mcp`) needs the bearer token; a browser origin that is not NeoLeaf's is refused.
* The tab side (`/page/*`) answers only to NeoLeaf's origins and needs the pairing code, which a page cannot guess and which changes
  after every pairing. One tab at a time. The tab keeps the token it received in `localStorage` (`neoleaf.ai.bridge.<account>`), removed
  when signing out or deleting local data.
* The person confirms before pairing; **Disconnect the bridge** forgets the token.
* What an app reads is the person's project, including co-authors' text: the bridge's instructions tell the app to treat it as data.

Chrome may ask to allow this site to reach devices on the local network the first time.
