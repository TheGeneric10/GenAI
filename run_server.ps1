$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not $env:GENAI_HOST) { $env:GENAI_HOST = "0.0.0.0" }
if (-not $env:GENAI_PORT) { $env:GENAI_PORT = "5000" }
if (-not $env:FIREWORKS_API_KEY) {
    Write-Host "WARNING: FIREWORKS_API_KEY is not set. Backend will run in rule fallback mode."
}
if (-not $env:FIREWORKS_BASE_URL) {
    Write-Host "INFO: FIREWORKS_BASE_URL is not set. Using default https://api.fireworks.ai/inference/v1."
}

$pythonExe = $null
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    $pythonExe = $venvPython
} else {
    $pythonExe = (Get-Command python -ErrorAction Stop).Source
}

& $pythonExe "server.py"
