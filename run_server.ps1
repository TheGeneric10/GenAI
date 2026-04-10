$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not $env:GENAI_HOST) { $env:GENAI_HOST = "0.0.0.0" }
if (-not $env:GENAI_PORT) { $env:GENAI_PORT = "5000" }

$pythonExe = $null
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    $pythonExe = $venvPython
} else {
    $pythonExe = (Get-Command python -ErrorAction Stop).Source
}

& $pythonExe "server.py"
