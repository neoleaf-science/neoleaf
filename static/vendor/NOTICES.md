# Notices for third-party files in this folder

NeoLeaf's own code is MIT OR Apache-2.0. The files below belong to other projects and keep their licenses. Each is
MIT unless stated otherwise. See `LICENSES.md` at the root for versions and origin.

## isomorphic-git (`isomorphic-git.min.js`, `isomorphic-git-http.js`)
Copyright 2017-2023 the 'isomorphic-git' authors. MIT License. Both files are copies of the npm package with a changed UMD wrapper.

## lightning-fs (`lightning-fs.min.js`)
Copyright (c) 2018 wmhilton. MIT License.

## Yjs (`yjs.mjs`)
Copyright (c) 2023 Kevin Jahns <kevin.jahns@protonmail.com>. MIT License.

## lib0 (bundled inside `yjs.mjs`)
Copyright (c) 2019 Kevin Jahns <kevin.jahns@protonmail.com>. MIT License.

## clippyjs (`neoleaf-mascot.mjs`)
Copyright (c) 2012 Fireplace, Inc - 2017 Pooya Parsa. MIT License. (The mascot art is NeoLeaf's, see `ART.md`.)

## marked, PapaParse, Mermaid, KaTeX
`marked.umd.js`, `papaparse.min.js`, `mermaid.min.js` and `katex/` keep the copyright and license headers they carry.
marked: MarkedJS and Christopher Jeffrey. PapaParse: Matthew Holt and contributors. Mermaid: Knut Sveidqvist and contributors
(the bundle embeds other MIT/ISC/BSD libraries with their own headers). KaTeX: Khan Academy and contributors, MIT
(the `KaTeX_*` fonts have their own license, see the KaTeX package).

## DOMPurify (`purify.min.js`)
Copyright Cure53 and other contributors. Apache-2.0 OR MPL-2.0 (the `@license` header in the file).

## Spell check (`hunspell-asm.min.js`, `static/dict/`)
`hunspell-asm.min.js` is a bundle (built by `scripts/build_spell_vendor.sh`) of:
- **hunspell-asm** 4.0.2: Copyright (c) 2017 OJ Kwon. MIT License. It embeds **Hunspell** compiled to WebAssembly/asm.js with Emscripten.
- **Hunspell**: Copyright (C) László Németh and contributors. Tri-licensed MPL 1.1, GPL 2.0 or later and LGPL 2.1 or later; NeoLeaf uses it under the
  MPL 1.1 option. Source: <https://github.com/hunspell/hunspell> (license text in `license.hunspell` there).
- **emscripten-wasm-loader** 3.0.3: Copyright (c) OJ Kwon. MIT License.
- **nanoid** 2.1.11: Copyright 2017 Andrey Sitnik. MIT License.
- **tslib** 1.14.1: Copyright (c) Microsoft Corporation. 0BSD.
- The Emscripten runtime that Hunspell is compiled with: MIT License / University of Illinois-NCSA, Copyright the Emscripten authors.

The dictionaries are data files served as they came from their sources (unmodified); their complete license texts are next to them:
- `en-US.aff`, `en-US.dic`: npm package `dictionary-en` 4.0.0, built from SCOWL 2020.12.07. Copyright 2000-2018 Kevin Atkinson and the other
  holders named in the text; npm declares `(MIT AND BSD)`. Complete text: `static/dict/LICENSE-en-US.txt`.
- `pt-BR.aff`, `pt-BR.dic`: VERO 3.3.0 (Verificador Ortográfico Livre), from the LibreOffice dictionaries repository
  (<https://github.com/LibreOffice/dictionaries>, folder `pt_BR`, commit `5cf23af`). Copyright (C) 2006-2013 Raimundo Santos Moura and the VERO
  contributors, under the terms of the GNU LGPL version 3 and the Mozilla Public License (the README does not give the MPL version).
  Complete text: `static/dict/LICENSE-pt-BR.txt`.

## The MIT License (applies to every project above marked MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
