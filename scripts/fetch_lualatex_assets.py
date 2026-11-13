#!/usr/bin/env python3
"""Downloads the LuaLaTeX engine for WebAssembly and the texmf-core-lualatex package.

Same version as the rest of the compiler (texlive-wasm v0.4.0-alpha). Checks the SHA-256 of each file against the values
fixed in this file and installs into static/texlive/:

    static/texlive/lualatex/emscripten/lualatex.js|wasm
    static/texlive/texmf-core-lualatex.tar.gz

Usage:  python3 scripts/fetch_lualatex_assets.py
"""
import hashlib
import io
import json
import os
import sys
import tarfile
import urllib.request

TAG = "v0.4.0-alpha"
# The original repository (typeward/texlive-wasm) is gone; the same packages are republished in this fork (2026-11).
BASE = f"https://github.com/tassiovirginio/texlive-wasm/releases/download/{TAG}"
# SHA-256 of each package, fixed here: a download is checked against these, never against a file fetched with it.
SUMS = {
    "lualatex-emscripten.tar.gz": {"sha256": "0f3544e344bfdf04067bc04ae446c3bcaf34ab784ba2beb5ab867f221699d708"},
    "texmf-core-lualatex.tar.gz": {"sha256": "5585f6e44f1575fe5b2a4c2bcf4e3eaead9f5b4488f831864cc585a9f07c01de"},
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "static/texlive")
CACHE = os.path.expanduser("~/.cache/latexdrive-fonts")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "LatexDrive-assets"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def download(name, expected):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{TAG}-{name}")
    if os.path.exists(path) and hashlib.sha256(open(path, "rb").read()).hexdigest() == expected:
        return open(path, "rb").read()
    print(f"  downloading {name}")
    data = get(f"{BASE}/{name}")
    got = hashlib.sha256(data).hexdigest()
    if got != expected:
        sys.exit(f"SHA-256 mismatch for {name}: expected {expected}, got {got}")
    open(path + ".part", "wb").write(data)
    os.replace(path + ".part", path)
    return data


def unpack_engine(archive_bytes, subdir):
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as tar:
        n = 0
        for m in tar:
            if not m.isfile():
                continue
            name = m.name.lstrip("./")
            if not (name.endswith(".js") or name.endswith(".wasm")):
                continue
            out = os.path.join(DEST, subdir, "emscripten", os.path.basename(name))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, "wb").write(tar.extractfile(m).read())
            n += 1
            print(f"  {out} ({os.path.getsize(out) / 1024:.0f} KB)")
        if n == 0:
            sys.exit(f"the {subdir} package did not contain .js/.wasm")


def main():
    sums = SUMS

    lua = download("lualatex-emscripten.tar.gz", sums["lualatex-emscripten.tar.gz"]["sha256"])
    unpack_engine(lua, "lualatex")

    bundle_data = download("texmf-core-lualatex.tar.gz", sums["texmf-core-lualatex.tar.gz"]["sha256"])
    bundle_out = os.path.join(DEST, "texmf-core-lualatex.tar.gz")
    open(bundle_out, "wb").write(bundle_data)
    print(f"  {bundle_out} ({os.path.getsize(bundle_out) / 1024 / 1024:.1f} MB)")
    print("done")


if __name__ == "__main__":
    main()
