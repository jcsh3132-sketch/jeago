$ErrorActionPreference='Stop'
$previewRoot='C:\Users\PC\Documents\Codex\2026-09-30\d\quote-preview'
$repoRoot=Split-Path $PSScriptRoot -Parent
$node=(Get-Command node).Source
if(-not(Get-NetTCPConnection -LocalPort 3332 -State Listen -ErrorAction SilentlyContinue)){
 Start-Process -FilePath $node -ArgumentList 'original-server.mjs' -WorkingDirectory $previewRoot -WindowStyle Hidden -RedirectStandardOutput "$previewRoot/original-server.log" -RedirectStandardError "$previewRoot/original-server-error.log"
}
$existing=Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match 'quotation-pc.mjs'}
if(-not $existing){
 New-Item -ItemType Directory -Force "$repoRoot/work" | Out-Null
 Start-Process -FilePath $node -ArgumentList 'scripts/quotation-pc.mjs' -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput "$repoRoot/work/quotation-pc.log" -RedirectStandardError "$repoRoot/work/quotation-pc-error.log"
}
Write-Output 'Quotation PC connection launched'
