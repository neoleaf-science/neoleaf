# Plan: your own Git server as the sign-in provider

Status: **proposal, nothing implemented yet** (written 2026-10-30, after 1.35.0 shipped the `neoleaf.toml` file with brand, legal links and the two built-in providers).

## Goal

An institution (university, institute, company) installs NeoLeaf and points it at **its own Git server** (Forgejo, Gitea, later GitLab, or GitHub Enterprise). People sign in with the server's own login (which already federates with CAFe, Google, LDAP, whatever the institution uses), and their projects are repositories on that server. NeoLeaf still stores no identity and no project.

Fixed rules for the whole work:
- **The public site must not change.** Without `neoleaf.toml` everything behaves as in 1.35.0. Every step is checked against that.
- GitHub and Codeberg keep their ids (`github`, `codeberg`), their routes (`/auth/login`, `/auth/login/codeberg`, `/auth/callback...`) and their on-disk and in-browser names. Nothing a person already has is renamed or lost.
- Secrets stay out of the file (`client_secret_env`), no HTML from the file, every identifier that enters a URL is validated (`src/ids.rs`).
- Every step ends with: `cargo test`, clippy, fmt, the full E2E suite, and a note of what was and was not verified. Commit, push, deploy and the public copy only when the owner asks, one version bump per delivery.

## What exists today (checked in the code)

- `Provider` is a closed enum (`GitHub`, `Codeberg`) in `src/provider.rs`, `Copy`, used as a map key and serialized as `"github"` / `"codeberg"` in `sessions.json` and `blocked.json`. About 150 uses across `blocklist.rs` (37), `auth_routes.rs` (17), `session.rs` (15), `admin_routes.rs` (10), `drive/client.rs`, views, `git_proxy.rs`, `collab.rs`.
- The client also knows the two names: `static/js/browser-git.js` (local clone folder `codeberg.<owner>`), `storage-manager.js` (lists and deletes those folders), `ci-workflow.js` (disabled for Codeberg).
- `DriveClient` talks GitHub-style paths and rewrites them for Forgejo (`/api/v1`, topics, direct collaborator join, ZIP path). The Git proxy authenticates as `x-access-token:<token>` (GitHub) or `<login>:<token>` (Forgejo).
- Administration is only for GitHub (`ADMIN_GITHUB_IDS`). Codeberg sessions are never admin.
- Verified for real: GitHub (production) and **Codeberg** (2026-10-30: sign-in, create project, edit, sync). Everything else was only checked against the fake server.

## Design

### Providers become configuration

`[providers.<id>]` in `neoleaf.toml`. The built-ins keep working as they do; a new id is a **custom provider**:

```toml
[providers.git-ifto]
kind = "forgejo"                  # forgejo | gitea | github-enterprise now; gitlab later
url = "https://git.ifto.edu.br"   # https only (http only for localhost)
label = "IFTO account"            # text of the button
enabled = true
client_id = "..."
client_secret_env = "GIT_IFTO_SECRET"
admins = ["12", "34"]             # numeric ids of this server's users
```

- `Provider` stays a small `Copy` handle (so the many `match`/map-key uses keep compiling): `GitHub`, `Codeberg`, `Custom(u8)` pointing into a table built once from the file (at most 8 custom providers). `id()`, `label()`, `web()`, `api()`, `kind()`, `redirect_uri()` read from that table. Serialization stays the id string.
- `kind` decides the API dialect: `GitHub` (also GitHub Enterprise: `url` gives the web address, the API is `<url>/api/v3`), `Forgejo` (Forgejo and Gitea, `<url>/api/v1`), `GitLab` (later, own adapter).
- Routes: the built-ins keep theirs; custom ones use `/auth/login/{id}` and `/auth/callback/{id}`, with `{id}` checked against the table (letters, digits, hyphen).
- Several providers at once are allowed (the sign-in screen lists one button per enabled provider).
- Different providers never mix: editing rooms, the local clone folder and the blocklist already include the provider; custom ones use `<id>.<owner>` the way Codeberg uses `codeberg.<owner>`.

### What must stay true when a provider disappears from the file

`sessions.json` and `blocked.json` may mention an id the file no longer has (a provider commented out for a day). Loading must **not discard or rewrite those entries**: sessions of an unknown provider are kept inert (not usable, not shown, not evicted into oblivion) and blocked entries are kept as they are. Tests cover this, with a file written by 1.35.0 as the fixture.

### Administrators

`admins = [...]` per provider (numeric ids; never logins or e-mails). The built-in rule for GitHub (`ADMIN_GITHUB_IDS`) is unchanged. A provider with no `admins` has no administrator. The admin page names providers by their label and validates a login with the dialect's rules.

