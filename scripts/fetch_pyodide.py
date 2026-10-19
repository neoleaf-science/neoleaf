#!/usr/bin/env python3
"""Downloads Pyodide (Python in WebAssembly) and the chosen packages into static/pyodide/, from where the server serves them.

The files are public (no user data) and large, so they stay out of Git (see .gitignore). Each package is verified against the SHA-256 in the
distribution's own `pyodide-lock.json`. To change the version, edit VERSION (pick one published more than 2 weeks ago) and run again.

Usage: python3 scripts/fetch_pyodide.py [package ...]   (without arguments, downloads the default set and the dependencies of each)
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

VERSION = "314.0.7"   # Python 3.14.2 (published on 2026-09-14)
BASE = f"https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/"
CORE = ["pyodide.js", "pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]
DEFAULT = ["numpy", "pandas", "matplotlib", "scipy", "sympy"]
OUT = Path(__file__).resolve().parent.parent / "static" / "pyodide"


def fetch(name: str) -> bytes:
    with urllib.request.urlopen(BASE + name, timeout=300) as r:
        return r.read()


def closure(packages: dict, names: list[str]) -> list[str]:
    seen: list[str] = []
    todo = list(names)
    while todo:
        n = todo.pop()
        if n in seen:
            continue
        if n not in packages:
            sys.exit(f"unknown package: {n}")
        seen.append(n)
        todo += packages[n].get("depends", [])
    return sorted(seen)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in CORE:
        data = fetch(name)
        (OUT / name).write_bytes(data)
        print(f"{name:22s} {len(data) / 1024 / 1024:6.2f} MB  sha256 {hashlib.sha256(data).hexdigest()[:16]}")
    lock = json.loads((OUT / "pyodide-lock.json").read_text())
    packages = lock["packages"]
    total = 0
    for pkg in closure(packages, sys.argv[1:] or DEFAULT):
        info = packages[pkg]
        data = fetch(info["file_name"])
        if hashlib.sha256(data).hexdigest() != info["sha256"]:
            sys.exit(f"SHA-256 mismatch for {info['file_name']}")
        (OUT / info["file_name"]).write_bytes(data)
        total += len(data)
        print(f"{pkg:22s} {len(data) / 1024 / 1024:6.2f} MB  verified")
    print(f"packages: {total / 1024 / 1024:.1f} MB em {OUT}")


if __name__ == "__main__":
    main()
