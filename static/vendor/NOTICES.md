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

## Spell check (`hunspell-asm.min.js`)
`hunspell-asm.min.js` is a bundle (built by `scripts/build_spell_vendor.sh`) of:
- **hunspell-asm** 4.0.2: Copyright (c) 2017 OJ Kwon. MIT License. It embeds **Hunspell** compiled to WebAssembly/asm.js with Emscripten.
- **Hunspell**: Copyright (C) László Németh and contributors. Tri-licensed MPL 1.1, GPL 2.0 or later and LGPL 2.1 or later; NeoLeaf uses it under the
  MPL 1.1 option. Source: <https://github.com/hunspell/hunspell> (license text in `license.hunspell` there).
- **emscripten-wasm-loader** 3.0.3: Copyright (c) OJ Kwon. MIT License.
- **nanoid** 2.1.11: Copyright 2017 Andrey Sitnik. MIT License.
- **tslib** 1.14.1: Copyright (c) Microsoft Corporation. 0BSD.
- The Emscripten runtime that Hunspell is compiled with: MIT License / University of Illinois-NCSA, Copyright the Emscripten authors.

**NeoLeaf hosts and distributes no dictionary.** The browser downloads each one, after the person agrees, from the LibreOffice dictionaries repository
(<https://github.com/LibreOffice/dictionaries>) at the fixed commit `67032ee957631908098a72edf48dc81cac27e369` (raw.githubusercontent.com, with jsDelivr as a mirror), checks the SHA-256
listed in `static/js/spellcheck-dicts.js` and keeps the file in its own storage. Each dictionary keeps its license, as its README declares it:
- Português (Brasil) (`pt-BR`): LGPL-3.0 and MPL (the README does not give the MPL version). Authors: Raimundo Santos Moura and the VERO contributors. README: <https://github.com/LibreOffice/dictionaries/blob/67032ee957631908098a72edf48dc81cac27e369/pt_BR/README_pt_BR.txt>
- Português (Portugal) (`pt-PT`): GPL 2, LGPL 2.1 or MPL 1.1 (in that order of preference). Authors: José João Almeida and the contributors named in the README. README: <https://github.com/LibreOffice/dictionaries/blob/67032ee957631908098a72edf48dc81cac27e369/pt_PT/README_pt_PT.txt>
- English (US) (`en-US`): SCOWL license (MIT-like, with BSD and other notices). Authors: Kevin Atkinson and the other holders named in the README. README: <https://github.com/LibreOffice/dictionaries/blob/67032ee957631908098a72edf48dc81cac27e369/en/README_en_US.txt>
- English (UK) (`en-GB`): LGPL. Authors: the authors named in the README. README: <https://github.com/LibreOffice/dictionaries/blob/67032ee957631908098a72edf48dc81cac27e369/en/README_en_GB.txt>
- Español (`es-ES`): GPL 3 or later, LGPL 3 or later or MPL 1.1 or later. Authors: the authors named in the README. README: <https://github.com/LibreOffice/dictionaries/blob/67032ee957631908098a72edf48dc81cac27e369/es/README_hunspell_es.txt>
- Français (`fr-FR`): MPL 2.0. Authors: the authors named in the README. README: <https://github.com/LibreOffice/dictionaries/blob/67032ee957631908098a72edf48dc81cac27e369/fr_FR/dictionaries/README_dict_fr.txt>
- Italiano (`it-IT`): GPL 3. Authors: LibreItalia (Marina Latini) and other authors. README: <https://github.com/LibreOffice/dictionaries/blob/67032ee957631908098a72edf48dc81cac27e369/it_IT/README_it_IT.txt>
- Deutsch (`de-DE`): GPL 2 or 3. Authors: the igerman98 and frami authors. README: <https://github.com/LibreOffice/dictionaries/blob/67032ee957631908098a72edf48dc81cac27e369/de/README_de_DE_frami.txt>

## Typst (`typst-engine.min.js`, `static/typst/`)
`typst-engine.min.js` is a bundle (built by `scripts/build_typst_vendor.sh`) of **typst.ts** 0.7.0 (`@myriaddreamin/typst.ts`): Copyright the typst.ts authors (Myriad-Dreamin and
contributors), Apache License 2.0. Source: <https://github.com/Myriad-Dreamin/typst.ts>. The compiler itself, `typst_ts_web_compiler_bg.wasm` (npm package
`@myriaddreamin/typst-ts-web-compiler` 0.7.0), is the **Typst** compiler (Copyright the Typst contributors, Apache License 2.0, <https://github.com/typst/typst>)
compiled to WebAssembly; it is not in the repository: `scripts/fetch_typst_assets.py` downloads it (and checks the npm integrity hash) into `static/typst/`.

The fonts Typst ships with come from **typst-assets** v0.15.1 (<https://github.com/typst/typst-assets>, Apache License 2.0 for the crate; each font keeps its own license,
see its `NOTICE`). They are downloaded by the same script into `static/typst/fonts/` (all but `NewCM10-Regular`, see below), not committed:
- **Libertinus Serif**: Copyright 2012-2024 The Libertinus Project Authors, SIL Open Font License 1.1, with Reserved Font Names ("Linux Libertine", "Biolinum", "STIX Fonts").
- **New Computer Modern**: `NewCM10-Regular` under the GNU GPL 3 or later with the Font Exception and the Distribution Exception (Section 7 of the GPL 3; these let documents that embed the font be distributed under any license); the other NewCM10 and NewCMMath files under the GUST Font License 1.0 (LPPL 1.3c or later). Source: <https://ctan.org/pkg/newcomputermodern>. **NeoLeaf does not serve `NewCM10-Regular`**: the browser downloads it from typst-assets v0.15.1 (raw.githubusercontent.com, jsDelivr as a mirror), checks the SHA-256 pinned in `static/js/typst-worker.js` and keeps it in its own storage.
- **DejaVu Sans Mono**: fonts (c) Bitstream, Inc. (Bitstream Vera) and Tavmjong Bah (Arev), changes in the public domain; the Bitstream Vera license.
The full texts are in <https://github.com/typst/typst-assets/blob/v0.15.1/NOTICE>.

The Typst packages a document imports (`@preview/...`) are downloaded by the browser from packages.typst.org, each with the license its author chose.

## Badness (`badness-engine.js`, `badness-engine_bg.wasm`)
Built by `scripts/build_badness_vendor.sh` from `tools/badness-wasm` (a small shim written for NeoLeaf) and **Badness** at commit `cf35528c63f008c3ea47de1f31426058e7b479e1`
(<https://github.com/jolars/badness>): Copyright (c) 2026 Johan Larsson, MIT License. Its Rust dependencies are compiled into the same file (120 crates, pinned in
`tools/badness-wasm/Cargo.lock`): 117 are MIT, Apache-2.0 or both (some also Unlicense), one is Zlib and one adds Unicode-3.0 for its data tables. One, **option-ext** 0.2.0
(through `dirs`, which Badness uses to find configuration files and which does nothing in a browser), is MPL-2.0: it is in the dependency graph and we could not confirm that the
linker dropped it. Its source is public at <https://crates.io/crates/option-ext> and the MPL-2.0 applies to its files only.

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
