mod script;
mod style;

/// Assembles the page from its blocks, in document order.
pub fn render() -> String {
    [
        head_start(),
        style::style(),
        page_header(),
        live_status(),
        comparison_open(),
        card_wasm(),
        card_agent(),
        comparison_table(),
        download_install(),
        pairing_steps(),
        agent_commands(),
        security(),
        script::script(),
        page_end(),
    ]
    .concat()
}

/// Document head up to the shared stylesheet link.
fn head_start() -> &'static str {
    r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Compilation Engines & Local Agent - NeoLeaf</title>
    <link rel="icon" type="image/png" href="/static/img/favicon.png">
    <script src="/static/js/theme.js"></script>
    <script src="/static/js/i18n.js"></script>
    <link rel="stylesheet" href="/static/css/editor.css">
"##
}

/// Closes the head and opens the body with the navigation bar and badges.
fn page_header() -> &'static str {
    r##"</head>
<body class="dashboard-body">
    <div class="agent-container">
        <div class="agent-nav">
            <a href="/" class="btn" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                ← Back to Projects
            </a>
            <div style="display: flex; gap: 8px; align-items: center;">
                <span data-lang-picker></span>
                <span data-theme-picker></span>
            </div>
        </div>

        <header class="agent-header">
            <div class="agent-badges">
                <span class="agent-badge badge-wasm">⚡ WebAssembly (Browser)</span>
                <span class="agent-badge badge-agent">💻 Local Agent (Linux, macOS and Windows)</span>
            </div>
            <h1>Compilation Engines in NeoLeaf</h1>
            <p style="color: var(--muted); margin: 6px 0 0; font-size: 15px;">
                Understand the difference between compiling in the browser and the native local agent, and learn how to choose the best option for your project.
            </p>
        </header>

"##
}

/// Live status box of the agent on this machine.
fn live_status() -> &'static str {
    r##"        <!-- Live status of the agent on this machine -->
        <div id="live-agent-status" class="status-box offline">
            <div>
                <strong id="live-status-title" style="display: block; font-size: 15px; color: var(--text-bright);">
                    Checking for the local agent on this machine...
                </strong>
                <span id="live-status-desc" style="font-size: 13px; color: var(--muted);">
                    Testing the local connection at <code>127.0.0.1:47474</code>...
                </span>
            </div>
            <div id="live-status-action"></div>
        </div>

"##
}

/// Opens the comparison section and its card grid.
fn comparison_open() -> &'static str {
    r##"        <!-- General comparison -->
        <div class="agent-section">
            <h2>🎯 Comparison: WebAssembly vs. Local Agent</h2>
            <p data-i18n-html>
                NeoLeaf was designed with a <strong>Client-First & Privacy by Design</strong> philosophy: unlike traditional platforms that send your papers to queues on remote servers, in NeoLeaf compilation happens right in the user's hands.
            </p>

            <div class="comparison-grid">
"##
}

/// Comparison card for WebAssembly.
fn card_wasm() -> &'static str {
    r##"                <!-- Card 1: WebAssembly -->
                <div class="mode-card">
                    <div class="mode-title">
                        <span style="font-size: 20px;">⚡</span> WebAssembly (Browser)
                    </div>
                    <span style="font-size: 12px; color: var(--muted); font-weight: 500;">NeoLeaf default · No installation</span>
                    <ul class="mode-list">
                        <li data-i18n-html><strong>100% in the browser:</strong> Compilation with TeX Live WebAssembly (texlive-wasm / BusyTeX) run by your device's processor.</li>
                        <li data-i18n-html><strong>Absolute privacy:</strong> No code, confidential text or research data is sent to the server for compilation.</li>
                        <li data-i18n-html><strong>Zero dependencies:</strong> Works in any modern browser (Chrome, Firefox, Safari, Edge) on any operating system (Linux, macOS, Windows).</li>
                        <li data-i18n-html><strong>Fonts and packages on demand:</strong> Common packages and math fonts are downloaded and kept in the IndexedDB cache.</li>
                    </ul>
                </div>

"##
}

/// Comparison card for the local agent.
fn card_agent() -> &'static str {
    r##"                <!-- Card 2: Local Agent -->
                <div class="mode-card featured">
                    <div class="mode-title">
                        <span style="font-size: 20px;">💻</span> Local Agent (neoleaf-agent)
                    </div>
                    <span style="font-size: 12px; color: var(--green); font-weight: 600;">Maximum speed · The machine's TeX Live / Tectonic</span>
                    <ul class="mode-list">
                        <li data-i18n-html><strong>Native compilers:</strong> Uses the TeX Live, TinyTeX or Tectonic installed on your own machine (pdfLaTeX, XeLaTeX, LuaLaTeX).</li>
                        <li data-i18n-html><strong>Ultra fast for large projects:</strong> Ideal for large theses, books, dissertations and documents with advanced TikZ.</li>
                        <li data-i18n-html><strong>System fonts:</strong> Unrestricted access to TrueType/OpenType fonts installed on your operating system with XeLaTeX or LuaLaTeX.</li>
                        <li data-i18n-html><strong>Auto-install with tlmgr:</strong> If a package (.sty) is missing, the agent installs it automatically with the local TeX Live and recompiles.</li>
                    </ul>
                </div>
            </div>

