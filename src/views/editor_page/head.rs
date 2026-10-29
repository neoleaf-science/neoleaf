/// Document head: meta, shared scripts, Monaco loader, Yjs and the WebAssembly TeX engine.
pub(super) fn head() -> &'static str {
    r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{PROJECT_TITLE}} - NeoLeaf Editor</title>
    <link rel="icon" type="image/png" href="/static/img/favicon.png">
    <script src="/static/js/session-guard.js"></script>
    <script src="/static/js/theme.js"></script>
    <script src="/static/js/i18n.js"></script>
    <link rel="stylesheet" href="/static/css/editor.css">
    <!-- Browser-First Git Engine (IndexedDB + Isomorphic-Git) -->
    <script src="/static/vendor/lightning-fs.min.js"></script>
    <script src="/static/vendor/isomorphic-git.min.js"></script>
    <script src="/static/vendor/isomorphic-git-http.js"></script>
    <script src="/static/js/browser-git.js?v=2"></script>
    <script src="/static/js/browser-git-sync.js"></script>
    <script src="/static/js/browser-git-compare.js"></script>
    <script src="/static/js/zip.js"></script>
    <script src="/static/js/project-handoff.js"></script>
    <script src="/static/js/project-store.js"></script>
    <script src="/static/js/project-store-texmf.js"></script>
    <script src="/static/js/project-store-build.js"></script>
    <!-- Monaco Editor Loader -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.56.0/min/vs/loader.min.js" integrity="sha384-5Ubp2dzZW9MAJXGpSFXLlurRaPg3+ktYfisBzghShdarxz8R37mhDy2svDenxogJ" crossorigin="anonymous"></script>
    <!-- Yjs (CRDT) for real-time collaborative editing -->
    <script type="module">
        import * as Y from '/static/vendor/yjs.mjs';
        window.Y = Y;
        window.dispatchEvent(new CustomEvent('yjs-ready'));
    </script>
    <!-- texlive-wasm / BusyTeX WebAssembly Engine (Client-side compilation in browser) -->
    <script type="module">
        import { PdfLatex, Bibtexu, Biber, XeLatex, LuaLatex, Xdvipdfmx, latexmk } from '/static/texlive/texlive.js';
        window.PdfLatex = PdfLatex;
        window.Bibtexu = Bibtexu;
        window.Biber = Biber;
        window.XeLatex = XeLatex;
        window.LuaLatex = LuaLatex;
        window.Xdvipdfmx = Xdvipdfmx;
        window.texliveLatexmk = latexmk;
        window.dispatchEvent(new CustomEvent('texlive-ready'));
    </script>
</head>
"##
}
