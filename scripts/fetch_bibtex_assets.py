#!/usr/bin/env python3
"""Downloads BibTeX for WebAssembly (bibtexu) and the Unicode data (ICU) used by the browser compiler.

Same version as the rest of the compiler (texlive-wasm v0.4.0-alpha). Checks the SHA-256 of each file against the values
fixed in this file and installs into static/texlive/:

    static/texlive/bibtexu/emscripten/bibtexu.js|wasm
    static/texlive/icudt78l.dat

Usage:  python3 scripts/fetch_bibtex_assets.py
"""
import gzip
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
    "bibtexu-emscripten.tar.gz": {"sha256": "c49f1d7b9c3241ef8f2c22e2917fb6cc72f142dda70e13f29fd09b3572ace958"},
    "icudt78l.dat.gz": {"sha256": "1f46a8db78150eb1628b5e43f02a344f8f08cd399779632858b96ef7cd3a6c6c"},
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


def main():
    sums = SUMS

    engine = download("bibtexu-emscripten.tar.gz", sums["bibtexu-emscripten.tar.gz"]["sha256"])
    with tarfile.open(fileobj=io.BytesIO(engine), mode="r:gz") as tar:
        n = 0
        for m in tar:
            if not m.isfile():
                continue
            name = m.name.lstrip("./")
            # only what is needed: the engine .js and .wasm
            if not (name.endswith(".js") or name.endswith(".wasm")):
                continue
            out = os.path.join(DEST, "bibtexu/emscripten", os.path.basename(name))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, "wb").write(tar.extractfile(m).read())
            n += 1
            print(f"  {out} ({os.path.getsize(out) / 1024:.0f} KB)")
        if n == 0:
            sys.exit("the bibtexu package did not contain .js/.wasm")

    icu = download("icudt78l.dat.gz", sums["icudt78l.dat.gz"]["sha256"])
    out = os.path.join(DEST, "icudt78l.dat")
    open(out, "wb").write(gzip.decompress(icu))
    print(f"  {out} ({os.path.getsize(out) / 1024 / 1024:.1f} MB)")
    print("done")


if __name__ == "__main__":
    main()
