# Installer for the NeoLeaf local agent on Windows (no administrator).
#
#   irm __SITE__/install.ps1 | iex
#
# What it does: downloads the agent from __SITE__, checks the SHA-256 published in version.json, copies it to
# %LOCALAPPDATA%\Programs\neoleaf-agent and registers startup with your session (the user's Run key).
# Nothing is installed outside your home folder. To read it before running: irm __SITE__/install.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Site = if ($env:NEOLEAF_SITE) { $env:NEOLEAF_SITE } else { '__SITE__' }
$Site = $Site.TrimEnd('/')

function Fail($msg) { Write-Host "Error: $msg" -ForegroundColor Red; throw $msg }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('neoleaf-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host "Downloading the NeoLeaf agent from $Site ..."
    try { $info = Invoke-RestMethod -UseBasicParsing "$Site/static/agent/version.json" } catch { Fail "could not download $Site/static/agent/version.json" }
    $expected = [string]$info.sha256_windows
    if ($expected -notmatch '^[0-9a-fA-F]{64}$') { Fail 'could not find the SHA-256 of the Windows agent in version.json: I will not install without being able to verify.' }
    $exe = Join-Path $tmp 'neoleaf-agent.exe'
    try { Invoke-WebRequest -UseBasicParsing "$Site/static/agent/neoleaf-agent-windows-x86_64.exe" -OutFile $exe } catch { Fail 'could not download the agent.' }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $exe).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) { Fail 'the SHA-256 of the downloaded file does not match the published one. Nothing was installed.' }
    Unblock-File -Path $exe
    Write-Host "Agent $($info.version) downloaded and verified (SHA-256)."

    $bin = Join-Path $env:LOCALAPPDATA 'Programs\neoleaf-agent\neoleaf-agent.exe'
    & $exe install
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host "Could not register automatic startup. You can run the agent by hand: $bin launch"
        throw 'install failed'
    }

    # No LaTeX compiler? Offers to install TinyTeX.
    $engines = (& $bin engines 2>&1 | Out-String)
    if ($engines -match 'Nenhum compilador|No compiler') {
        Write-Host ''
        Write-Host 'This machine does not have a LaTeX compiler yet (MiKTeX, TeX Live, TinyTeX or Tectonic).'
        $answer = Read-Host 'Install TinyTeX now? [y/N]'
        if ($answer -match '^(y|yes)$') {
            & $bin install-tinytex --yes
            if ($LASTEXITCODE -ne 0) { Write-Host "The TinyTeX installation failed; try again later: & '$bin' install-tinytex" }
        } else {
            Write-Host "All right. Whenever you want: & '$bin' install-tinytex"
        }
    }

    Write-Host ''
    Write-Host 'Done. Open a project in NeoLeaf and choose the "Local" engine in the compile selector.'
    Write-Host 'On the first compilation the browser asks for the pairing code (the agent also shows it in a notification).'
    Write-Host "To generate a code now: & '$bin' code"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
