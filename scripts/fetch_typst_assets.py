#!/usr/bin/env python3
"""Downloads the Typst compiler for WebAssembly and the fonts Typst ships with, into static/typst/ (generated, outside Git).

  static/typst/typst_ts_web_compiler_bg.wasm    the compiler (npm @myriaddreamin/typst-ts-web-compiler, Apache-2.0)
  static/typst/fonts/*                          Libertinus Serif (OFL), New Computer Modern (GUST; not NewCM10-Regular, see below), DejaVu Sans Mono (Bitstream Vera/DejaVu license)
  static/typst/manifest.json                    versions, sizes and SHA-256 of what was installed

The wasm is checked against the integrity (SHA-512) that the npm registry publishes for the package; each font against the git blob hash that
GitHub reports for the file at the pinned tag of typst/typst-assets.

Usage:  python3 scripts/fetch_typst_assets.py
"""
import base64
import hashlib
import io
import json
import os
import tarfile
import urllib.request

COMPILER_PACKAGE = "@myriaddreamin/typst-ts-web-compiler"
COMPILER_VERSION = "0.7.0"       # keep in step with scripts/build_typst_vendor.sh and static/js/typst-worker.js
ASSETS_TAG = "v0.15.1"           # typst/typst-assets
FONTS = [
    "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf", "DejaVuSansMono-Oblique.ttf", "DejaVuSansMono-BoldOblique.ttf",
    "LibertinusSerif-Regular.otf", "LibertinusSerif-Italic.otf", "LibertinusSerif-Bold.otf", "LibertinusSerif-BoldItalic.otf",
    "LibertinusSerif-Semibold.otf", "LibertinusSerif-SemiboldItalic.otf",
    "NewCM10-Italic.otf", "NewCM10-Bold.otf", "NewCM10-BoldItalic.otf",
    "NewCMMath-Regular.otf", "NewCMMath-Book.otf", "NewCMMath-Bold.otf",
]
# NewCM10-Regular is GPL 3 or later: NeoLeaf does not serve it, the browser downloads it (see static/js/typst-worker.js, which pins its SHA-256)
NOT_SERVED = ["NewCM10-Regular.otf"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "static/typst")
CACHE = os.path.expanduser("~/.cache/neoleaf-typst")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "NeoLeaf-assets"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def cached(name, loader):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        return open(path, "rb").read()
    data = loader()
    with open(path, "wb") as f:
        f.write(data)
    return data


def git_blob_sha1(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def main():
    os.makedirs(os.path.join(DEST, "fonts"), exist_ok=True)
    manifest = {"compiler": {"package": COMPILER_PACKAGE, "version": COMPILER_VERSION}, "assets": {"repository": "typst/typst-assets", "tag": ASSETS_TAG}, "files": []}

    # ---- the compiler
    meta = json.loads(get(f"https://registry.npmjs.org/{COMPILER_PACKAGE}/{COMPILER_VERSION}"))
    integrity = meta["dist"]["integrity"]
    tgz = cached(f"{COMPILER_VERSION}.tgz", lambda: get(meta["dist"]["tarball"]))
    algo, b64 = integrity.split("-", 1)
    digest = base64.b64encode(hashlib.new(algo, tgz).digest()).decode()
    if digest != b64:
        raise SystemExit(f"the npm tarball does not match its integrity ({integrity})")
    with tarfile.open(fileobj=io.BytesIO(tgz)) as tar:
        wasm = tar.extractfile("package/pkg/typst_ts_web_compiler_bg.wasm").read()
    with open(os.path.join(DEST, "typst_ts_web_compiler_bg.wasm"), "wb") as f:
        f.write(wasm)
    manifest["files"].append({"file": "typst_ts_web_compiler_bg.wasm", "size": len(wasm), "sha256": hashlib.sha256(wasm).hexdigest()})
    print(f"compiler  {len(wasm):>9} bytes  (npm integrity {integrity[:24]}... ok)")

    # ---- the fonts
    listing = json.loads(get(f"https://api.github.com/repos/typst/typst-assets/contents/files/fonts?ref={ASSETS_TAG}"))
    blobs = {e["name"]: e for e in listing}
    for name in NOT_SERVED:
        stale = os.path.join(DEST, "fonts", name)
        if os.path.exists(stale):
            os.remove(stale)
    for name in FONTS:
        entry = blobs[name]
        data = cached(f"{ASSETS_TAG}-{name}", lambda: get(entry["download_url"]))
        if git_blob_sha1(data) != entry["sha"]:
            raise SystemExit(f"{name} does not match the git blob hash {entry['sha']}")
        with open(os.path.join(DEST, "fonts", name), "wb") as f:
            f.write(data)
        manifest["files"].append({"file": "fonts/" + name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    print(f"fonts     {len(FONTS)} files, {sum(f['size'] for f in manifest['files'] if f['file'].startswith('fonts/'))} bytes (git blob hashes ok)")

    with open(os.path.join(DEST, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print("wrote", DEST)


main()
