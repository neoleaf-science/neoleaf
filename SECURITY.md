# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Write to **contact@neoleaf.science** (or use GitHub's private vulnerability reporting on this repository) with:

- what you found and where (URL, file or route);
- steps to reproduce, and the impact you think it has;
- the version you tested (the admin panel shows it, and `Cargo.toml` has it).

You will get an answer as soon as possible. Please give us reasonable time to fix the problem before you publish details.

## What is in scope

- The NeoLeaf server (`src/`), the browser code (`static/js/`) and the local agent (`agent/`).
- The design rule that **a project's content never stays on the server** (see `AGENTS.md`, section 1): a way to make the server store, cache or log project content is a vulnerability.

## Supported versions

Only the latest release is supported.
