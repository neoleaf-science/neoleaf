// Automatic installation of missing packages, and the hints derived from the compiler log.
// Classic script: shares the page's global scope with the other editor scripts (see editor_page.rs for the load order).

// ---------------------------------------------------------------------
// Automatic installation of missing packages
// ---------------------------------------------------------------------

const LDF_TO_PACKAGE = {
  portuguese: 'babel-portuges', portuges: 'babel-portuges', brazil: 'babel-portuges', brazilian: 'babel-portuges',
  german: 'babel-german', ngerman: 'babel-german', austrian: 'babel-german', naustrian: 'babel-german', swissgerman: 'babel-german',
  french: 'babel-french', francais: 'babel-french', acadian: 'babel-french', canadien: 'babel-french',
  spanish: 'babel-spanish', italian: 'babel-italian', dutch: 'babel-dutch', russian: 'babel-russian',
  polish: 'babel-polish', czech: 'babel-czech', swedish: 'babel-swedish', norsk: 'babel-norwegian', danish: 'babel-danish',
  finnish: 'babel-finnish', greek: 'babel-greek', turkish: 'babel-turkish', hungarian: 'babel-hungarian'
};

function fontCandidates(raw) {
  let name = String(raw || '').trim().replace(/^\[/, '').replace(/\]$/, '').split(':')[0].trim();
  name = name.replace(/^["']|["']$/g, '').trim();
  if (!name || name.length > 80) return [];

  const candidates = [];
  const baseNoExt = name.replace(/\.(otf|ttf|ttc|pfb|afm|tfm)$/i, '');
  const lower = baseNoExt.toLowerCase();
  candidates.push(lower);

  // E.g. FiraSans-Book -> firasans, fira
  const parts = baseNoExt.split(/[-_]/);
  if (parts.length > 1) {
    const family = parts[0].toLowerCase();
    candidates.push(family);
    const root = family.replace(/(sans|serif|mono|code|text|display|pro)$/i, '');
    if (root && root.length >= 3 && root !== family) {
      candidates.push(root);
    }
  }

  // Specific mappings for well-known system fonts
  if (/^times(\s*new\s*roman)?$/i.test(lower) || lower === 'timesnewroman') {
    candidates.push('tex-gyre', 'times', 'tempora');
  }
  if (/^arial$/i.test(lower)) {
    candidates.push('tex-gyre', 'helvetic');
  }

  // Remove suffixes such as Sans, Serif, Mono, Pro (e.g. firasans -> fira)
  const root = lower.replace(/(sans|serif|mono|code|text|display|pro)$/i, '');
  if (root && root.length >= 3 && !candidates.includes(root)) {
    candidates.push(root);
  }

  return [...new Set(candidates.filter(c => /^[a-z0-9_.+-]+$/i.test(c) && c.length >= 2))];
}

// Files the compiler says it could not find (name -> candidate packages, from most to least likely)
function missingFromLog(log) {
  const found = new Map();
  const add = (file, cands) => { if (!found.has(file)) found.set(file, cands); };
  for (const m of log.matchAll(/File [`']([^'`]+)' not found/g)) {
    const file = m[1].trim();
    const base = file.replace(/\.(sty|cls|clo|def|cfg|fd|bbx|cbx|lbx|ldf|sto|ltx|rtx|tex|otf|ttf|tfm)$/i, '');
    if (!/\.(sty|cls|clo|def|cfg|fd|bbx|cbx|lbx|ldf|sto|ltx|rtx|tex|otf|ttf|tfm)$/i.test(file) || !/^[A-Za-z0-9_.+-]+$/.test(base)) continue;
    if (/\.ldf$/i.test(file)) add(file, [LDF_TO_PACKAGE[base.toLowerCase()], 'babel-' + base.toLowerCase()].filter(Boolean));
    else if (/\.(otf|ttf|tfm)$/i.test(file)) add(file, fontCandidates(base));
    else add(file, [base.toLowerCase(), base]);
  }
  // fontspec: Package fontspec Error: The font "FiraSans-Book" cannot be found.
  for (const m of log.matchAll(/(?:Package fontspec Error:\s+)?The font "([^"]+)" cannot be found/gi)) {
    const raw = m[1].trim();
    const base = raw.replace(/\.(otf|ttf|ttc|pfb)$/i, '');
    if (/^[A-Za-z0-9_.+-]+$/.test(base)) {
      const cands = fontCandidates(raw);
      add(base + '.otf', cands);
      add(base + '.ttf', cands);
    }
  }
  // luaotfload / LuaLaTeX: luaotfload | resolve : Font "FiraSans-Book" not found
  for (const m of log.matchAll(/luaotfload\s*\|\s*(?:resolve|load|aux)\s*:\s*(?:[Ff]ont\s+)?"?([^"\n\r]+?)"?\s+not found/gi)) {
    const raw = m[1].trim();
    const base = raw.replace(/\.(otf|ttf|ttc|pfb)$/i, '');
    if (/^[A-Za-z0-9_.+-]+$/.test(base)) {
      const cands = fontCandidates(raw);
      add(base + '.otf', cands);
      add(base + '.ttf', cands);
    }
  }
  // Font \TU/...=FontName at ... not loadable
  for (const m of log.matchAll(/Font\s+\\?[^\s=]+=\[?([^\]@\s=]+)\]?(?:\s|@|=|at).*not loadable/gi)) {
    const raw = m[1].split(':')[0].trim();
    if (/^[A-Za-z0-9_.+-]+$/.test(raw)) {
      const base = raw.replace(/\.(otf|ttf|ttc|tfm)$/i, '');
      const cands = fontCandidates(raw);
      add(base + '.otf', cands);
      add(base + '.tfm', cands);
    }
  }
  // BibTeX: "I couldn't open style file plain.bst"
  for (const m of log.matchAll(/I couldn't open style file ([^\s]+)/g)) {
    const name = m[1].trim();
    const base = name.replace(/\.bst$/i, '');
    if (/^[A-Za-z0-9_.+-]+$/.test(base)) add(base + '.bst', [base.toLowerCase()]);
  }
  // Plain TeX: "! I can't find file `xkeyval'." (an \\input of a .tex file, usually inside a package)
  for (const m of log.matchAll(/I can't find file [`']([^'`\s]+)'/g)) {
    const name = m[1].trim();
    const base = name.replace(/\.(tex|sty|cls|def|cfg|clo|fd|otf|ttf)$/i, '');
    if (!/^[A-Za-z0-9_.+-]+$/.test(base)) continue;
    const isFont = /\.(otf|ttf)$/i.test(name);
    const file = /\.[A-Za-z]+$/.test(name) ? name : base + '.tex';
    add(file, isFont ? fontCandidates(base) : [base.toLowerCase()]);
  }
  // babel: "...or the language definition file portuguese.ldf" (the sentence wraps across lines in the log)
  for (const m of log.matchAll(/language definition file\s+([A-Za-z0-9_-]+)\.ldf/g)) {
    const base = m[1].toLowerCase();
    add(m[1] + '.ldf', [LDF_TO_PACKAGE[base], 'babel-' + base].filter(Boolean));
  }
  for (const m of log.matchAll(/Package babel Error: Unknown option [`']([A-Za-z0-9_-]+)'/g)) {
    const base = m[1].toLowerCase();
    add(m[1] + '.ldf', [LDF_TO_PACKAGE[base], 'babel-' + base].filter(Boolean));
  }
  return found;
}

// Downloads a package from CTAN (through the server proxy) into the local cache; returns { item } or { error }
async function importQuiet(body) {
  try {
    const r = await Project.texmf.import({ scope: 'cache', ...body });
    return { item: r.item };
  } catch (e) {
    return { error: e.message };
  }
}

// Hints about proprietary fonts (apply to the browser and to the local agent)
const FREE_FONT_CLONES = [
  ['Times New Roman', '\\setmainfont{TeX Gyre Termes}', 'times.ttf'],
  ['Arial', '\\setsansfont{TeX Gyre Heros}', 'arial.ttf'],
  ['Courier New', '\\setmonofont{TeX Gyre Cursor}', 'cour.ttf'],
];

function fontHintsFromLog(log) {
  const hints = [];
  for (const [name, use, file] of FREE_FONT_CLONES) {
    if (new RegExp('The font "' + name + '" cannot be found', 'i').test(log)) {
      hints.push(T('Tip: "{0}" is a proprietary Windows/Mac font. In LaTeX/XeLaTeX, use {1} (the equivalent free clone from TeX Live) or upload the file {2} from your computer to the project.', name, use, file));
    }
  }
  return hints;
}

// Hints for errors that cannot be solved by installing packages
function hintsFromLog(log) {
  const hints = [];
  if (/Please \(re\)run Biber|Package biblatex Warning:.*Biber/i.test(log) && !/===== Biber =====/.test(log)) {
    hints.push(T('Tip: biblatex asked for Biber, but it did not generate the bibliography. See the "Biber" block of the log, or use \\usepackage[backend=bibtex]{biblatex}.'));
  }
  if (/requires (?:either )?XeTeX or\s+(?:\([A-Za-z]+\)\s+)?LuaTeX/i.test(log) || /File [`']fontspec\.sty' not found/i.test(log)) {
    hints.push(T('Tip: this project uses XeLaTeX (fontspec). Choose "⚡ Browser (XeLaTeX / WebAssembly)" (or "💻 Local (XeLaTeX)") in the engine selector above.'));
  }
  if (/Font (T1|TS1)\/[^ ]+ .*not loadable: Metric \(TFM\) file not found/.test(log)) {
    hints.push(T('Tip: the browser compiler does not ship the EC/TC fonts (used with [T1]{fontenc} without a font of its own). Add \\usepackage{lmodern} before \\usepackage[T1]{fontenc}.'));
  }
  fontHintsFromLog(log).forEach(h => hints.push(h));
  if (/you've exceeded \d+, the entry-string-size/i.test(log)) {
    hints.push(T('Tip: the browser BibTeX truncates entry strings longer than 100 characters (long author lists in styles such as ACM-Reference-Format), which can leave the bibliography incomplete or break the compilation ("File ended while scanning use of \\@secondoftwo"). Use the local agent ("💻 Local"), which uses the full BibTeX, or shorten the author lists with "and others" in the cited entries.'));
  }
  return hints;
}

// Before the first compilation: reads what the project declares (\usepackage, \documentclass...) and installs everything at once,
// instead of one compilation round per package. It does not repeat while what the open file declares does not change (or for 5 min).
let preinstallMemo = { sig: '', at: 0 };

function declaredSignature() {
  const text = (typeof editor !== 'undefined' && editor) ? editor.getValue() : '';
  const names = [...text.replace(/(^|[^\\])%.*$/gm, '$1').matchAll(/\\(?:usepackage|RequirePackage|documentclass|LoadClass)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)].map(m => m[1].replace(/\s+/g, ''));
  return names.sort().join('|') + '#' + (typeof projectId !== 'undefined' ? projectId : '');
}

async function preinstallDeclared() {
  if (projectConfig.autoInstall === false || typeof projectId === 'undefined' || !projectId) return { installed: [], failed: [] };
  const sig = declaredSignature();
  if (sig === preinstallMemo.sig && Date.now() - preinstallMemo.at < 5 * 60 * 1000) return { installed: [], failed: [] };
  updateStatus('saving', 'Checking the packages the project asks for...');
  try {
    const data = await Project.texmf.preinstall();
    preinstallMemo = { sig, at: Date.now() };
    return { installed: data.installed || [], failed: data.failed || [] };
  } catch (_) { /* no connection: go on to the compilation, which installs what is missing in rounds */ }
  return { installed: [], failed: [] };
}

async function compileWithAutoInstall() {
  const installed = [];
  const failed = [];
  const pre = await preinstallDeclared();
  installed.push(...pre.installed);
  const tried = new Set();
  const MAX_ROUNDS = 10;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await compileWithWasm();
    const auto = projectConfig.autoInstall !== false;
    const missing = [...missingFromLog(res.log || '').entries()].filter(([file]) => !tried.has(file));

    // Text symbols (TS1) without a vector font: recompile once with Latin Modern
    if (!res.success && !forceLmodern && TS1_ERR_RE.test(res.log || '')) {
      forceLmodern = true;
      updateStatus('saving', 'The document uses text symbols (©, °) that need Latin Modern: recompiling...');
      continue;
    }
    // Font the light bundle does not have: download the family(ies) the log cites (or all, if it cannot tell) and recompile
    if (!res.success && missing.length === 0 && FONT_ERR_RE.test(res.log || '')) {
      const manifest = await loadFontManifest();
      if (manifest) {
        const all = Object.keys(manifest.families);
        let toLearn = [...familiesFromLog(res.log)].filter(f => all.includes(f) && !learnedFamilies.has(f));
        if (!toLearn.length) toLearn = all.filter(f => !learnedFamilies.has(f));
        if (toLearn.length) {
          updateStatus('saving', T('The document uses extra fonts: loading {0}...', toLearn.filter(f => f !== 'ec').join(', ') || toLearn.join(', ')));
          learnFamilies(toLearn);
          continue;
        }
      }
    }
    if (res.success || !auto || missing.length === 0) {
      const notes = [];
      if (installed.length) notes.push('Packages installed automatically (TeX Live): ' + installed.join(', '));
      if (failed.length) notes.push('Could not install automatically: ' + failed.join(', ') + '. Use ⚙ Project → Packages to upload them.');
      if (!res.success && pre.failed.length) notes.push('Early installation: ' + pre.failed.join('; '));
      if (!res.success) hintsFromLog(res.log || '').forEach(h2 => notes.push(h2));
      if (notes.length) {
        res.log = notes.join('\n') + '\n\n' + (res.log || '');
        if (res.success && installed.length) updateStatus('saved', 'Compiled (installed: ' + installed.join(', ') + ')');
      }
      return res;
    }

    let progressed = false;
    for (const [file, candidates] of missing.slice(0, 6)) {
      tried.add(file);
      let ok = false;
      updateStatus('saving', `Looking for the package of ${file}...`);
      // 1) the server finds the package through the TeX Live index; 2) if that fails, try by name
      let r;
      try { r = await importQuiet({ file }); } catch (_) { r = { error: 'no connection' }; }
      if (!r.error) {
        const name = r.item.name.replace(/\.zip$/i, '');
        if (!installed.includes(name)) installed.push(name);
        ok = true;
      } else {
        for (const pkg of candidates) {
          if (installed.includes(pkg)) { ok = true; break; }
          updateStatus('saving', `Installing package ${pkg}...`);
          try { r = await importQuiet({ package: pkg }); } catch (_) { r = { error: 'no connection' }; }
          if (!r.error) { installed.push(pkg); ok = true; break; }
        }
      }
      if (ok) progressed = true; else failed.push(file);
    }
    if (!progressed) {
      const final = await compileWithWasm();
      final.log = [`Could not install automatically: ${failed.join(', ')}. Use ⚙ Project → Packages to upload them.`, ...hintsFromLog(final.log || '')].join('\n') + '\n\n' + (final.log || '');
      return final;
    }
    updateStatus('saving', 'Recompiling with the new packages...');
  }
  return compileWithWasm();
}
