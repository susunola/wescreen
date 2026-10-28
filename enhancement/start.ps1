# WeScreen local helper launcher for Windows (PowerShell 5.1+).
# Mirrors start.sh: finds FFmpeg and Python 3.10-3.13, creates .venv, installs requirements, runs server.py.
# Not covered by automated tests (they run on Linux); report problems with the output of `.\start.ps1 -SetupOnly`.
param([switch]$SetupOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Test-Command($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Update-SessionPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

if (-not ((Test-Command ffmpeg) -and (Test-Command ffprobe))) {
    if (Test-Command winget) {
        Write-Host 'Installing FFmpeg with winget...'
        winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
        Update-SessionPath
    }
    if (-not ((Test-Command ffmpeg) -and (Test-Command ffprobe))) {
        Write-Error 'FFmpeg/ffprobe is missing. Install FFmpeg (https://www.gyan.dev/ffmpeg/builds/), reopen this window and run start.cmd again.'
        exit 1
    }
}

$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    $enginePython = $null
    foreach ($version in '3.13', '3.12', '3.11', '3.10') {
        if (Test-Command py) {
            & py "-$version" -c 'import sys' 2>$null
            if ($LASTEXITCODE -eq 0) { $enginePython = @('py', "-$version"); break }
        }
    }
    if (-not $enginePython -and (Test-Command python)) {
        & python -c 'import sys; raise SystemExit(not ((3,10) <= sys.version_info[:2] < (3,14)))' 2>$null
        if ($LASTEXITCODE -eq 0) { $enginePython = @('python') }
    }
    if (-not $enginePython -and (Test-Command winget)) {
        Write-Host 'Installing Python 3.12 with winget...'
        winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
        Update-SessionPath
        if (Test-Command py) { $enginePython = @('py', '-3.12') }
    }
    if (-not $enginePython) {
        Write-Error 'Python 3.10-3.13 is required. Install it from python.org, then run start.cmd again.'
        exit 1
    }
    $exe = $enginePython[0]
    $rest = @($enginePython | Select-Object -Skip 1)
    & $exe @rest -m venv .venv
}

& $venvPython -c "import cv2, numpy; assert hasattr(cv2, 'dnn_superres')" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $venvPython -m pip install -r requirements.txt
}
if ($SetupOnly) { exit 0 }
& $venvPython server.py
