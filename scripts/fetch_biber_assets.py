#!/usr/bin/env python3
"""Downloads Biber for WebAssembly (Perl 5.42 + biber 2.19 compiled to wasm), used by biblatex in the browser.

Same version as the rest of the compiler (texlive-wasm v0.4.0-alpha). Checks the SHA-256 of the package against the values
fixed in this file and installs into static/texlive/biber/emscripten/:

    biber.js, biber.wasm (9 MB), biber-vfs.tar.gz (14 MB: Perl and the biber modules), NOTICE e LICENSE.TL

Biber 2.19 only runs with biblatex 3.19 (TeX Live 2023): the server already fetches packages from the frozen TeX Live 2023
(src/ctan.rs), so the two versions match.

Usage:  python3 scripts/fetch_biber_assets.py
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
    "biber-emscripten.tar.gz": {"sha256": "2f3f72e1f91664f592ce0eb34fe01456c63b468e184a9effaf46849287c53ea4"},
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "static/texlive/biber/emscripten")
CACHE = os.path.expanduser("~/.cache/latexdrive-fonts")
NAME = "biber-emscripten.tar.gz"
KEEP = {"biber.js", "biber.wasm", "biber-vfs.tar.gz", "NOTICE", "LICENSE.TL"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "LatexDrive-assets"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def main():
    expected = SUMS[NAME]["sha256"]
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{TAG}-{NAME}")
    if os.path.exists(path) and hashlib.sha256(open(path, "rb").read()).hexdigest() == expected:
        data = open(path, "rb").read()
    else:
        print(f"  downloading {NAME}")
        data = get(f"{BASE}/{NAME}")
        got = hashlib.sha256(data).hexdigest()
        if got != expected:
            sys.exit(f"SHA-256 mismatch for {NAME}: expected {expected}, got {got}")
        open(path + ".part", "wb").write(data)
        os.replace(path + ".part", path)

    os.makedirs(DEST, exist_ok=True)
    found = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for m in tar:
            base = os.path.basename(m.name)
            if not m.isfile() or base not in KEEP:
                continue
            out = os.path.join(DEST, base)
            open(out, "wb").write(tar.extractfile(m).read())
            found.add(base)
            print(f"  {out} ({os.path.getsize(out) / 1024:.0f} KB)")
    if not {"biber.js", "biber.wasm", "biber-vfs.tar.gz"} <= found:
        sys.exit("the biber package did not contain biber.js, biber.wasm and biber-vfs.tar.gz")
    print("done")


if __name__ == "__main__":
    main()
