#!/usr/bin/env python3
"""Downloads BibTeX for WebAssembly (bibtexu) and the Unicode data (ICU) used by the browser compiler.

Same version as the rest of the compiler (texlive-wasm v0.2.4-alpha). Checks the SHA-256 of each file against the published
`checksums.json` and installs into static/texlive/:

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

TAG = "v0.2.4-alpha"
BASE = f"https://github.com/typeward/texlive-wasm/releases/download/{TAG}"
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
    sums = json.loads(get(f"{BASE}/checksums.json"))["assets"]

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
