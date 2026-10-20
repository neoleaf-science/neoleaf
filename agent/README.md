# neoleaf-agent

NeoLeaf local agent: lets the web editor compile with the LaTeX of **this machine** (TeX Live, TinyTeX, Tectonic).
Linux (x86_64), macOS (Intel and Apple Silicon) and Windows 10/11.

Quick install (Linux x86_64 or macOS, no sudo): copy and paste into the terminal.

```bash
curl -fsSL https://neoleaf.science/install.sh | sh
```

The script downloads the agent, checks the SHA-256 published at `/static/agent/version.json`, installs it at `~/.local/bin/neoleaf-agent`, registers
the user service (`systemd --user` on Linux, LaunchAgent on macOS) and, if the machine has no LaTeX, asks whether to install TinyTeX. It does not run as root. Its
content is the repository's `static/install.sh` (you can read it first: `curl -fsSL https://neoleaf.science/install.sh | less`).

Or by hand:

```bash
chmod +x neoleaf-agent-linux-x86_64
./neoleaf-agent-linux-x86_64 install      # copies to ~/.local/bin and registers the service (systemd --user); running it again = updates and restarts
./neoleaf-agent update                    # downloads the version published on the site (SHA-256 checked) and restarts the service
./neoleaf-agent status                    # version, service and whether it is running
./neoleaf-agent auto-update on|notify|off  # update by itself, only notify (default) or do not query
./neoleaf-agent rollback                  # goes back to the previous version
./neoleaf-agent-linux-x86_64 code         # generates a pairing code (5 min, single use)
./neoleaf-agent-linux-x86_64 devices      # paired browsers
./neoleaf-agent-linux-x86_64 revoke <id|all>  # revokes the access of one browser (or of all)
./neoleaf-agent-linux-x86_64 engines      # lists the compilers found
./neoleaf-agent-linux-x86_64 install-tinytex  # installs TinyTeX in ~/.TinyTeX (if there is no compiler); or from the tray icon
```

In NeoLeaf, the "💻 Local (…)" engine appears in the selector when the agent is running. On the first compilation the browser
asks for the pairing code (only once): at that moment the agent **copies the code to the clipboard** and
shows it in a **system notification** (needs `wl-copy`/`xclip`/`xsel` and `notify-send`; if they are missing, use
`neoleaf-agent code`).

