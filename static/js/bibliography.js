// BibTeX (bibtexu) and Biber running in WebAssembly.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// ---------------------------------------------------------------------
// BibTeX (bibtexu em WebAssembly)
// ---------------------------------------------------------------------

let bibtexEngine = null;

function bytesToText(bytes) {
  return bytes ? new TextDecoder('utf-8', { fatal: false }).decode(bytes) : '';
}

async function getBibtexEngine() {
  if (bibtexEngine) return bibtexEngine;
  if (!window.Bibtexu) {
    await new Promise(resolve => {
      if (window.Bibtexu) return resolve();
      window.addEventListener('texlive-ready', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
  }
  if (!window.Bibtexu) throw new Error('BibTeX module unavailable');
  const origin = window.location.origin;
  bibtexEngine = new window.Bibtexu({
    enginePath: new URL('/static/texlive/bibtexu/emscripten/bibtexu.wasm', origin).href,
    icuDataUrl: new URL('/static/texlive/icudt78l.dat', origin).href,
    allowUnverifiedAssets: true
  });
  return bibtexEngine;
}

// The browser BibTeX does not have the current directory in its search paths (there is no texmf.cnf): it only opens
// files whose name starts with "./". We rewrite the .aux (only for the BibTeX call).
function bibtexAux(text) {
  const dot = n => (n.startsWith('./') || n.startsWith('/')) ? n : './' + n;
  return text
    .replace(/\\bibstyle\{([^}]*)\}/g, (m, s) => `\\bibstyle{${dot(s.trim())}}`)
    // `\bibliography{refs.bib}` (with the extension): bibtexu appends .bib and does not try the bare name, plain BibTeX does
    .replace(/\\bibdata\{([^}]*)\}/g, (m, s) => `\\bibdata{${s.split(',').map(x => dot(x.trim().replace(/\.bib$/i, ''))).join(',')}}`)
    .replace(/\\@input\{([^}]*)\}/g, (m, s) => `\\@input{${dot(s.trim())}}`);
}

// Runs `bibtex <job>.aux` and returns the generated .bbl and the log
async function runBibtex(jobname, input) {
  const engine = await getBibtexEngine();
  const files = input.map(f => (/\.aux$/i.test(f.path) && typeof f.content !== 'string')
    ? { path: f.path, content: new TextEncoder().encode(bibtexAux(bytesToText(f.content))) }
    : f);
  const r = await engine.run({ auxFile: './' + jobname + '.aux', files });
  const blg = bytesToText(outputGet(r.outputs, jobname + '.blg'));
  const log = [blg, r.stdout, r.stderr].filter(Boolean).join('\n').trim() || '(no output)';
  return { bbl: outputGet(r.outputs, jobname + '.bbl'), log, exitCode: r.exitCode };
}

// Biber (biblatex with the default backend): Perl + biber 2.19 in WebAssembly (scripts/fetch_biber_assets.py). It is only
// downloaded (23 MB) on the first compilation of a document that uses biblatex with Biber.
let biberEngine = null;

async function getBiberEngine() {
  if (biberEngine) return biberEngine;
  if (!window.Biber) {
    await new Promise(resolve => {
      if (window.Biber) return resolve();
      window.addEventListener('texlive-ready', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
  }
  if (!window.Biber) throw new Error('Biber module unavailable');
  const origin = window.location.origin;
  biberEngine = new window.Biber({
    enginePath: new URL('/static/texlive/biber/emscripten/biber.wasm', origin).href,
    bundleUrl: new URL('/static/texlive/biber/emscripten/biber-vfs.tar.gz', origin).href,
    allowUnverifiedAssets: true
  });
  return biberEngine;
}

// Runs `biber <job>` (reads <job>.bcf and the .bib files) and returns the generated .bbl and the log
async function runBiber(jobname, input) {
  const engine = await getBiberEngine();
  const r = await engine.run({ jobname, files: input });
  const blg = bytesToText(outputGet(r.outputs, jobname + '.blg'));
  const log = [blg, r.stdout, r.stderr].filter(Boolean).join('\n').trim() || '(no output)';
  return { bbl: outputGet(r.outputs, jobname + '.bbl'), log, exitCode: r.exitCode };
}

// Files that BibTeX or Biber receive: the project, the pass's auxiliary files and, if the main file is in a subfolder
// (samples/x.tex with \bibliography{refs} and samples/refs.bib), the .bib/.bst files of that folder also without the prefix
function bibInputFor(files, nowFiles, main) {
  const bibInput = [...files.entries()].map(([path, content]) => ({ path, content }));
  for (const [path, content] of nowFiles) if (!files.has(path)) bibInput.push({ path, content });
  const mainDirB = main && main.includes('/') ? main.substring(0, main.lastIndexOf('/') + 1) : '';
  if (mainDirB) {
    for (const f of [...bibInput]) {
      if (!f.path.startsWith(mainDirB) || !/\.(bib|bst)$/i.test(f.path)) continue;
      const rel = f.path.slice(mainDirB.length);
      if (!bibInput.some(x => x.path === rel)) bibInput.push({ path: rel, content: f.content });
    }
  }
  return bibInput;
}

// The .bcf (biblatex control file) asks for Biber when it has citations and the .aux does not ask for BibTeX
function biberWanted(bcfText, auxText) {
  return !!bcfText && !/\\bibdata\{/.test(auxText) && /<bcf:citekey/.test(bcfText);
}
