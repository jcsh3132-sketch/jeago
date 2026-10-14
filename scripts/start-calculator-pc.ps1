$ErrorActionPreference = 'Stop'
$calculatorRoot = Split-Path $PSScriptRoot -Parent
$calculatorNode = (Get-Command node).Source
$calculatorRunning = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'scripts[\\/]calculator-pc\.ts' }
if ($calculatorRunning) {
  Write-Output 'Calculator PC connector is already running.'
  exit 0
}
New-Item -ItemType Directory -Force -Path (Join-Path $calculatorRoot 'work') | Out-Null
$calculatorProcess = Start-Process -FilePath $calculatorNode -ArgumentList @('node_modules/tsx/dist/cli.mjs','scripts/calculator-pc.ts') -WorkingDirectory $calculatorRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $calculatorRoot 'work/calculator-pc.log') -RedirectStandardError (Join-Path $calculatorRoot 'work/calculator-pc-error.log') -PassThru
Write-Output "Calculator PC connector started (PID $($calculatorProcess.Id))."
