#!/usr/bin/env python3
"""Splits the browser compiler's extra fonts BY FAMILY.

There used to be a single ~75 MB package that the browser downloaded whole as soon as a document asked for any extra
font. Now:

  static/texlive/texmf-core-neoleaf.tar.gz     light package + the maps (pdftex.map) of ALL families
  static/texlive/fonts/<family>.tar.gz         the files of each family (tfm, vf, type1, enc, .sty/.fd)
  static/texlive/fonts/manifest.json           size and version of each package

The browser reads the project, finds out which families it uses and downloads only those, joining them to the light package (tar without the
end marker: the packages are concatenated). The map lines all stay in the light package: a line that points to a
missing file is harmless until the font is used.

Usage:  python3 scripts/build_font_packs.py
"""
import gzip
import hashlib
import io
import json
import lzma
import os
import re
import sys
import tarfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "static/texlive/texmf-core-pdflatex.tar.gz")
OUT_BASE = os.path.join(ROOT, "static/texlive/texmf-core-neoleaf.tar.gz")
OUT_DIR = os.path.join(ROOT, "static/texlive/fonts")
CACHE = os.path.expanduser("~/.cache/neoleaf-fonts-tl2023")
MIRROR = os.environ.get("CTAN_MIRROR_URL", "https://mirrors.ctan.org")
# The browser compiler has the LaTeX kernel 2023-11 (TeX Live 2023): the fonts come from the TeX Live of the same period
HISTORIC = os.environ.get("TLNET_HISTORIC_URL", "https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2023/tlnet-final")

# family -> TeX Live packages. "base" goes inside the light package (it is small and several families depend on it).
FAMILIES = {
    "psnfss": ["times", "helvetic", "courier", "symbol", "zapfding", "palatino"],   # Times, Helvetica, Courier, Palatino, Zapf Dingbats (pifont)
    "libertine": ["libertine"],
    "newtx": ["newtx", "txfonts"],
    "inconsolata": ["inconsolata"],
    "ec": ["ec"],                                                                   # T1/TS1 metrics (EC)
    "montserrat": ["montserrat"],
    "noto-sans": ["noto"],
}
BASE_PACKAGES = ["fontaxes", "xkeyval"]

KEEP_FONT_DIRS = ("tfm", "vf", "type1", "enc", "map")
ENCODINGS = ("t1", "ot1", "ts1", "ly1")
MAPS = {"libertine.map", "newtx.map", "zi4.map", "txfonts.map", "Montserrat.map", "noto.map"}
PDFTEX_MAP = "texmf/fonts/map/pdftex/updmap/pdftex.map"
EC_FROM_LM = {"r": "rm", "bx": "bx", "bxi": "bi", "ri": "ti", "ro": "sl", "tt": "tt", "ss": "ss", "ssbx": "sx", "csc": "sc"}


def fetch(pkg):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, pkg + ".tar.xz")
    if not os.path.exists(path):
        last = None
        for url in (f"{HISTORIC}/archive/{pkg}.tar.xz", f"{MIRROR}/systems/texlive/tlnet/archive/{pkg}.tar.xz"):
            print(f"  downloading {url}")
            req = urllib.request.Request(url, headers={"User-Agent": "NeoLeaf-fonts-builder"})
            try:
                with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as f:
                    f.write(r.read())
                os.replace(path + ".part", path)
                break
            except Exception as e:  # noqa: BLE001
                last = e
        else:
            raise last
    return path


def normalize(name):
    for prefix in ("texmf-dist/", "RELOC/"):
        if name.startswith(prefix):
            name = name[len(prefix):]
    return name


def wanted(name):
    parts = name.split("/")
    if parts[0] == "tex":
        return True
    return parts[0] == "fonts" and len(parts) > 2 and parts[1] in KEEP_FONT_DIRS


def keep_extra(pkg, name):
    """All of Montserrat and Noto Sans (without Serif/Mono), in the T1, OT1, TS1 and LY1 encodings."""
    base = os.path.basename(name)
    parts = name.split("/")
    if parts[:3] == ["fonts", "type1", "adobe"] and "courier" in parts:
        return False   # IBM Courier: CTAN lists it as non-free; the courier package uses the URW copy (ucr*)
    if pkg == "noto" and parts[0] == "fonts" and parts[1] in ("tfm", "vf", "type1") and not base.startswith("NotoSans-"):
        return False
    if pkg in ("noto", "montserrat") and parts[0] == "fonts" and parts[1] in ("tfm", "vf"):
        stem = base.rsplit(".", 1)[0].lower()
        return any(stem.endswith(f"-{e}") or stem.endswith(f"-{e}--base") for e in ENCODINGS)
    return True


