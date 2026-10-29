# Dependency update plan

Status on 2026-10-29. Versions come from `cargo outdated -R`, `bun outdated` and `npm view`.

## Rules for every phase
- One commit per phase (`chore:`); `cargo fmt`, `cargo clippy`, `cargo test` and the E2E specs named below after each step.
- Full E2E suite before each deploy (known flakes: `log-diagnostics` first-load timeout, the `git.test.ts` reset test).
- Vendored JavaScript: only versions published more than 2 weeks ago, checked against the npm `integrity` and `shasum`, SHA-256 recorded in `LICENSES.md`.
- Each delivered phase bumps the version (Cargo.toml, Cargo.lock, `publicacao/CITATION.cff`) and adds a line to `publicacao/RELEASE_NOTES-public.md`.

## Phase 0: Topcoat 0.10.0 -> 0.11.0 (done)
No code change. Rust 1.99 is required (installed: 1.99.1). Checked: build, clippy, 80 unit tests, 39 E2E tests (auth, collab, landing, editor, account, admin).

## Phase 1: low risk (1.31.8, with Topcoat)
| Item | From | To | Validation |
|---|---|---|---|
| tokio | 1.53.2 | 1.54.1 | unit tests; E2E `collab-*`, `import*` |
| serde_json | 1.0.151 | 1.0.154 | unit tests; E2E `auth`, `admin-*` |
| zip | 9.0.5 | 9.1.3 | `ctan::sanitize` tests; E2E `import`, `import-large`, `import-detect`, `submission` |
| libc | 0.2.190 | 0.2.191 | `cargo check` |
| ksni, serde_json (agent) | 0.3.6, 1.0.151 | 0.3.7, 1.0.154 | `cargo check` in `agent/`; E2E `agent*` |
| playwright, @types/bun | 1.64.0, 1.4.2 | 1.64.1, 1.4.4 | one browser spec (`landing`) |
| marked (vendored) | 18.0.14 | 18.1.1 (18.1.2 is under 2 weeks old) | E2E `markdown-preview`, `markdown-editor`, `notebook` |
| DOMPurify (vendored) | 3.4.16 | 3.4.17 | same specs, plus `privacy-statements` |

## Phase 2: major Rust versions (1.32.0), done 2026-10-29 (sha2, rand, base64, windows-sys; zbus kept)
1. **sha2 0.10 -> 0.11** (`src/ctan/cache.rs`, `agent/src/{net,project,auth}.rs`): `ctan::fetch` and `ctan::index` tests (they check SHA-512), known-vector tests for SHA-256, E2E `agent-update`, `agent-service`.
2. **rand 0.9 -> 0.10** (`session.rs`, `routes/http.rs`, `agent/src/*`): the API names change often, so the compiler decides; E2E `auth`, `account-delete`, `collab-security`, `agent-rc`; a test that draws 10 000 values and checks there are no repeats.
3. **base64 0.22 -> 0.23 in the agent** (the server already uses 0.23): E2E `agent-context`, `agent-subdir`, `agent`.
4. **windows-sys 0.60 -> 0.61** (agent): `cargo check --target x86_64-pc-windows-gnu` (cross-check only; it was not run on Windows). **zbus stays on 5**: `ksni` 0.3.7 still depends on zbus 5, and the agent uses the same version to read the D-Bus tray registration.

## Phase 3: JavaScript with more risk (1.32.x), one per version, screenshots before and after
1. **KaTeX 0.18.10 -> 0.19.1**: only after 2026-11-06 (published 2026-10-23). E2E `math-preview`, `notebook`, `markdown-preview`; known formulas; the 20 `.woff2` fonts and the CSS still load; update `LICENSES.md`.
2. **Mermaid 11.17.2 -> 12.2.0** (major, 3.5 MB bundle): E2E `mermaid-preview`; a fixed set of diagrams (flow, sequence, class, Gantt, mind map) compared before and after; console free of CSP or `securityLevel` errors.
3. **isomorphic-git, lightning-fs, Yjs**: first find the embedded versions (`NOTICES.md` does not record them). If behind: E2E `git` (run three times), `clone-safety`, `legacy-paths`, `history`, `collab-*`.

## Phase 4: libraries loaded from the CDN (1.33.0)
1. **pdf.js 3.11.174 -> 6.4.299** (four majors): contact points are `GlobalWorkerOptions.workerSrc`, `getTextContent` (double click on the PDF) and page rendering; the module/worker layout changed in 4.x. E2E `synctex-refine`, `compile`, `compile-engines`, `editor`; real PDFs (147-page dissertation, large figure, accented text); zoom, scroll, double click on a title, a paragraph and a margin; check the CDN URL and `integrity`, and the privacy policy.
2. **Monaco 0.45.0 -> 0.57.0**: raise in steps (0.45 -> 0.50 -> 0.57) to find where it breaks. E2E `editor`, `editor-toolbar`, `badness`, `bib-complete`, `typst`, `markdown-editor`, `spellcheck`, `outline`, `context-language`; by hand: shortcuts, selection, paste, per-person wrap (Alt+Z), monospaced font, collaboration cursors with two tabs.

## Not done without a decision
- Visible editor changes without screenshots before and after.
- `windows-sys` if it cannot be built for Windows here.
- Mixing phases in one commit.
