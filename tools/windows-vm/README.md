# Windows to test the local agent

A Windows 10 LTSC (Microsoft evaluation version) running inside a Docker container (`dockur/windows`: QEMU with KVM). It is for
testing `neoleaf-agent` on Windows without having a Windows at hand. It is disposable: `docker compose down` and deleting `storage/` returns to zero.

## Requirements
- Linux with KVM (`/dev/kvm`), Docker with the `compose` plugin and about 30 GB free (Windows takes 15 to 25 GB; the downloaded ISO is 4.6 GB).
- 3 GB of free RAM (the container scales down by itself if short; below 2.5 GB it gets slow).
- Accept Microsoft's terms of use for the evaluation image (Windows runs without activation, with a watermark).

## Usage
```bash
cd tools/windows-vm
cp ../../static/agent/neoleaf-agent-windows-x86_64.exe ../../static/agent/version.json ../../static/install.ps1 shared/   # optional
docker compose up -d          # the first time it downloads and installs Windows (15 to 30 min)
# the desktop opens at http://localhost:8006
docker compose stop           # clean shutdown (the disk stays in storage/)
```
The `shared/` folder appears in Windows as "Shared" on the desktop (and as drive Z: on the first boot; after a restart the
drive disappears, which is why the scripts use the path of the script itself).

## The test scripts (in `shared/`, run inside Windows with a double click)
- `run.bat` (`test-agent.ps1`): installs with the real installer from the site, checks the file, the Run key, the process, `/v1/status` and takes a screenshot.
- `run2.bat` (`test-compile.ps1`): installs TinyTeX, pairs through the agent API and compiles a small document (saves the PDF).
- `restart.bat`, `verify.bat` (`verify-after-restart.ps1`): check whether the agent came up by itself after a restart.
- `diagnostics.bat`, `test-run.bat`, `fix-run.bat`: read the Windows events and test the Run key.
The results are written to `shared/result*.txt` (and `capture-*.png`, `result.pdf`), which show up on Linux.

## Tips
- Explorer takes minutes to show new files in `shared/`; close and reopen the folder, or wait.
- Typing text through the web viewer does not work for long commands (only single keys), which is why the tests are scripts.
- Clicking on a console window enters selection mode and freezes the script; press Esc.
- On LTSC the default browser is Internet Explorer; Edge is installed.

## What has been verified so far (2026-10-14, agent 0.4.7)
Installation with `install.ps1`, reinstalling over a running agent, tray icon and menu, "Check for updates", "Open NeoLeaf",
TinyTeX (74 MB, SHA-256), pairing and compilation with TinyTeX's pdfLaTeX. **Finding:** startup at login was failing because the Run key value
had mixed slashes (Explorer cut off the beginning of the path); fixed in 0.4.8.
