# Contributing to NeoLeaf

Thank you for your interest. Read [AGENTS.md](AGENTS.md) first: it is the guide for people and code assistants and it has the architecture, the security rules and the conventions of the project. The rule that matters most: **the server never stores, caches or logs the content of a project.**

## Setting up

```bash
mise run setup          # creates .env from .env.example
mise run dev:fake       # local server with a fake GitHub, no account needed
mise run test           # Rust tests
mise run test:e2e       # browser tests (Playwright with Bun), uses the fake GitHub
```

## Conventions

- Everything in the repository is **English**: code, comments, documentation and commit messages. The interface texts go through `T('...')` and get their Portuguese, Chinese and Spanish translations in `static/js/i18n-dict.js`.
- Plain JavaScript in the browser, no bundler. Rust 2024 on the server.
- Commit messages: `type: summary` (`feat`, `fix`, `refactor`, `chore`, `visual`).
- Every bug fix comes with a test that fails before the fix and passes after it.
- Each delivered change bumps the version in `Cargo.toml` (`MAJOR.MINOR.PATCH`, see `AGENTS.md`).

## Pull requests

Keep them small and focused, explain the why, and say what you did **not** verify (for example: only tested against the fake GitHub, only in Chromium). Architecture changes are discussed in an issue first.

## Security issues

Do not open a public issue: see [SECURITY.md](SECURITY.md).

## License of contributions

Unless you explicitly state otherwise, any contribution you intentionally submit for inclusion in NeoLeaf is dual-licensed under the MIT License and the Apache License 2.0, as the rest of the code, without any additional terms or conditions.
