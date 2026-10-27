# NeoLeaf: what the system does

A list of the features that exist today (version **1.14.11**, 2026-10-17). For the
history, `RELEASE_NOTES.md`; for the architecture rules, `AGENTS.md`. Each item describes what the system does, without promising
more than that: the known limits are at the end of each section and in the "General limits" section.

NeoLeaf is a collaborative editor for LaTeX (and other research files) that runs in the browser. **The person's project does not live
on the server**: it lives only in the browser (local Git clone) and in their repository on GitHub or Codeberg.

---

## 1. Projects, Git and account

- **Sign in with GitHub or Codeberg.** Each session belongs to one of the two services. Projects are repositories with the `neoleaf` topic.
- **Project list** with search, tag filter, creation and **trash** (the repository is renamed with the date and gets the tag
  `deleted`; **Restore** brings the name back). Nothing is erased, and only the owner deletes and restores.
- **Tags** (repository topics): add, remove and filter from the dashboard.
- **Create a project** from a starter template (paper, report, Beamer presentation) or from a **catalog template** (see section 8).
- **Import ZIP** (read in the browser itself): up to 200 MB in total, 50 MB per file and 500 files.
  The suggested name follows the repository naming rules.
- **Export** the source code as ZIP (the GitHub one when there is nothing to push, otherwise built in the browser) or just the `.bbl`.
- **Git in the browser** (`isomorphic-git`): commit, **push**, **pull** and **reset** with modals that show commits, files and a line diff.
  Push pulls first if the remote repository has news. **Automatic pull on open** when there are no changes on both sides.
- **Visual conflict resolution** and **line-by-line history (Git Blame)** in the editor margin.
- **Commit author** with the name, login and private (`noreply`) email of the account.
- **Optional automatic sync** per project (configurable interval, from 1 minute).
- **Protection against data loss:** a clone that fails never becomes an empty repository (it shows the error and offers "Try again"); the browser is
  asked not to erase the data; after 10 minutes with unpushed work a warning appears with "Push now".
- **Collaborators:** invite, accept and decline invitations, view and change permissions from the dashboard (on Codeberg the collaborator joins directly).
- **Delete your own account:** erases only what NeoLeaf stores (the session); it does not delete repositories.

**Limits:** Codeberg was tested with a real account, but organizations on real GitHub and some GitHub error messages were not verified.

## 2. LaTeX editor

- **Monaco editor** (the one from VS Code) with highlighting for **LaTeX**, **BibTeX** and **ConTeXt** (`.mkiv`, `.mkxl`, `.mkvi`), folding of sections and environments and hover hints.
- **Smart autocomplete** that understands the project: hundreds of commands and environments, symbols, `\ref` with the labels, `\cite` with the keys from the `.bib` files,
  images, `\input` and `.bib` files; warns about nonexistent references and citations. For ConTeXt there is a command index generated from the official interface.
