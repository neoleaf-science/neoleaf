#!/usr/bin/env python3
"""Downloads the XeLaTeX and xdvipdfmx engines for WebAssembly and the texmf-core-xelatex package.

Same version as the rest of the compiler (texlive-wasm v0.2.4-alpha). Checks the SHA-256 of each file against the published
`checksums.json` and installs into static/texlive/:

    static/texlive/xelatex/emscripten/xelatex.js|wasm
    static/texlive/xdvipdfmx/emscripten/xdvipdfmx.js|wasm
    static/texlive/texmf-core-xelatex.tar.gz

Usage:  python3 scripts/fetch_xelatex_assets.py
"""
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
    sums = json.loads(get(f"{BASE}/checksums.json"))["assets"]

    xe = download("xelatex-emscripten.tar.gz", sums["xelatex-emscripten.tar.gz"]["sha256"])
    unpack_engine(xe, "xelatex")

    xdv = download("xdvipdfmx-emscripten.tar.gz", sums["xdvipdfmx-emscripten.tar.gz"]["sha256"])
    unpack_engine(xdv, "xdvipdfmx")

    bundle_data = download("texmf-core-xelatex.tar.gz", sums["texmf-core-xelatex.tar.gz"]["sha256"])
    bundle_out = os.path.join(DEST, "texmf-core-xelatex.tar.gz")
    open(bundle_out, "wb").write(bundle_data)
    print(f"  {bundle_out} ({os.path.getsize(bundle_out) / 1024 / 1024:.1f} MB)")
    print("done")


if __name__ == "__main__":
    main()
