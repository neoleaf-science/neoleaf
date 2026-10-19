# Test of the local agent on Windows: installs with the real installer from the site, checks what was installed and writes the result to
# Z:\result.txt (the folder shared with Linux) and a screenshot to Z:\capture-*.png.
$ErrorActionPreference = 'Continue'
$out = 'Z:\result.txt'
Remove-Item $out -ErrorAction SilentlyContinue
function Log($m) { (($m | Out-String).TrimEnd()) | Add-Content -Encoding UTF8 -Path $out }
function Shot($name) {
    try {
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
        $bmp.Save("Z:\capture-$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
    } catch { Log "screenshot $name failed: $_" }
}
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Log "== Windows"
Log "$((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version) user=$env:USERNAME admin=$admin"
Log "== Installation with the site installer (irm https://neoleaf.science/install.ps1 | iex)"
# the output goes straight to the window (not captured: the agent started by the installer would inherit the pipe and the script would never end)
$t0 = Get-Date
try { Invoke-Expression ((Invoke-RestMethod -UseBasicParsing 'https://neoleaf.science/install.ps1') | Out-String) } catch { Log "ERROR during installation: $_" }
Log "installer finished in $([int]((Get-Date) - $t0).TotalSeconds)s"
Start-Sleep -Seconds 8
$bin = Join-Path $env:LOCALAPPDATA 'Programs\neoleaf-agent\neoleaf-agent.exe'
Log "== Installed file"
Log "exists=$(Test-Path $bin) path=$bin"
Log "== Automatic startup (user Run key)"
try { Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' | Select-Object * -ExcludeProperty PS* | Format-List | Out-String | ForEach-Object { Log $_ } } catch { Log "error reading the Run key: $_" }
Log "== Process"
Log (Get-Process neoleaf-agent -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime, Responding | Format-Table | Out-String)
Log "== Porta 47474 e /v1/status"
try { Log (Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:47474/v1/status' | ConvertTo-Json -Compress) } catch { Log "status failed: $_" }
Log "== Agent command line"
foreach ($c in @('version', 'engines')) { try { Log ("neoleaf-agent $c -> " + ((& $bin $c 2>&1) | Out-String).Trim()) } catch { Log "$c failed: $_" } }
Shot 'depois-da-instalacao'
Log "== End (see also Z:\capture-after-install.png)"
