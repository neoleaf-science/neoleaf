# NeoLeaf functional (E2E) tests

They open a real Chromium (Playwright, run with Bun), start the server (port 3001) pointed at a fake GitHub (`tests/fake-github/server.ts`: API, OAuth and the Git protocol over bare repositories on disk) with a temporary workspace and sessions folder, and drive the application.

The fake GitHub exercises the Git proxy and the API for real, but it does not reproduce everything about real GitHub (limits, error messages, organizations).

| File | What it covers |
| --- | --- |
| `specs/auth.test.ts` | full OAuth, project dashboard, profile, visitor without a session, logout |
| `specs/editor.test.ts` | file tree, `.bib` <-> `.tex` switching (`collabStop` regression), edits that survive a switch, Monaco language, tabs, console errors |
| `specs/compile.test.ts` | WASM compilation, rendered PDF, LaTeX error diagnostics |
| `specs/tree.test.ts` | create/rename/delete in the tree (existing name, open file, non-empty folder) and concurrent `switchFile` |
| `specs/security*.test.ts` | XSS, identifier validation, live-edit limits, ZIP import, path guards |
| `specs/import.test.ts` | binaries in BrowserGit, ZIP import (no stray README/main.tex), file in a subfolder |

## Running

```bash
mise run test:e2e                    # everything
cd tests/e2e && bun test specs/editor.test.ts --timeout 180000   # one file
HEADED=1 mise run test:e2e           # with the browser visible
E2E_BASE_URL=http://127.0.0.1:3000 mise run test:e2e   # against a server that is already running
```

`helpers.ts` holds the server, the browser and the shortcuts (`newSession`, `openProject`, `openInTree`); `setup.ts` starts and stops the server once.