def read_package(pkg):
    files = {}
    with lzma.open(fetch(pkg)) as xz, tarfile.open(fileobj=xz, mode="r|") as tar:
        for m in tar:
            if not m.isfile():
                continue
            name = normalize(m.name)
            if wanted(name) and keep_extra(pkg, name):
                files["texmf/" + name] = tar.extractfile(m).read()
    return files


def ec_aliases(map_text):
    """`ec-lm<fam><tam>` -> `ec<fam><tam>`: a missing EC font falls back to Latin Modern instead of failing (mktexpk)."""
    out, seen = [], set()
    for line in map_text.splitlines():
        m = re.match(r"^ec-lm([a-z]+?)(\d+)\s(.*)$", line)
        if not m or m.group(1) not in EC_FROM_LM:
            continue
        n = int(m.group(2))
        size = "1728" if n == 17 else f"{n * 100:04d}"
        name = f"ec{EC_FROM_LM[m.group(1)]}{size}"
        if name not in seen:
            seen.add(name)
            out.append(f"{name} {m.group(3)}")
    return "\n".join(out) + "\n"


def tar_bytes(files):
    """tar WITHOUT the end marker (two zeroed blocks): this way several packages can be concatenated."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for name, data in sorted(files.items()):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            tar.addfile(info, io.BytesIO(data))
    raw = buf.getvalue()
    end = len(raw)
    while end >= 512 and raw[end - 512:end] == b"\0" * 512:
        end -= 512
    return raw[:end]


def gz(data):
    return gzip.compress(data, compresslevel=9, mtime=0)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    packs, all_map_lines, seen_lines = {}, [], set()
    for family, pkgs in FAMILIES.items():
        print(f"family {family}")
        files = {}
        for pkg in pkgs:
            print(f"  package {pkg}")
            files.update(read_package(pkg))
        # the map lines go to the light package; the map file itself does not need to be in the family package
        for name in sorted(files):
            if name.startswith("texmf/fonts/map/dvips/") and os.path.basename(name) in MAPS:
                for line in files[name].decode("utf-8", "replace").splitlines():
                    if os.path.basename(name) == "noto.map" and not line.startswith("NotoSans-"):
                        continue
                    if line.strip() and not line.lstrip().startswith("%") and line not in seen_lines:
                        seen_lines.add(line)
                        all_map_lines.append(line)
        packs[family] = files
    base_extra = {}
    for pkg in BASE_PACKAGES:
        base_extra.update(read_package(pkg))

    # light package = original package + fontaxes + maps of all families + EC aliases
    with tarfile.open(BASE, "r:gz") as src:
        members = {}
        pdftex_map = ""
        for m in src:
            if not m.isfile():
                continue
            data = src.extractfile(m).read()
            if m.name == PDFTEX_MAP:
                pdftex_map = data.decode("utf-8", "replace")
            else:
                members[m.name] = data
    pdftex_map += "\n% --- NeoLeaf: maps of the extra font families (equivalent to enabling them in updmap) ---\n" + "\n".join(all_map_lines) + "\n"
    pdftex_map += "\n% --- NeoLeaf: EC fonts without their own design use Latin Modern ---\n" + ec_aliases(pdftex_map)
    members[PDFTEX_MAP] = pdftex_map.encode("utf-8")
    for name, data in base_extra.items():
        members.setdefault(name, data)
    base_tar = tar_bytes(members) + b"\0" * 1024
    with open(OUT_BASE, "wb") as f:
        f.write(gz(base_tar))
    print(f"light package: {OUT_BASE} ({os.path.getsize(OUT_BASE) / 1024 / 1024:.1f} MB)")

    manifest = {"base": {"file": "texmf-core-neoleaf.tar.gz", "size": os.path.getsize(OUT_BASE), "v": hashlib.sha256(open(OUT_BASE, "rb").read()).hexdigest()[:10]}, "families": {}}
    for family, files in packs.items():
        # the map file does not need to go again; everything else does
        files = {k: v for k, v in files.items() if not (k.startswith("texmf/fonts/map/") and os.path.basename(k) in MAPS)}
        data = gz(tar_bytes(files))
        path = os.path.join(OUT_DIR, f"{family}.tar.gz")
        with open(path, "wb") as f:
            f.write(data)
        manifest["families"][family] = {"file": f"fonts/{family}.tar.gz", "size": len(data), "files": len(files), "v": hashlib.sha256(data).hexdigest()[:10]}
        print(f"  {family:12s} {len(data) / 1024 / 1024:6.1f} MB  {len(files)} files")
    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    total = sum(v["size"] for v in manifest["families"].values())
    print(f"all families together: {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
