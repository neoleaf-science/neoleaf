# Why did the agent not start at login? Reads what Windows recorded about the Run key. Result in result5.txt.
$out = Join-Path $PSScriptRoot 'result5.txt'
Remove-Item $out -ErrorAction SilentlyContinue
function Log($m) { (($m | Out-String).TrimEnd()) | Add-Content -Encoding UTF8 -Path $out }
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
Log "boot: $boot"
Log "explorer: $((Get-Process explorer -ErrorAction SilentlyContinue | Select-Object -First 1).StartTime)"
Log "== StartupApproved\Run (01 or 02 = enabled; 03 = disabled)"
try { $k = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' -ErrorAction Stop; Log (($k.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { "$($_.Name) = $(($_.Value | ForEach-Object { '{0:x2}' -f $_ }) -join ' ')" }) -join "`n") } catch { Log "no StartupApproved entry for the user (default: enabled)" }
Log "== Startup commands Windows knows about"
Log (Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User | Format-List | Out-String)
Log "== Shell-Core/Operational since boot (Run key processing)"
try { Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Shell-Core/Operational'; StartTime = $boot } -ErrorAction Stop | Select-Object -First 40 TimeCreated, Id, Message | Format-List | Out-String | ForEach-Object { Log $_ } } catch { Log "no events: $($_.Exception.Message)" }
Log "== Windows Defender/Operational since boot (detections and blocks)"
try { Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; StartTime = $boot } -ErrorAction Stop | Where-Object { $_.Id -in 1116, 1117, 1118, 1119, 1121, 1122, 5007, 5001 } | Select-Object -First 15 TimeCreated, Id, Message | Format-List | Out-String | ForEach-Object { Log $_ } } catch { Log "no Defender events: $($_.Exception.Message)" }
Log "== Application: errors since boot"
try { Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 1, 2; StartTime = $boot } -ErrorAction Stop | Select-Object -First 8 TimeCreated, ProviderName, Message | Format-List | Out-String | ForEach-Object { Log $_ } } catch { Log "no application errors" }
Log "== End"
