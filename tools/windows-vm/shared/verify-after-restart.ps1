# After restarting: did the agent start by itself (Run key)? Result in result3.txt, in the same folder as this script (the shared folder).
$out = Join-Path $PSScriptRoot 'result3.txt'
Remove-Item $out -ErrorAction SilentlyContinue
function Log($m) { (($m | Out-String).TrimEnd()) | Add-Content -Encoding UTF8 -Path $out }
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
Log "Windows start: $boot ($([int]((Get-Date) - $boot).TotalSeconds)s ago) user=$env:USERNAME"
Log "== user Run key"
try { Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' | Select-Object * -ExcludeProperty PS* | Format-List | Out-String | ForEach-Object { Log $_ } } catch { Log "error: $_" }
$p = Get-Process neoleaf-agent -ErrorAction SilentlyContinue
Log "agent process: $(@($p).Count) | start: $($p.StartTime) | started after boot: $(if ($p) { $p.StartTime -gt $boot } else { 'n/a' })"
try { Log ("status: " + (Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:47474/v1/status' | ConvertTo-Json -Compress -Depth 4)) } catch { Log "status failed: $_" }
Log "== drive Z: mapped? $(Test-Path 'Z:\')"
Log "== recent application events about the agent"
try { Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $boot } -ErrorAction Stop | Where-Object { $_.Message -match 'neoleaf' } | Select-Object -First 5 TimeCreated, ProviderName, Message | Format-List | Out-String | ForEach-Object { Log $_ } } catch { Log "no events (or error: $($_.Exception.Message))" }
Log "== End"
