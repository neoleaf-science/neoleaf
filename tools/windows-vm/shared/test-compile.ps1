# Second part of the test (after test-agent.ps1): installs TinyTeX through the agent, checks the compiler, pairs with the agent through the API
# (as the browser does) and compiles a small document. Result in Z:\result2.txt.
$ErrorActionPreference = 'Continue'
$out = 'Z:\result2.txt'
Remove-Item $out -ErrorAction SilentlyContinue
function Log($m) { (($m | Out-String).TrimEnd()) | Add-Content -Encoding UTF8 -Path $out }
$bin = Join-Path $env:LOCALAPPDATA 'Programs\neoleaf-agent\neoleaf-agent.exe'
Log "== agent: exists=$(Test-Path $bin)"
Log "== engines before"
Log (& $bin engines 2>&1)
Log "== install-tinytex --yes (may take several minutes)"
$sw = [Diagnostics.Stopwatch]::StartNew()
$o = & $bin install-tinytex --yes 2>&1 | Out-String
Log $o
Log "exit code=$LASTEXITCODE in $([int]$sw.Elapsed.TotalSeconds)s"
Log "== engines after"
Log (& $bin engines 2>&1)
$H = @{ Origin = 'https://neoleaf.science' }
try {
    $status = Invoke-RestMethod -UseBasicParsing -Headers $H 'http://127.0.0.1:47474/v1/status'
    Log ("status: " + ($status | ConvertTo-Json -Compress -Depth 5))
    $code = ((& $bin code 2>&1) | Out-String).Split("`n")[0].Trim()
    Log "pairing code obtained: $($code.Length) characters"
    $tok = (Invoke-RestMethod -UseBasicParsing -Method Post -Headers $H -ContentType 'application/json' -Body (@{ code = $code } | ConvertTo-Json) 'http://127.0.0.1:47474/v1/pair/confirm').token
    Log "token obtained: $([bool]$tok)"
    $A = @{ Origin = 'https://neoleaf.science'; Authorization = "Bearer $tok" }
    $tex = "\documentclass{article}`n\begin{document}`nHello from Windows. \textcopyright\ 2026`n\end{document}`n"
    $bytes = [Text.Encoding]::UTF8.GetBytes($tex)
    $sha = (Get-FileHash -InputStream ([IO.MemoryStream]::new($bytes)) -Algorithm SHA256).Hash.ToLower()
    $files = @(@{ path = 'main.tex'; sha256 = $sha })
    $prep = Invoke-RestMethod -UseBasicParsing -Method Post -Headers $A -ContentType 'application/json' -Body (@{ files = $files } | ConvertTo-Json -Depth 5) 'http://127.0.0.1:47474/v1/prepare'
    Log ("prepare needs: " + (@($prep.need).Count) + " content(s)")
    $blobs = @(@{ sha256 = $sha; b64 = [Convert]::ToBase64String($bytes) })
    Log ("blobs: " + (Invoke-RestMethod -UseBasicParsing -Method Post -Headers $A -ContentType 'application/json' -Body (@{ blobs = $blobs } | ConvertTo-Json -Depth 5) 'http://127.0.0.1:47474/v1/blobs' | ConvertTo-Json -Compress))
    $eng = @($status.engines | ForEach-Object { $_.id })
    Log ("engines detected: " + ($eng -join ', '))
    $id = if ($eng -contains 'agent-pdflatex') { 'agent-pdflatex' } else { $eng[0] }
    $body = @{ project = 'teste__windows'; engine = $id; mainFile = 'main.tex'; files = $files } | ConvertTo-Json -Depth 5
    $sw.Restart()
    $r = Invoke-RestMethod -UseBasicParsing -Method Post -Headers $A -ContentType 'application/json' -Body $body -TimeoutSec 600 'http://127.0.0.1:47474/v1/compile'
    Log "compilation with $id : success=$($r.success) in $([int]$sw.Elapsed.TotalSeconds)s engine_used=$($r.engine_used)"
    if ($r.pdf_base64) { $pdf = [Convert]::FromBase64String($r.pdf_base64); [IO.File]::WriteAllBytes('Z:\result.pdf', $pdf); Log "PDF received: $($pdf.Length) bytes, starts with: $([Text.Encoding]::ASCII.GetString($pdf[0..4]))" }
    Log "-- end of the compilation log --"
    $lg = [string]$r.log
    Log ($lg.Substring([Math]::Max(0, $lg.Length - 700)))
} catch { Log "ERROR: $($_.Exception.Message)"; try { Log ((New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()) } catch {} }
Log "== End"