### Out of scope here

GitLab (own plan, see the end), SAML/OIDC directly in NeoLeaf (the forge does that), a default group or organization for new repositories (open question below), branding outside the sign-in screen.

## Steps and how each one is validated

Each step is one delivery (one version). Order matters: step 1 changes no behavior.

### Step 1: `Provider` as a table-backed handle (no behavior change)

**Status: done in 1.35.1, narrowed.** The `Kind` (API dialect) and every dialect decision behind it landed, plus the Forgejo auth functions taking the provider as a parameter and golden tests of the old file shapes. The table-backed `Custom(u8)` handle itself moves to step 2, where it first has a use (adding it now would only be dead code). Identity checks that mean "github.com" (administrators, the template catalog, revoking the grant, the editing-room key) are left as they are until step 3.
- Replace the closed enum by the handle described above, with only `GitHub` and `Codeberg` in the table. Move the API and Git-auth differences behind `kind()`.
- Validation:
  - `cargo test` unchanged and green; new tests: id round trip, unknown id error, handle is `Copy + Hash`.
  - **Golden files**: a `sessions.json` (sealed) and a `blocked.json` written by 1.35.0 load identically and are written back byte-compatible (same JSON shape).
  - Full E2E suite unchanged (564 passing as of 1.35.0), including `codeberg.test.ts`, `blocklist.test.ts`, `auth.test.ts`, `collab-*`.
  - Production check after deploy: landing, `/auth/login` redirect, Terms, Privacy, as for 1.35.0.

### Step 2: custom providers of kind `forgejo` and `gitea` in `neoleaf.toml`

**Status: done in 1.36.0** (checked against the fake Forgejo; the real Forgejo and Gitea runs are step 5). The handle is `Provider::Custom(&'static str)`, interned, instead of an index into a table: ids found in the files on disk are kept as data even when the file does not know them. `tests/e2e/specs/forge-provider.test.ts` covers the sign-in screen, off or unknown providers, the full OAuth flow, the Git proxy, the local folder `git-test.demo`, sharing, tags, ZIP, and a session that survives the provider leaving the file and comes back with it. Per-provider administrators are step 3.
- Config parsing and validation (`kind`, `url`, `label`, `admins`, limits), table construction, `/auth/login/{id}` and `/auth/callback/{id}`, sign-in screen buttons (generic icon with the label), per-provider redirect URI (`<REDIRECT base>/auth/callback/<id>`), `--check-config` lines, token refresh as for Codeberg.
- Validation:
  - Unit tests for every config error (bad kind, `http://` URL, duplicate or reserved id, too many providers, secret instead of variable name).
  - The fake server answers as a second Forgejo instance (another base path/port); E2E: two custom providers plus GitHub at once, sign in with each, same `owner/repo` on two providers does not mix (rooms, clone folder, blocklist).
  - A provider switched off or absent from the file cannot be used by typing its address.
  - Public-site regression: without the file, no new route answers (404) and the home page is byte-identical.

### Step 3: administrators and blocking per provider

**Status: done in 1.37.0.** `admins = [ids]` per provider in `neoleaf.toml` (any provider, numeric ids), the old GitHub rule untouched when no list is given, the Templates tab hidden for non-GitHub administrators. Blocking was already per provider and the login rules already came from the provider's dialect (step 1); `forge-provider.test.ts` now covers an administrator of the own server, a non-administrator, and block, sign-in refused and unblock by login.
- `admins` per provider, admin page and block/unblock by provider, login validation by dialect.
- Validation: unit tests of `is_admin` (id in list, id of another provider, login or e-mail never counts); E2E for the admin page with a custom-provider admin and a non-admin; `ADMIN_GITHUB_IDS` behavior unchanged.

### Step 4: the browser side

**Status: done in 1.37.1.** Most of it landed with step 2 (`<id>.<owner>` folders, the storage list with the provider badge, no CI workflow offer outside GitHub). Step 4 added the browser tests and found one old bug: `BrowserGit.init` could be running for an unknown user while another call set it, so the "who opened this copy" record of `demo/<repo>` named the signed-in provider instead of the folder's own (fixed: the provider is read from the folder name). `forge-provider.test.ts` now covers copies of earlier versions (GitHub and Codeberg folders with the same owner and name), that only this provider's copy is listed as the account's, that "Clear" removes only that copy, and that opening the project again downloads it into the provider's own folder. Texts that still say "GitHub or Codeberg" (the confirm dialogs and the Clear tooltip) were left as they are: they are translated in 14 languages and say nothing wrong for the server of an institution.
- Generalize `codeberg.<owner>` to `<providerId>.<owner>` in `browser-git.js`, `storage-manager.js` and the account modal; `ci-workflow.js` only offered for GitHub kinds.
- Validation: E2E in the browser with a custom provider (open, edit, sync, delete local data); copies made by earlier versions (`<owner>` for GitHub, `codeberg.<owner>` for Codeberg) are still listed and removable; the i18n completeness test stays green.