- **Whole-project structure panel:** starts from the main file and follows `\input`, `\include` and `\subfile`, showing parts, chapters and sections from any file; lists the `.tex` files that are not included.
- **Map tab:** the document as a mind map (sections as branches, images as leaves with a thumbnail), with zoom, drag, collapse and expand. Clicking a node opens the file at the line.
- **Search and replace across the whole project** (Ctrl+Shift+F): whole word, regular expression and case, with undo.
- **Comments and suggestions:** select a passage, comment, reply in a thread and mark as resolved (stored in `.neoleaf/comments.json`).
- **History and milestones:** revision history per file (grouped by person) with restore, and **milestones** (named project snapshots).
- **File tree** with folders, create, rename, duplicate, move, **drag and drop**, upload files and preview images and PDFs.
- **File tabs** with the cursor position remembered, adjustable split bars and the usual editor shortcuts.
- **Interface languages (15):** English, Čeština, Español, Português, Français, Deutsch, Svenska, Türkçe, Italiano, 简体中文, Norsk (Bokmål), Русский, Dansk, 한국어 and 日本語, each by its own name in the picker. One file per language, only the one in use is loaded. The privacy policy and the terms are translated into English, Portuguese, Spanish and Chinese only; in the others the page shows its English text and a notice. **Ten themes** (NeoLeaf, NeoLeaf White, Light, Dark, Catppuccin Mocha and Latte, Dracula, Nord, Gruvbox and Solarized Light) and the option to follow the system.
- **Text toolbar** (LaTeX and Markdown): undo and redo, text style (chapter, section, sizes and others), bold and italic, math (inline or display formula, numbered equation,
- **Format Document, syntax errors and style checks** (LaTeX and BibTeX), in the browser with Badness (WebAssembly): Shift+Alt+F reformats the file (paragraph reflow, one sentence per line, clause breaks or keep your line breaks, width 40 to 200); unclosed environments and braces and style slips (straight quotes, `$$`, `...`, missing non-breaking space, deprecated commands and others) are underlined with a quick fix, and "Fix all style issues" applies the safe ones. LaTeX and BibTeX are drawn in a monospaced font. **Line wrapping** is a personal choice, kept in the browser (Alt+Z or the editor menu cycles it): at the formatter width in LaTeX and BibTeX, so 80 on the screen is the 80 characters the formatter writes (the default; the width is a project setting, 40 to 200 characters), at the window edge, or off. Project settings turn the checks off.
- **Complete and normalize `.bib` by DOI:** in a `.bib`, the editor menu asks Crossref (OpenAlex as a backup) for the DOI of one entry or of all of them and shows what would change before anything is written: missing fields are added, pages become `12--15`, a doi written as a link is cleaned, a url that only repeats the doi is removed, and values that differ from the registry are offered but never replaced unless ticked. Citation keys and layout stay. Only the DOI leaves the browser.
- **Typst** (`.typ`): compiled in the browser by the Typst compiler in WebAssembly (typst.ts in a Web Worker), engine "Browser (Typst / WebAssembly)", no server involved. Syntax highlighting, outline, folding, snippets, errors in the editor and the spell check; "Typst Article" template. One font (New Computer Modern 10 Regular, GPL) is downloaded by the browser from GitHub and cached on the device, not served by NeoLeaf. Typst packages (`@preview/...`) are fetched by the browser from packages.typst.org. Not yet: project fonts, jump from the PDF to the source.
- **Spell check** (LaTeX and Markdown), in the browser: Hunspell dictionaries for Portuguese (Brazil and Portugal), English (US and UK), Spanish, French, Italian and German, chosen from the project setting, the babel or polyglossia language, the text itself or the interface language. Documents in other languages are not checked. NeoLeaf hosts no dictionary: when one is needed the browser asks, downloads it from the LibreOffice dictionaries on GitHub (pinned commit, SHA-256 checked) and keeps it on the device, not in the project. It ignores commands, math, labels, citations, code and URLs; suggestions, "add to the project dictionary" (saved in `.neoleaf/dictionary.txt`) and "ignore in this session" are in the quick-fix menu. It can be turned off per project.
  aligned), **symbols** palette (Greek, operators, relations, arrows), link, comment, label and reference (picks a `\label` from the project), citation (picks a key from the `.bib` or opens the reference search),
  **image** (from the project or uploaded, with the figure ready), **table** (rows and columns grid) and list. Buttons that do not fit go into a menu, and the toolbar can be hidden.
- **Reference search, Python execution and viewers** for several file formats: see sections 5 and 6.
- **Sustainability badges (landing page footer):** the Green Web Foundation badge (checks that the hosting is on green energy; it shows Cloudflare, which fronts the site, as the host; the image comes from their server, requested without a referrer) and a Website Carbon snapshot (rating, grams of CO2 per page view and "cleaner than N% of pages"), written to `site/carbon.json` by `mise run carbon` from the site's public result page and shown from our own server, so visitors make no request to Website Carbon or a CDN. The numbers are a dated snapshot with a link to the full result; refresh them with `mise run carbon` and `mise run deploy:site`.
- **Project titles and local copies in the list:** the owner of a project can give it a display title (the pencil in the list): it is saved in the repository description as `NeoLeaf: <title>`, shows as the label with the repository name below it, the editor header and the page title show it too (the tooltip has the whole title and the repository name; a long title is cut with an ellipsis, and the exported PDF keeps the repository name), and the search finds projects by title and by name. A description the person wrote is never taken for a title and is only replaced after a confirmation. The **Local copy** column says whether each project is in this browser (with its size and an *Unsent changes* mark when the copy has work that is not on GitHub or Codeberg) and has a **Clear** button that removes the local copy after asking.
- **Storage tab (user modal):** a bar with the browser storage used and free, the compiler cache with a button to clear it (the packages and fonts are downloaded again when needed), and the list of projects kept in this browser with their size and a button to remove each local copy. Removing asks first and warns when the copy has changes that are not on GitHub; nothing is deleted on GitHub, and opening the project downloads it again. Only the projects of the signed-in account are listed (the browser may be shared: copies of other accounts are only counted). **Delete all local data**, and **Sign out**, empty everything this site keeps in the browser (asking first when work would be lost); your language and theme stay.
- **NeoLeaf mascot (optional):** an animated helper in the corner of the editor, **off by default** and silent. It thinks while the document compiles, celebrates a success and points to the Logs tab on an error; you can drag it anywhere and double-click it for a trick. Switch it on or off in the user modal (the choice stays in the browser). Nothing is downloaded while it is off, and it stays still when the system asks for reduced motion.

