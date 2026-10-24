#!/bin/sh
# Rebuilds static/vendor/hunspell-asm.min.js: Hunspell compiled to WebAssembly (hunspell-asm) as one classic script for the spell check worker.
# Needs node (npm) and bun. The bundle sets `self.HunspellAsm = { loadModule }`.
#   sh scripts/build_spell_vendor.sh
set -e
cd "$(dirname "$0")/.."
VERSION=4.0.2
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --silent "hunspell-asm@$VERSION"
cat > entry.js <<'JS'
import { loadModule } from 'hunspell-asm/dist/cjs/index.js';
self.HunspellAsm = { loadModule };
JS
bun build entry.js --target=browser --format=iife --minify --outfile=hunspell-asm.min.js
cd - >/dev/null
cp "$WORK/hunspell-asm.min.js" static/vendor/hunspell-asm.min.js
echo "static/vendor/hunspell-asm.min.js: $(wc -c < static/vendor/hunspell-asm.min.js) bytes (hunspell-asm $VERSION)"
