# A/B startup test: looks in the Windows events for any mention of the agent and swaps the slashes of the Run key value for \.
# Then restart Windows and run verify.bat. Result in result6.txt.
$out = Join-Path $PSScriptRoot 'result6.txt'
Remove-Item $out -ErrorAction SilentlyContinue
function Log($m) { (($m | Out-String).TrimEnd()) | Add-Content -Encoding UTF8 -Path $out }
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
foreach ($log in @('Microsoft-Windows-Shell-Core/Operational', 'Microsoft-Windows-Explorer/Operational', 'Microsoft-Windows-AppModel-Runtime/Admin', 'System', 'Application')) {
    try {
        $ev = Get-WinEvent -FilterHashtable @{ LogName = $log; StartTime = $boot } -ErrorAction Stop | Where-Object { $_.Message -match 'neoleaf' -or $_.Message -match '\\Run\\' } | Select-Object -First 5
        Log "$log : $(@($ev).Count) event(s) with 'neoleaf' or Run key"
        $ev | ForEach-Object { Log ("  " + $_.TimeCreated + " id=" + $_.Id + " " + ($_.Message -replace '\s+', ' ').Substring(0, [Math]::Min(300, $_.Message.Length))) }
    } catch { Log "$log : no access ($($_.Exception.Message))" }
}
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$v = (Get-ItemProperty $key).NeoLeafAgent
$fix = $v -replace '/', '\'
Set-ItemProperty -Path $key -Name NeoLeafAgent -Value $fix
Log "value before: $v"
Log "value after : $((Get-ItemProperty $key).NeoLeafAgent)"
Log "== End (now restart Windows and run verify.bat)"