**Limits:** none of the translations got a native speaker's review (the 11 newest languages are machine translations: corrections are welcome); the descriptions of the autocomplete commands are in Portuguese only.

## 3. Compilation

- **In the browser (WebAssembly), nothing to install:** **pdfLaTeX**, **XeLaTeX** and **LuaLaTeX** (TeX Live in WebAssembly), plus **BibTeX** (with Unicode) and **Biber** (biblatex).
- **Packages and fonts on demand:** when the document asks for a `.sty`, `.cls` or font that is missing, NeoLeaf finds the TeX Live package (a stateless proxy downloads it from CTAN) and stores it
  in `.neoleaf/texmf/`. The server keeps only a cache of public TeX Live packages (nothing from projects).
- **Your own TeXMF:** upload of classes, styles and fonts (`.sty`, `.cls`, `.otf`, `.ttf`) with project or global scope.
- **SyncTeX in both directions:** clicking the code takes you to the spot in the PDF; clicking the PDF takes you to the editor line.
- **PDF viewer** with the last PDF stored in the project (opens without recompiling), log diagnostics and a button to download the PDF.
- **Optional local agent** (`neoleaf-agent`, in Rust): compiles with the TeX Live, TinyTeX or Tectonic of the machine itself, installs packages through `tlmgr`, recompiles on its own with XeLaTeX
  or LuaLaTeX when the document uses `fontspec`, and runs on **Linux, macOS and Windows** (tray icon, one-line installer, optional automatic update; the tray status dot was confirmed on Linux).
  It listens only on `127.0.0.1`, accepts only NeoLeaf origins and requires pairing.

**Limits:** there is no compilation engine on the server, on purpose. In real test projects there are known cases: an old, faulty `.bst` (abnTeX2), a class that asks for the Times New Roman
font by name (XeTeX does not accept substitutes) and a BibTeX limit in WebAssembly with very long author lists (the local agent compiles it). The macOS agent was only compiled, not run;
the Windows one was tested in a virtual machine (install, tray, compile and start with the session).

## 4. Live editing

