param(
    [string]$LauncherName = "GenAI Server Autorun.cmd",
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startupDir = [Environment]::GetFolderPath("Startup")
$launcherPath = Join-Path $startupDir $LauncherName

$launcher = @"
@echo off
cd /d "$projectRoot"
set GENAI_HOST=0.0.0.0
if not defined GENAI_PORT set GENAI_PORT=5000
if exist ".venv\Scripts\python.exe" (
  start "" /min ".venv\Scripts\python.exe" "server.py"
) else (
  start "" /min python "server.py"
)
"@

Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding Ascii
Write-Host "Autorun launcher installed: $launcherPath"

if ($StartNow) {
    & $launcherPath
    Write-Host "Launcher executed: $launcherPath"
}
