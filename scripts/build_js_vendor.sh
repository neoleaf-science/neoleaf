#!/bin/sh
# Rebuilds the vendored JavaScript that has a fixed npm version: Yjs (with lib0), LightningFS, isomorphic-git (and its http module) and KaTeX.
# Versions are pinned here; each must be more than 2 weeks old when chosen, and its tarball is checked against the npm `shasum`.
#   sh scripts/build_js_vendor.sh
set -e
YJS=13.6.33
LFS=4.10.3
IGIT=1.34.2
KATEX=0.19.1
VENDOR="$(cd "$(dirname "$0")/../static/vendor" && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
cd "$W"
echo '{"name":"vendor-build","private":true}' > package.json
check() { # name@version tarball
  want="$(npm view "$1" dist.shasum)"; got="$(sha1sum "$2" | cut -d' ' -f1)"
  [ "$want" = "$got" ] || { echo "shasum mismatch for $1: $got != $want" >&2; exit 1; }
}
# Yjs: one ES module with every export of `yjs`, lib0 bundled inside
bun add "yjs@$YJS" >/dev/null
echo "export * from 'yjs';" > entry.js
bun build entry.js --minify --format=esm --target=browser --outfile="$VENDOR/yjs.mjs"
# LightningFS: the npm file with one local change, as in isomorphic-git below: the AMD branch also sets the global `LightningFS`
npm pack "@isomorphic-git/lightning-fs@$LFS" --silent >/dev/null
check "@isomorphic-git/lightning-fs@$LFS" "isomorphic-git-lightning-fs-$LFS.tgz"
mkdir lfs && tar xzf "isomorphic-git-lightning-fs-$LFS.tgz" -C lfs
python3 - "$VENDOR" <<'PY'
import sys
s = open('lfs/package/dist/lightning-fs.min.js').read()
old = 'define.amd?define([],e):'
assert old in s[:400]
open(sys.argv[1] + '/lightning-fs.min.js', 'w').write(s.replace(old, 'define.amd?(define([],e),t.LightningFS=e()):', 1))
PY
# isomorphic-git: two local changes (see LICENSES.md): the AMD branch also sets the global `git` (Monaco's AMD loader is on the page),
# and the http module always sets the global `GitHttp` and sends cookies (`credentials: 'include'`).
# Newer than 1.34.2 does not work: from 1.35.0 the UMD bundle no longer carries a Buffer polyfill ("Missing Buffer dependency"), so 1.34.2 is the last one to use as is
npm pack "isomorphic-git@$IGIT" --silent >/dev/null
check "isomorphic-git@$IGIT" "isomorphic-git-$IGIT.tgz"
mkdir ig && tar xzf "isomorphic-git-$IGIT.tgz" -C ig
python3 - "$VENDOR" <<'PY'
import sys
v = sys.argv[1]
n = open('ig/package/index.umd.min.js').read()
old = 'define.amd?define([],e):'
assert old in n[:400]
n = n.replace(old, 'define.amd?(define([],e),t.git=e()):', 1).replace('\n//# sourceMappingURL=index.umd.min.js.map', '', 1)
open(v + '/isomorphic-git.min.js', 'w').write(n)
h = open('ig/package/http/web/index.umd.js').read()
a = """  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = global || self, factory(global.GitHttp = {}));
"""
assert a in h
h = h.replace(a, """  global = global || self;
  if (typeof define === 'function' && define.amd) {
    define(['exports'], factory);
  }
  factory(global.GitHttp = {});
""", 1)
f = "const res = await fetch(url, { method, headers, body });"
assert f in h
h = h.replace(f, "const res = await fetch(url, { method, headers, body, credentials: 'include' });", 1)
open(v + '/isomorphic-git-http.js', 'w').write(h)
PY
ls -l "$VENDOR"/yjs.mjs "$VENDOR"/lightning-fs.min.js "$VENDOR"/isomorphic-git.min.js "$VENDOR"/isomorphic-git-http.js
# KaTeX: katex.min.js, contrib/auto-render.min.js, katex.min.css and the 20 .woff2 fonts, all flat in static/vendor/katex/. The only change: in the CSS the font
# rules keep only the .woff2 and lose the `fonts/` folder (the other formats are not shipped)
npm pack "katex@$KATEX" --silent >/dev/null
check "katex@$KATEX" "katex-$KATEX.tgz"
mkdir kx && tar xzf "katex-$KATEX.tgz" -C kx
K="$VENDOR/katex"
mkdir -p "$K"
cp kx/package/dist/katex.min.js kx/package/dist/contrib/auto-render.min.js kx/package/dist/fonts/*.woff2 "$K/"
python3 - "$K" <<'PY'
import re, sys
css = open('kx/package/dist/katex.min.css').read()
css = re.sub(r'url\(fonts/([^)]+?)\.woff2\) format\("woff2"\),url\(fonts/\1\.woff\) format\("woff"\),url\(fonts/\1\.ttf\) format\("truetype"\)', r'url(\1.woff2) format("woff2")', css)
assert 'fonts/' not in css and '.ttf' not in css
open(sys.argv[1] + '/katex.min.css', 'w').write(css)
PY
ls "$K" | wc -l