- **Several authors in the same file at the same time** (CRDT with Yjs; the server only relays the updates, in memory), with **colored cursors** and a list of who is present.
- The room is per **project + file**, is born empty (whoever joins first seeds the text from their clone) and disappears when the last participant leaves. Each connection checks access to the repository.
- Saving is local in each browser; each person makes their own commit and push.
- **Lock on the tab:** with two or more people in the same file, a lock appears before the name. Whoever clicks it locks: only that person edits and the others become read-only, seeing the name of who locked. Anyone can unlock. The lock disappears when the person who locked leaves or when only one person is left (the relay discards writes from anyone who does not hold the lock; the state is kept only in the room's memory).

**Limits:** the `.ipynb` has no live editing room (it is a single JSON): one person at a time.

## 5. Other file formats

- **Markdown** (`.md`, `.markdown`): editor and **Preview** tab that follows what you type (tables, tasks, code blocks, images and relative links from the project). Rendered in an
  isolated `iframe`, with sanitized HTML (`marked` + `DOMPurify`).
- **Mermaid** (`.mmd`, `.mermaid`): editor with highlighting, diagram preview in the editor theme, **examples** menu (flowchart, sequence, class, state, ER, Gantt, pie, mind map) and
  **export to SVG and PNG**.
- **CSV and TSV:** text editor and **Preview** tab as a **table** (fixed header, numbered rows, sorting by column, filter, separator choice with automatic detection, limit of
  2,000 rows with "show more") and **copy as LaTeX `tabular`**.
- **Python** (`.py`): **Run** tab (see section 6).
- **Jupyter notebooks** (`.ipynb`): see section 6.

## 6. Python and notebooks in the browser

Everything runs **in the browser, without installing Python** (Pyodide, in WebAssembly), in a `Worker` inside an isolated `iframe`: the script **cannot reach the internet or the NeoLeaf API**.
The engine and each package (numpy, pandas, matplotlib, scipy, sympy) are only downloaded the first time the code uses them.

- **Run `.py`:** ▶ button or Ctrl+Enter. Shows the output in real time, errors with the traceback, the **generated figures** (PNG, SVG) and PDFs, and lets you **Save to the project** (asks before
  replacing). The script reads the project's data files, imports the other `.py` files and writes to the project folders. It has an isolation notice on the first run, a Stop button and a 120 s time limit.
- **`.ipynb` notebooks** in a **modal** with the file list on the left (notebooks, data and images), Jupyter style:
  - code cells with `In [n]` and `Out [n]` prompts, Python highlighting and automatic indentation; text cells in **Markdown with formulas** (KaTeX);
  - text outputs, the result of the last line, **pandas tables**, **matplotlib figures**, images and HTML (sanitized), and errors with colors;
  - **Jupyter keyboard** (command and edit mode; Shift, Ctrl and Alt+Enter, A, B, DD, Z, M, Y, R, C, X, V, J and K) and toolbar (Run, Stop, Restart kernel, Run all, cell type, Clear outputs);
  - **stateful kernel** across cells, which sees the project files and works in the notebook's folder, as in Jupyter;
  - saves on its own in the Jupyter format (keys in alphabetical order, 1-space indentation, whatever NeoLeaf does not understand is preserved); "Save without outputs" option;
  - data and images from the tree open in a viewer, with "Copy path".

**Limits:** Python 3 only (nbformat 4); only the packages in the set above; no `ipywidgets`, `plotly` or other interactive charts; **Stop restarts the kernel**; no autocomplete or hints; shell
commands (`!`) and cell magics (`%%`) do not work; the first use downloads a few MB; tested only on Chromium. The Python engine in production is not yet delivered compressed (larger first load).

## 7. References

- **References tab:** searches papers by title, author, subject or **DOI** across **ten selectable sources**: Crossref, OpenAlex, PubMed, Europe PMC, DOAJ, HAL, Zenodo, OpenAIRE, arXiv and DBLP
  (the first eight are queried directly from the browser; arXiv and DBLP go through a stateless server proxy, without storing the query). Results repeated across sources are merged.
- **Per result:** insert `\cite{key}` at the cursor (creates the entry in the `.bib`, with key `surnameyearword`, without repeating a key or DOI), add only to the `.bib`, copy the BibTeX, open the PDF
  and look for the **open access PDF** (Unpaywall). If there is no `.bib`, it creates `references.bib`.
- **Editor menu:** with selected text, "Search references for the selected text" (and the Ctrl+Alt+R shortcut opens the tab); with a **selected DOI**, "Add this reference by DOI" (replaces the DOI
  with the `\cite`) and "Open this DOI"; with the cursor on a citation key, go to the entry, open the DOI and look for the open PDF; inside a `.bib`, search the paper online, open the DOI, look for the open
  PDF and copy the `\cite{key}`.

**Limits:** the real responses of the sources are not tested automatically (the tests simulate them); Semantic Scholar and CORE are not included; the texts come from third parties and enter only as text.

## 8. Templates and administration

- **Project template catalog:** the administrator registers templates (name, description, institution, language, license, GitHub origin with a pinned version, main file, engine, order) and can import
  ready-made suggestions: **ACM** (sigconf, sigplan, acmsmall, acmtog), **IEEE** (conference and journal), **Elsevier** (numeric and author-year), **Springer LNCS**, **SBC** (papers) and **abnTeX2** (academic work,
  research proposal, technical report). The template files never stay on the server: the browser downloads them through a proxy restricted to the registered repositories.
- **Administration panel** (GitHub only, only for administrators): server metrics (memory, swap, live connections, running version), **users tab** (system users and
  **blocked** ones, with blocking by id, by login and unblocking), **templates tab** and the TeX Live package cache.
- **User blocking:** ends the sessions, prevents new logins and disconnects from live editing; applies by account id, per service.

## 9. Privacy and security (what the system does)

- The server **does not store, cache or log project content**. It stores only the session (token and basic profile), the blocked list, the template catalog (metadata) and public files
  (TeX Live packages, static files). The live editing text stays only in memory.
- **Stateless proxies** (Git, GitHub API, CTAN packages, arXiv and DBLP search, templates): require a session, use fixed or allowed destinations, limit size, time and number of requests and do not log content.
  The GitHub token never goes to the browser.
- **Third-party content is isolated:** Markdown, Mermaid, CSV tables, notebooks and Python execution run in an `iframe` with `sandbox` (no access to the page or the session) and a restrictive content policy;
  HTML is sanitized before it appears and external images in notebooks are discarded.
- Administration and blocking depend on the sign-in service used; each project's permissions are checked in the repository itself on every access.
- This document describes how the system works; it **does not claim compliance with any law or standard**.

## 10. General limits

- Browsers: the automated tests run on Chromium; the others were not verified.
- Pyodide, KaTeX and Mermaid are large libraries, loaded only when the feature is used.
- There is a **pre-existing** test failure on the server (`session::tests::sessions_expire_and_renew`) and some flaky agent tests when a real agent is running on the machine.
