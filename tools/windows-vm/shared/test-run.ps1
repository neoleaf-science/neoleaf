# Installs the NEW agent (the .exe in this folder) over the old one and checks the Run key value and the running version. result7.txt.
$out = Join-Path $PSScriptRoot 'result7.txt'
Remove-Item $out -ErrorAction SilentlyContinue
function Log($m) { (($m | Out-String).TrimEnd()) | Add-Content -Encoding UTF8 -Path $out }
$src = Join-Path $PSScriptRoot 'neoleaf-agent-windows-x86_64.exe'
$tmp = Join-Path $env:TEMP 'neoleaf-agent-novo.exe'
Copy-Item $src $tmp -Force
Log "sha256 of the new exe: $((Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower().Substring(0, 16))"
Log ("version of the new exe: " + ((& $tmp version 2>&1) | Out-String).Trim())
Log "== neoleaf-agent install (output)"
$o = Join-Path $env:TEMP 'install-out.txt'
Start-Process -FilePath $tmp -ArgumentList 'install' -NoNewWindow -RedirectStandardOutput $o
Start-Sleep -Seconds 10
Log (Get-Content $o -Raw)
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Log "Run key value: $((Get-ItemProperty $key).NeoLeafAgent)"
try { Log ("agent running: version " + (Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:47474/v1/status').version) } catch { Log "status failed: $_" }
Log "== End"
