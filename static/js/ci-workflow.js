// "Build the PDF on GitHub": the workflow file (GitHub Actions) that compiles the project on every push and keeps the PDF as an artifact of the run.
//
// NeoLeaf does not push this file itself: GitHub refuses a push that creates or changes a workflow unless the token has the `workflow` permission, which the
// sign-in does not ask for (and should not: it lets an app change what runs in the person's repositories). So the person adds the file on GitHub, in the web
// editor, with the content already filled in; there it is committed by them, and a Pull brings it back here.
//
// The actions are pinned to a commit (the tag is in the comment), so that a moved tag cannot change what runs.
(function () {
  'use strict';

  const PATH = '.github/workflows/build-pdf.yml';
  const ACTIONS = {
    checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    latex: 'xu-cheng/latex-action@6549dc21effb2730855a1281407ecfcececc6c1b # 4.1.0',
    upload: 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
    typst: 'typst-community/setup-typst@fee4b65b091cc546f02ce3be15fad8760f38a108 # v5.3.0'
  };
  // only plain file names go into the YAML: a name with spaces, quotes or colons could change what the file means
  const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9._\-\/]*$/;

  /** The text of the workflow for a main file and an engine, or throws when the name of the main file cannot be written safely. */
  function build(mainFile, engine) {
    const main = String(mainFile || '');
    if (!SAFE_PATH.test(main) || main.includes('..') || main.endsWith('/')) throw new Error(T('The main file name has characters that cannot go into the workflow. Rename it using only letters, digits, dots, dashes and underscores.'));
    const pdf = main.replace(/\.[^./]+$/, '') + '.pdf';
    const head = [
      'name: Build PDF',
      '',
      'on:',
      '  push:',
      '  pull_request:',
      '  workflow_dispatch:',
      '',
      'permissions:',
      '  contents: read',
      '',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - uses: ${ACTIONS.checkout}`
    ];
    let compile;
    if (/\.typ$/i.test(main)) {
      compile = [
        `      - uses: ${ACTIONS.typst}`,
        `      - run: typst compile ${main} ${pdf}`
      ];
    } else {
      compile = [
        `      - uses: ${ACTIONS.latex}`,
        '        with:',
        `          root_file: ${main}`
      ];
      if (main.includes('/')) compile.push('          work_in_root_file_dir: true');
      if (engine === 'wasm-xelatex') compile.push('          latexmk_use_xelatex: true');
      if (engine === 'wasm-lualatex') compile.push('          latexmk_use_lualatex: true');
    }
    const upload = [
      `      - uses: ${ACTIONS.upload}`,
      '        with:',
      '          name: pdf',
      `          path: ${pdf}`
    ];
    return head.concat(compile, upload).join('\n') + '\n';
  }

  // where the file is created on GitHub (the web editor, with the name and the text already filled in)
  function githubUrl(owner, repo, branch, text) {
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/new/${encodeURIComponent(branch)}?filename=${encodeURIComponent(PATH)}&value=${encodeURIComponent(text)}`;
  }

  async function exists() {
    try { await BrowserGit.getFs().pfs.stat(BrowserGit.getDir() + '/' + PATH); return true; } catch (_) { return false; }
  }

  function isGitHub() {
    try { return !(window.__BG && __BG.user() && __BG.user().provider === 'codeberg'); } catch (_) { return true; }
  }

  async function open() {
    const cfg = (typeof projectConfig !== 'undefined' && projectConfig) || {};
    const text = build(cfg.mainFile || 'main.tex', cfg.engine);
    const branch = await BrowserGit.branch();
    window.open(githubUrl(__BG.owner(), __BG.repo(), branch, text), '_blank', 'noopener,noreferrer');
    return text;
  }

  async function copy() {
    const cfg = (typeof projectConfig !== 'undefined' && projectConfig) || {};
    const text = build(cfg.mainFile || 'main.tex', cfg.engine);
    await navigator.clipboard.writeText(text);
    return text;
  }

  window.CIWorkflow = { PATH, build, githubUrl, exists, isGitHub, open, copy };
})();