- **No LaTeX on the machine?** `neoleaf-agent install-tinytex` (or "Install TinyTeX" in the tray icon) installs
  [TinyTeX](https://yihui.org/tinytex/) in `~/.TinyTeX`, without root: it shows what it is going to do and asks first. It downloads the package
  from the official releases and **checks the SHA-256** that GitHub publishes (nothing is executed straight from the internet). If there is already a
  compiler (TeX Live, TinyTeX, Tectonic), it installs nothing and the agent uses what exists. It needs `perl`, `tar`, `xz` and
  `curl` or `wget`; if something is missing, it shows your distribution's command (apt, dnf, pacman, zypper, apk). Linux x86_64, arm64
  and musl. `neoleaf-agent uninstall-tinytex` removes it.
- **Updates:** by default (`notify`) the agent queries `neoleaf.science/static/agent/version.json` at startup and every 24 h
  and notifies through a notification, the tray icon ("Update the agent...") and NeoLeaf itself. `auto-update on` installs by itself
  when the agent is idle (only if installed as a service); `auto-update off` queries nothing. The update checks the
  published SHA-256 and the version of the downloaded binary, keeps the previous one (`rollback`) and restarts the service. Note: the hash comes from the
  same site as the binary, so it protects against a corrupted download, not against a compromised site.
- **Pairing:** the code (`XXXX-XXXX-XXXX`) is valid for 5 minutes, 5 attempts and a **single use**. When it is typed, the browser receives its own
  token; the agent keeps only the hash (`~/.config/neoleaf-agent/devices.json`, permission 0600). The token expires after 90 days
  without use, at most 20 browsers can be paired and each one can be revoked. Old installations (permanent code) keep
  working until `neoleaf-agent revoke legacy`.
- It listens only on `127.0.0.1:47474` and only accepts requests coming from `https://neoleaf.science` (and from `localhost` in
  development). Other addresses: `NEOLEAF_ORIGINS=https://my.domain ./neoleaf-agent-linux-x86_64`.
- It compiles without shell-escape, with a 5-minute limit, in `~/.cache/neoleaf-agent/work/<project>` (the folder is kept,
  so `latexmk` reuses the auxiliary files on recompilations).
- It needs `latexmk` + `pdflatex`/`xelatex`/`lualatex`, `tectonic` or `context`.
- **ConTeXt** (since 0.4.4): if the `context` command is on the PATH, or installed in `~/context/tex/texmf-<platform>/bin`
  (standalone ConTeXt/LMTX), it appears as the "ConTeXt" engine. The main file can be `.tex`, `.mkiv` or `.mkxl`.
  The agent runs `context --nonstopmode` (which already does the necessary passes) and returns the PDF and the log. There is still **no**
  automatic installation of ConTeXt modules nor SyncTeX. The engine only exists in the agent, not in the browser.
- Build: `mise run agent` (Debian bookworm container → runs on any recent distribution).

- If a package is missing (`File 'xstring.sty' not found`), the agent installs it with `tlmgr` (the user's TinyTeX or TeX Live) and
  compiles again, up to 8 rounds. Turn it off in ⚙ Project → "Automatically install missing packages". On a system
  TeX Live (without write permission) `tlmgr` fails and the log shows what was missing.

- **Tray icon** (StatusNotifierItem: KDE, GNOME with AppIndicator, Waybar, DankMaterialShell...): shows that the agent
  is running, with a menu to copy the pairing code, open NeoLeaf and quit. Without a tray, the agent carries on normally;
  `--no-tray` turns the icon off.

## macOS

- The same one-line command works. The binary is universal (`neoleaf-agent-macos-universal`) and gets a local ad hoc signature
  (`codesign --sign -`), which Apple Silicon requires; it needs no developer account. Files downloaded with `curl` do not go through
  Gatekeeper; if you download through the browser, run `xattr -d com.apple.quarantine neoleaf-agent-macos-universal`.
- Service: `~/Library/LaunchAgents/science.neoleaf.agent.plist` (log in `~/Library/Logs/neoleaf-agent.log`).
- Configuration in `~/Library/Application Support/neoleaf-agent`, cache in `~/Library/Caches/neoleaf-agent`.
- TinyTeX in `~/Library/TinyTeX` (`neoleaf-agent install-tinytex`); it also sees MacTeX (`/Library/TeX/texbin`) and Homebrew.
- No menu bar icon for now; the pairing code goes to the clipboard and to a notification.

## Windows

In PowerShell (no administrator):

```powershell
irm https://neoleaf.science/install.ps1 | iex
```

- The script downloads `neoleaf-agent-windows-x86_64.exe`, checks the SHA-256 from `version.json` and runs `neoleaf-agent install`, which copies the
  executable to `%LOCALAPPDATA%\Programs\neoleaf-agent` and registers startup in the `HKCU\...\Run` key (`launch` command, which
  starts the agent without a console window). Updating or reinstalling stops the running copy and starts the new one.
- Configuration in `%APPDATA%\neoleaf-agent`, cache in `%LOCALAPPDATA%\neoleaf-agent`.
- TinyTeX in `%APPDATA%\TinyTeX` (`neoleaf-agent install-tinytex`, self-extracting package checked by SHA-256); it also sees MiKTeX and TeX Live.
- No tray icon for now; the pairing code goes to the clipboard and to a notification.
- The executable is not digitally signed: SmartScreen may warn if it is downloaded through the browser (`irm` does not trigger the warning).

## Tray icon (Linux)

- **Menu (0.4.9):** opens with the **left and the right click** (`ItemIsMenu`) and has short lines, which trays do not cut with "...": "Agente rodando · porta N" (or "Compiling... · porta N"), "Versão X · up to date" (or "· new: Y"), "Compilers (n)" with the list in a submenu, and the actions. On Windows the left click also opens the menu (`with_menu_on_left_click`); this was only checked at compile time, not executed. Some labels are still in Portuguese on purpose (see the owner's notes): the E2E tests match them.
- The menu shows the version, "Verificar atualizações" (checks the site right away), and, if there is a new version, "Update the agent to
  version X" and the "Update available" line. The icon tooltip also warns. The automatic check runs at startup and every 6 h.
- **Boot:** if the service starts before the tray exists, the agent waits for it to appear and registers the icon then. Every 20 s it
  checks on D-Bus that the icon is registered in the tray and, if the tray exists and the icon is not (2 checks in a row), recreates it.
  `NEOLEAF_TRAY_CHECK_SECS` changes the interval (used in tests).

### Windows tray icon (since 0.4.7)

On Windows the agent runs in the user's session (Run key) and now shows an icon in the notification area, with the status dot
(red compiling, green idle) and a menu: version (with the update line), "Update the agent", "Verificar atualizações",
"Abrir o NeoLeaf" and "Quit". The TinyTeX and pairing code items are not in this menu yet (on Linux they are). **It was only
compiled, not executed on a real Windows.** (Update of 2026-10-14: it has now been executed on a real Windows 10 LTSC, in
a QEMU/KVM container, see `tools/windows-vm/`: installation through `install.ps1`, icon and menu, "Verificar atualizações", "Abrir o NeoLeaf",
TinyTeX, pairing and compilation through the API, and startup at login, which **failed** in 0.4.7 because of the mixed slashes of the path in the Run
key and was fixed in 0.4.8. Not tested yet: pairing through the browser on Windows, the red dot during compilation and the
update flow to a new version.)

## Releases and verification

Each agent version is also published as a GitHub release with the tag `agent-vX.Y.Z` (the tag must match `version` in `Cargo.toml`). The workflow
`.github/workflows/release-agent.yml` builds the agent natively on Linux, macOS (universal) and Windows, runs the tests and a smoke run on each,
and attaches the three binaries, a `SHA256SUMS` file and a build provenance attestation. To verify a download:

```bash
sha256sum -c SHA256SUMS
gh attestation verify neoleaf-agent-linux-x86_64 --repo neoleaf-science/neoleaf
```

The recommended install is still `install.sh`, which checks the SHA-256 published by neoleaf.science. Those binaries are built separately (in a
Debian container and with `cargo-zigbuild`), so they are not byte-identical to the ones in the GitHub release.

To publish: update the version in `agent/Cargo.toml`, commit, then `git tag agent-vX.Y.Z && git push origin agent-vX.Y.Z`.