"##
}

/// Feature comparison table, closes the comparison section.
fn comparison_table() -> &'static str {
    r##"            <div class="table-wrap">
                <table class="comp-table">
                    <thead>
                        <tr>
                            <th>Feature</th>
                            <th>⚡ WebAssembly (Browser)</th>
                            <th>💻 Local Agent (neoleaf-agent)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td data-i18n-html><strong>Where compilation runs</strong></td>
                            <td>In the user's browser tab</td>
                            <td>Natively on the user's machine</td>
                        </tr>
                        <tr>
                            <td data-i18n-html><strong>Sends TeX code to the server?</strong></td>
                            <td data-i18n-html><span style="color:var(--green);font-weight:600;">Never</span> (100% private)</td>
                            <td data-i18n-html><span style="color:var(--green);font-weight:600;">Never</span> (100% private)</td>
                        </tr>
                        <tr>
                            <td data-i18n-html><strong>Requires prior installation</strong></td>
                            <td>None (open and use)</td>
                            <td>Yes (requires a local TeX Live or Tectonic)</td>
                        </tr>
                        <tr>
                            <td data-i18n-html><strong>Supported engines</strong></td>
                            <td>pdfLaTeX (wasm)</td>
                            <td>pdfLaTeX, XeLaTeX, LuaLaTeX, Tectonic</td>
                        </tr>
                        <tr>
                            <td data-i18n-html><strong>Operating system fonts</strong></td>
                            <td>Only bundled packages</td>
                            <td>Any font installed on the system</td>
                        </tr>
                        <tr>
                            <td data-i18n-html><strong>Automatic package installation</strong></td>
                            <td>Download via web cache (.tar.gz)</td>
                            <td data-i18n-html>Automatic via the local <code>tlmgr</code></td>
                        </tr>
                        <tr>
                            <td data-i18n-html><strong>Operating systems</strong></td>
                            <td>Any OS (Linux, Windows, Mac, mobile)</td>
                            <td>Linux (x86_64), macOS (Intel and Apple Silicon) and Windows 10/11</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

"##
}

/// Download section and quick install commands.
fn download_install() -> &'static str {
    r##"        <!-- Agent download & installation -->
        <div class="agent-section" id="download-section">
            <h2>📦 Download and Install the Local Agent</h2>
            <p data-i18n-html>
                The <code>neoleaf-agent</code> is a lightweight, secure executable written in Rust. It listens only on <code>127.0.0.1:47474</code>, accepts only requests coming from NeoLeaf (<code>https://neoleaf.science</code>) and requires a one-time pairing code to authorize access.
            </p>

            <div style="margin: 24px 0; text-align: center;">
                <a href="/static/agent/neoleaf-agent-linux-x86_64" class="dl-hero-btn" download="neoleaf-agent-linux-x86_64">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>Download neoleaf-agent for Linux (x86_64)</span>
                    <span style="font-size: 12px; opacity: 0.85; font-weight: normal;">(~2.5 MB)</span>
                </a>
                <div style="margin-top: 10px;">
                    <a href="/static/agent/neoleaf-agent-macos-universal" download="neoleaf-agent-macos-universal" style="font-size: 13.5px;">Download for macOS (Intel and Apple Silicon)</a>
                    <span style="color: var(--muted);"> · </span>
                    <a href="/static/agent/neoleaf-agent-windows-x86_64.exe" download="neoleaf-agent-windows-x86_64.exe" style="font-size: 13.5px;">Download for Windows 10/11 (x86_64)</a>
                </div>
            </div>

            <h3 style="font-size: 16px; color: var(--text-bright); margin-top: 24px;">Quick install (one command)</h3>
            <p style="font-size: 13.5px; color: var(--text-primary);" data-i18n-html>Copy and paste into the terminal. The script downloads the agent, checks the SHA-256, installs it in <code>~/.local/bin</code> and registers your user's service (no sudo). If the machine has no LaTeX, it offers to install TinyTeX.</p>
            <div class="code-box">
                <button class="code-copy-btn" onclick="copyCode(this)">Copy</button>
<span id="install-cmd-text">curl -fsSL https://neoleaf.science/install.sh | sh</span>
            </div>
            <p style="font-size: 12.5px; color: var(--muted); margin-top: -10px;" data-i18n-html>Linux x86_64 and macOS (Intel and Apple Silicon), no sudo. On macOS the agent becomes a LaunchAgent of your user. The script checks the download's SHA-256. <a href="/install.sh">View the script</a></p>
            <h3 style="font-size: 16px; color: var(--text-bright); margin-top: 20px;">Windows (PowerShell)</h3>
            <div class="code-box">
                <button class="code-copy-btn" onclick="copyCode(this)">Copy</button>
<span id="install-cmd-text-win">irm https://neoleaf.science/install.ps1 | iex</span>
            </div>
            <p style="font-size: 12.5px; color: var(--muted); margin-top: -10px;" data-i18n-html>Windows 10 or 11, no administrator. Installs in <code>%LOCALAPPDATA%\Programs\neoleaf-agent</code> and starts with your session. The script checks the download's SHA-256. <a href="/install.ps1">View the script</a></p>
            <p style="font-size: 13.5px; color: var(--text-primary);">Prefer to download the file and install it by hand? Use the steps below.</p>

"##
}

