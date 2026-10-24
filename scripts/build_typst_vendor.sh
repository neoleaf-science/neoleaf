#!/bin/sh
# Rebuilds static/vendor/typst-engine.min.js: the JavaScript side of the Typst compiler (typst.ts, Apache-2.0) as one classic script for the Typst
# worker. It sets `self.NeoTypst = { TypstSnippet, MemoryAccessModel }`. The WebAssembly compiler and the fonts come from
# scripts/fetch_typst_assets.py (the versions must match).
# Needs node (npm) and bun.
#   sh scripts/build_typst_vendor.sh
set -e
cd "$(dirname "$0")/.."
VERSION=0.7.0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --silent "@myriaddreamin/typst.ts@$VERSION" "@myriaddreamin/typst-ts-web-compiler@$VERSION" "@myriaddreamin/typst-ts-renderer@$VERSION"
cat > entry.js <<'JS'
import { TypstSnippet } from '@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs';
import { MemoryAccessModel } from '@myriaddreamin/typst.ts/dist/esm/fs/memory.mjs';
self.NeoTypst = { TypstSnippet, MemoryAccessModel };
JS
bun build entry.js --target=browser --format=iife --minify --outfile=typst-engine.min.js
# the wasm-bindgen glue falls back to `new URL('...wasm', import.meta.url)` when no module is given; a classic worker cannot contain import.meta
# (the worker always passes its own address, so that branch never runs)
sed -i 's/import\.meta\.url/self.location.href/g' typst-engine.min.js
cd - >/dev/null
cp "$WORK/typst-engine.min.js" static/vendor/typst-engine.min.js
cp "$WORK/node_modules/@myriaddreamin/typst.ts/LICENSE" "$WORK/LICENSE.typst.ts" 2>/dev/null || true
echo "static/vendor/typst-engine.min.js: $(wc -c < static/vendor/typst-engine.min.js) bytes (typst.ts $VERSION)"
