param(
    [string]$LauncherName = "GenAI Server Autorun.cmd"
)

$ErrorActionPreference = "Stop"

$startupDir = [Environment]::GetFolderPath("Startup")
$launcherPath = Join-Path $startupDir $LauncherName

if (Test-Path -LiteralPath $launcherPath) {
    Remove-Item -LiteralPath $launcherPath -Force
    Write-Host "Removed autorun launcher: $launcherPath"
} else {
    Write-Host "No autorun launcher found at: $launcherPath"
}