### Step 5: real servers

**Status: done in 1.37.2 for Forgejo and Gitea; GitHub Enterprise is still not verified on a real instance.** `scripts/dev_forge.sh` starts a real Forgejo 17.0.0 or Gitea 28.0.0 in Docker (pinned images, SQLite, two or three test accounts, an OAuth2 application) and `scripts/test_forge_real.sh` (`mise run test:forge`) runs `tests/e2e/specs/forge-real.test.ts` against each: the real login and authorization pages, creating a project (template files pushed with the OAuth token), the Git proxy clone, a commit pushed from the browser, a pull of a change made on the server, sharing with a non-administrator account (joins directly, role read back, role change, removal), tags, ZIP, delete and restore, and a push **after the 90-second OAuth token expired** (renewal with the refresh token). Both servers pass all 10 tests.

What the real servers found that the fake one could not (all fixed in 1.37.2):
1. **Restoring a project from the trash failed on Forgejo and Gitea.** Both keep a redirect from the old name of a renamed repository, so asking for the original name answered with the trashed repository and NeoLeaf thought the name was taken. Now only a repository that really has that name blocks the restore (`name_is_taken`).
2. **A project created or imported in NeoLeaf (empty when first opened) could not pull.** `git init` leaves no fetch refspec and isomorphic-git answers `NoRefspecError`; the pull and the "remote changes" check silently never worked for those projects, on every provider including GitHub. The refspec is now added when it is missing (`ensureFetchRefspec`), for new and for existing local copies.
3. `BrowserGit.isCloned()` started a project for a placeholder user (the GitHub-looking default of that file) when called before the editor had set the real one; it now uses the page's real user or returns false.

Not covered by the real runs: GitHub Enterprise, GitLab, a Forgejo or Gitea behind HTTPS with a private CA, and an instance whose administrator restricts who can create repositories (see the open question about a default group).
- Run a **real Forgejo and a real Gitea in Docker** (`mise run dev:forgejo`, `mise run dev:gitea`, pinned image tags, SQLite, admin and OAuth app created by script) and walk the whole flow against each: sign in, create project, edit, sync (clone and push with the OAuth token), invite a collaborator, delete and restore. Record the results in this file.
- GitHub Enterprise cannot be reproduced locally: it is implemented from the documented API (same shapes as github.com) and marked **not verified on a real instance** until someone runs it.
- Differences found (token lifetime and refresh, topics, collaborator invitation, rate limits) get a fix and a test each.

### Step 6: easy installation
- `docker-compose.yml` with NeoLeaf and Caddy (automatic HTTPS), and an optional Forgejo already wired as the provider, for institutions with no Git server; `neoleaf init` asks for domain, administrator and brand, writes `neoleaf.toml` and `.env` (random `SESSION_KEY`), and refuses to overwrite files. Install guide for administrators (what to create on the Git server: the OAuth application, its redirect URI and the scopes).
- Validation: on a clean temporary directory, `neoleaf init` then `docker compose up`, sign in through the bundled Forgejo, create a project and compile it; the same from the unpacked release archive. Anything that needs a public domain (real HTTPS) is checked as far as a local name allows and marked as such.

### Step 7: release
Version bump per delivery (steps 1 to 4 and 6 are features: minor; a fix found in step 5 is a patch), release note, `docs/self-hosting.md`, `neoleaf.example.toml`, `AGENTS.md`, public copy on request.

## GitLab (separate plan, after the above)

GitLab is a new adapter, not a configuration: projects are addressed by numeric id or URL-encoded path (`/api/v4`), roles are access levels, collaborators come from project members, topics differ, the Git over HTTP user is `oauth2`, and the OAuth token and refresh follow GitLab's rules. It gets its own plan, a GitLab container for real tests (the image is large) and its own delivery. `kind = "gitlab"` is rejected at startup with a clear message until it exists.

## Open questions for the owner

1. **Where do new repositories go?** Many institutions do not let students create repositories at the root of their account, only inside a group. Do we need a `default_owner` (group or organization) per provider, or is a student's own namespace enough for the first release?
2. **Instance limit**: is 8 custom providers per installation enough (it is only a safety bound)?
3. **Names**: `kind = "forgejo"` and `kind = "gitea"` behave the same here; keep both words in the file so people write what they run?
4. **GitHub Enterprise** as `kind = "github"` with a `url`: accept shipping it "implemented from the documentation, not verified on a real instance"?
