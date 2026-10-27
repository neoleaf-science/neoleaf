# NeoLeaf: release notes

- **1.28.0**: Format Document for LaTeX and BibTeX (Shift+Alt+F), syntax errors and style findings with quick fixes, and "Fix all style issues", with Badness (MIT) running in the browser as WebAssembly. Settings: style checks on or off, wrap mode and width.
- **1.27.0**: the "New file" window has a file type list (LaTeX, BibTeX, Typst, Markdown, Python and others) that sets the extension; any other name can still be typed.
- **1.26.0**: Typst projects (`.typ`): compiled in the browser with the Typst compiler in WebAssembly, with syntax highlighting, outline, spell check, errors in the editor and a "Typst Article" template. Typst packages are fetched by the browser from packages.typst.org.
- **1.25.0**: spell check: no dictionary is hosted by NeoLeaf any more; the browser asks, downloads the dictionary from GitHub (pinned commit, SHA-256 checked) and keeps it on the device. New dictionaries: Portuguese (Portugal), English (UK), Spanish, French, Italian and German.
- **1.24.3**: spell check: the worker and its library are requested with the build version, so a worker kept in the browser or CDN cache can no longer run with a newer page.
- **1.24.2**: spell check: a dictionary that fails to load is tried again by itself, the notice says why, and the runtime has a longer wait on slow machines.
- **1.24.1**: spell check fixes: the Portuguese dictionary now loads (Hunspell in WebAssembly), the language is detected correctly, languages without a dictionary are not checked, and a failed dictionary shows a notice.
- **1.24.0**: in-browser spell check with Hunspell (Portuguese and English), personal project dictionary and automatic document language detection.
- **1.23.2**: licensing and documentation: self-hosting guide, release workflows for the server and the local agent, neutral wording.
- **1.23.1**: first public release.
