#!/usr/bin/env bash
# Assembles the folder of a server release (what .github/workflows/release-server.yml puts in the tar.gz): the executable, the landing
# page, the base TeX engine, the install files (Dockerfile, compose, setup script), the licenses and the self-hosting guide.
#   scripts/package_release_dir.sh OUT_DIR [BINARY]      BINARY defaults to target/release/neoleaf
# Only files that git tracks are copied from static/texlive (the other engines are generated and not part of the release).
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:?usage: $0 OUT_DIR [BINARY]}"
bin="${2:-target/release/neoleaf}"
[ -f "$bin" ] || { echo "no binary at $bin (build it first)" >&2; exit 1; }
mkdir -p "$out"
cp "$bin" "$out/neoleaf"
cp .env.example LICENSES.md "$out/"
# the license texts are added to the public copy by publicacao/make-public-repo.sh; in the private repository they may be missing
for f in LICENSE-MIT LICENSE-APACHE LICENSE-ART NOTICE ART.md; do [ -f "$f" ] && cp "$f" "$out/" || true; done
[ -f docs/self-hosting.md ] && cp docs/self-hosting.md "$out/SELF-HOSTING.md" || true
cp neoleaf.example.toml "$out/"
cp -r site "$out/site"
cp -r install "$out/install"
git ls-files -z static/texlive | xargs -0 -I{} cp --parents {} "$out/"
echo "release folder ready: $out"
