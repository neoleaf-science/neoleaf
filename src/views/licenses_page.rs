use super::privacy_page::style;

/// Open-source licenses and notices page (English only, like the legal text it points to).
pub fn render() -> String {
    [head(), style::style(), body()].concat()
}

fn head() -> &'static str {
    r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Open-source licenses - NeoLeaf</title>
    <link rel="icon" type="image/png" href="/static/img/favicon.png">
    <script src="/static/js/theme.js"></script>
    <link rel="stylesheet" href="/static/css/editor.css">
"##
}

fn body() -> &'static str {
    r##"    </style>
</head>
<body class="dashboard-body">
    <div class="legal-container">
        <div class="legal-nav">
            <a href="/" class="btn" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">← Back to NeoLeaf</a>
            <div style="display: flex; gap: 8px; align-items: center;"><span data-theme-picker></span></div>
        </div>

        <header class="legal-header">
            <div class="legal-badge">📜 Licenses and notices</div>
            <h1>Open-source licenses</h1>
            <p class="legal-updated">Last updated: October 2026 · NeoLeaf (<code>https://neoleaf.science</code>)</p>
        </header>

        <div class="legal-section">
            <h2>1. NeoLeaf</h2>
            <p>The NeoLeaf code is dual-licensed under the <strong>MIT License</strong> or the <strong>Apache License 2.0</strong>, at your option. Copyright (c) 2026 Tássio Virgínio and NeoLeaf contributors. The mascot and the logos are licensed under <strong>CC BY-NC-ND 4.0</strong>; the NeoLeaf name identifies the official project.</p>
            <p>Source code, license texts and the full study of third-party licenses: <a href="https://github.com/neoleaf-science/neoleaf" style="color: var(--green); text-decoration: underline;">github.com/neoleaf-science/neoleaf</a> (files <code>LICENSE-MIT</code>, <code>LICENSE-APACHE</code>, <code>LICENSE-ART</code>, <code>NOTICE</code>, <code>ART.md</code> and <code>LICENSES.md</code>).</p>
        </div>

        <div class="legal-section">
            <h2>2. TeX engines in WebAssembly (source code offer)</h2>
            <p>The browser compiles your documents with TeX Live programs built to WebAssembly. They run as separate programs; NeoLeaf's code does not link to them. Several are free software under the GNU GPL, so their <strong>corresponding source code</strong> is offered here:</p>
            <ul>
                <li><strong>pdfTeX</strong>, <strong>LuaTeX</strong> and <strong>xdvipdfmx</strong>: GPL, version 2 or later.</li>
                <li><strong>XeTeX</strong>: permissive MIT/X11-style license (SIL, Jonathan Kew and others).</li>
                <li><strong>BibTeX-U</strong>: TeX Live (GPL family and ICU). <strong>Biber</strong>: Artistic License 2.0, running on Perl (Artistic/GPL). <strong>ICU data</strong>: Unicode-3.0.</li>
            </ul>
            <p>Source: <a href="https://github.com/TeX-Live/texlive-source" style="color: var(--green); text-decoration: underline;">TeX-Live/texlive-source</a> (branch <code>branch2026</code>) and the build scripts in <a href="https://github.com/typeward/texlive-wasm/releases/tag/v0.2.4-alpha" style="color: var(--green); text-decoration: underline;">typeward/texlive-wasm</a>, release <code>v0.2.4-alpha</code> (the build used here, unmodified; the scripts are MIT). TeX Live terms: <a href="https://tug.org/texlive/copying.html" style="color: var(--green); text-decoration: underline;">tug.org/texlive/copying.html</a>.</p>
        </div>

        <div class="legal-section">
            <h2>3. Fonts and TeX packages</h2>
            <p>Packages and fonts come from TeX Live and CTAN with their own licenses: LaTeX Project Public License (LPPL) for most macros, SIL Open Font License for Montserrat, Noto, Inconsolata and Linux Libertine fonts, GUST Font License for Latin Modern, Apache-2.0 for Inconsolata, and the <strong>URW base 35</strong> fonts (Times, Helvetica, Courier, Palatino, Symbol, Zapf Dingbats) under the GNU AGPL 3 with a font exception that allows embedding them in PDF or PostScript documents regardless of the document's license. Source of the URW fonts: <a href="https://github.com/ArtifexSoftware/urw-base35-fonts" style="color: var(--green); text-decoration: underline;">ArtifexSoftware/urw-base35-fonts</a>.</p>
        </div>

        <div class="legal-section">
            <h2>4. JavaScript libraries</h2>
            <ul>
                <li><strong>isomorphic-git</strong> (Copyright 2017-2023 the isomorphic-git authors), <strong>lightning-fs</strong> (Copyright (c) 2018 wmhilton), <strong>Yjs</strong> and <strong>lib0</strong> (Kevin Jahns), <strong>clippyjs</strong> (Fireplace, Inc and Pooya Parsa), <strong>marked</strong>, <strong>PapaParse</strong>, <strong>Mermaid</strong>, <strong>KaTeX</strong>: MIT License.</li>
                <li><strong>DOMPurify</strong> (Cure53): Apache-2.0 or MPL-2.0.</li>
                <li><strong>Pyodide</strong> (Python in the browser, optional): MPL-2.0, with its Python packages under their own licenses.</li>
                <li>Loaded from a CDN (not redistributed by NeoLeaf): <strong>Monaco Editor</strong> (MIT) and <strong>pdf.js</strong> (Apache-2.0).</li>
            </ul>
            <p>The notices of the files kept in the source tree are in <a href="https://github.com/neoleaf-science/neoleaf/blob/main/static/vendor/NOTICES.md" style="color: var(--green); text-decoration: underline;"><code>static/vendor/NOTICES.md</code></a>.</p>
        </div>

        <div class="legal-section">
            <h2>5. Rust dependencies</h2>
            <p>NeoLeaf's server and the local agent are written in Rust. The lists below give each dependency, its version, its license and its source. All licenses are permissive (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0 and similar); no strong copyleft license is among them.</p>
            <ul>
                <li><a href="/static/licenses/rust-agent.txt" style="color: var(--green); text-decoration: underline;">Local agent</a>: the binary users download and run (list generated on Linux; the Windows and macOS builds add platform crates under the same kinds of licenses).</li>
                <li><a href="/static/licenses/rust-server.txt" style="color: var(--green); text-decoration: underline;">Server</a>: runs only on NeoLeaf's infrastructure; listed for transparency.</li>
            </ul>
        </div>

        <div class="legal-section">
            <h2>6. Templates</h2>
            <p>The template catalog redistributes or points to third-party templates (ACM acmart, IEEEtran, elsarticle, llncs, abnTeX2 and others). Each keeps its authors' license and notices (mostly LPPL); the origin and license of each one are listed in <code>LICENSES.md</code>.</p>
        </div>

        <div class="legal-section">
            <h2>7. Corrections</h2>
            <p>If you believe a notice is missing or wrong, write to <a href="mailto:contact@neoleaf.science" style="color: var(--green); text-decoration: underline;">contact@neoleaf.science</a>.</p>
        </div>

        <div style="text-align: center; margin-top: 40px;">
            <a href="/" class="btn btn-primary" style="text-decoration: none; padding: 10px 24px;">Back to the Home Page</a>
        </div>
    </div>
</body>
</html>"##
}