/// Pairing steps (browser and agent).
fn pairing_steps() -> &'static str {
    r##"            <h3 style="font-size: 16px; color: var(--text-bright); margin-top: 24px;">Step 1: Install as a user service (systemd)</h3>
            <p style="font-size: 13.5px; color: var(--text-primary);">
                After downloading the file to your Downloads folder, open the terminal and run:
            </p>
            <div class="code-box">
                <button class="code-copy-btn" onclick="copyCode(this)">Copy</button>
chmod +x neoleaf-agent-linux-x86_64
./neoleaf-agent-linux-x86_64 install
            </div>
            <p style="font-size: 12.5px; color: var(--muted); margin-top: -10px;" data-i18n-html>
                The <code>install</code> command registers the agent with <code>systemd --user</code> to start automatically with your session and enables the tray icon (StatusNotifierItem / Tray). On macOS, the file is <code>neoleaf-agent-macos-universal</code> and the service is a LaunchAgent (no tray icon); prefer the one-line command above.
            </p>

            <h3 style="font-size: 16px; color: var(--text-bright); margin-top: 20px;">Step 2: Pairing in the Editor</h3>
            <p style="font-size: 13.5px; color: var(--text-primary);" data-i18n-html>
                Open your project in NeoLeaf. The <strong>💻 Local (pdfLaTeX / XeLaTeX / LuaLaTeX / Tectonic)</strong> engine will appear in the compilation selector in the top bar. When you click to compile for the first time, the agent:
            </p>
            <ul style="font-size: 13.5px; margin-left: 20px;">
                <li>Copies the pairing code to the clipboard automatically (Ctrl+V);</li>
                <li>Shows a notification on your operating system's desktop;</li>
                <li>All you need to do is paste the code into the browser's confirmation dialog (only once).</li>
            </ul>

"##
}

/// Useful agent commands.
fn agent_commands() -> &'static str {
    r##"            <h3 style="font-size: 16px; color: var(--text-bright); margin-top: 20px;">Useful Agent Commands</h3>
            <div class="code-box">
                <button class="code-copy-btn" onclick="copyCode(this)">Copy</button>
# Generate a pairing code (valid for 5 minutes and can be used only once)
./neoleaf-agent-linux-x86_64 code

# List the paired browsers and revoke access for one of them (or all)
./neoleaf-agent-linux-x86_64 devices
./neoleaf-agent-linux-x86_64 revoke <id|all>

# List the compilers found on your machine
./neoleaf-agent-linux-x86_64 engines

# Install TinyTeX (lean LaTeX, for your user only) if the machine has no compiler
./neoleaf-agent-linux-x86_64 install-tinytex

# Update the agent (downloads the version published on the site, checks the SHA-256 and restarts the service)
neoleaf-agent update

# Choose: notify about updates (default), update automatically or do not check
neoleaf-agent auto-update notify|on|off

# Show the version, whether the service is installed and whether it is running
neoleaf-agent status

# Uninstall and remove the system service
./neoleaf-agent-linux-x86_64 uninstall
            </div>
        </div>

"##
}

/// Local agent security section.
fn security() -> &'static str {
    r##"        <!-- Security & Privacy -->
        <div class="agent-section">
            <h2>🔒 Local Agent Security</h2>
            <ul style="margin-left: 20px; font-size: 13.5px;">
                <li data-i18n-html><strong>Localhost only:</strong> The agent listens only on <code>127.0.0.1:47474</code> and does not accept external network connections.</li>
                <li data-i18n-html><strong>Restricted CORS:</strong> Requests are accepted only from the validated origin <code>https://neoleaf.science</code>.</li>
                <li data-i18n-html><strong>Compilation sandbox:</strong> Compilation runs without the unsafe <code>--shell-escape</code> option and inside an isolated directory at <code>~/.cache/neoleaf-agent/work/</code>.</li>
                <li data-i18n-html><strong>Restricted permissions:</strong> The pairing token is saved in <code>~/.config/neoleaf-agent/config.json</code> with <code>0600</code> permissions (readable only by your user).</li>
            </ul>
        </div>
    </div>

"##
}

/// Closes the body and the document.
fn page_end() -> &'static str {
    r##"</body>
</html>
"##
}
