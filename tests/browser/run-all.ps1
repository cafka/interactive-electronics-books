# Browser checks of the engine on every screen size, one Chrome at a time (sequential, so a small machine copes).
# Needs: `npm start` running (http://127.0.0.1:5173), Node.js 18+ on the PATH, Google Chrome.
# Optional environment: CHROME (path to chrome.exe), BASE_URL (default http://127.0.0.1:5173).
# Results: tests/browser/out/layout-<device>-<port>.txt, screenshots L-<book>-<device>-*.png, summary-9421.md,
# downloaded guides in downloads-w390 / downloads-desktop and their screenshots in Chrome's PDF viewer (pdfview).
$here = $PSScriptRoot
$out = Join-Path $here 'out'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$log = Join-Path $out 'run-all.txt'
"start $(Get-Date -Format s)" | Set-Content $log
$port = 9420
foreach ($d in 'w320', 'w360', 'w390', 'w430', 'phone-land', 'tablet-portrait', 'tablet-land', 'desktop') {
  $port++
  $pdf = if ($d -eq 'desktop' -or $d -eq 'w390') { 'pdf' } else { '' }
  "$d port $port begin $(Get-Date -Format s)" | Add-Content $log
  & node (Join-Path $here 'cdp-layout.mjs') $out $d $port all $pdf *> (Join-Path $out "console-$d.txt")
  "$d end $(Get-Date -Format s)" | Add-Content $log
}
& node (Join-Path $here 'summarize.mjs') $out 9421
& node (Join-Path $here 'pdf-open.mjs') (Join-Path $out 'downloads-desktop') (Join-Path $out 'pdfview') 9460
"all done $(Get-Date -Format s)" | Add-Content $log
