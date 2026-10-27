#!/bin/sh
# Rebuilds static/vendor/badness-engine.js and static/vendor/badness-engine_bg.wasm: Badness (MIT, https://github.com/jolars/badness) behind the small shim in
# tools/badness-wasm, which formats LaTeX and BibTeX and reports syntax errors and style findings with their fixes. The commit of Badness is pinned in
# tools/badness-wasm/Cargo.toml (and listed in static/vendor/NOTICES.md).
# Needs rustc with the wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown) and wasm-bindgen-cli 0.2.129 (cargo install wasm-bindgen-cli --version 0.2.129).
#   sh scripts/build_badness_vendor.sh
set -e
cd "$(dirname "$0")/../tools/badness-wasm"
cargo build --release --target wasm32-unknown-unknown --locked
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
wasm-bindgen target/wasm32-unknown-unknown/release/neoleaf_badness_wasm.wasm --target no-modules --no-typescript --out-name badness-engine --out-dir "$OUT"
cp "$OUT/badness-engine.js" "$OUT/badness-engine_bg.wasm" ../../static/vendor/
ls -l ../../static/vendor/badness-engine.js ../../static/vendor/badness-engine_bg.wasm
