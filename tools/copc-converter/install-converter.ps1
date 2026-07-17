# One-time setup for the AeroData COPC Converter.
# Installs Miniforge (conda-forge) if needed, then creates the "copc"
# environment containing Untwine (the converter) and PDAL (validation).

$ErrorActionPreference = "Stop"

function Find-Conda {
    $roots = @(
        "$env:USERPROFILE\miniforge3",
        "$env:LOCALAPPDATA\miniforge3",
        "C:\ProgramData\miniforge3",
        "$env:USERPROFILE\mambaforge",
        "$env:LOCALAPPDATA\mambaforge"
    )
    foreach ($r in $roots) {
        if (Test-Path "$r\Scripts\conda.exe") { return "$r\Scripts\conda.exe" }
    }
    return $null
}

Write-Host ""
Write-Host "=== AeroData COPC Converter setup ===" -ForegroundColor Cyan
Write-Host ""

$conda = Find-Conda
if (-not $conda) {
    Write-Host "Installing Miniforge (free scientific software manager)..." -ForegroundColor Yellow
    winget install CondaForge.Miniforge3 --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Miniforge install failed. Install it manually from https://conda-forge.org/download/ and re-run this." -ForegroundColor Red
        exit 1
    }
    $conda = Find-Conda
    if (-not $conda) {
        Write-Host "Miniforge installed but couldn't be located. Re-run this script after restarting your computer." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Miniforge found: $conda" -ForegroundColor Green

$envRoot = Join-Path (Split-Path (Split-Path $conda)) "envs\copc"
if (Test-Path "$envRoot\Library\bin\untwine.exe") {
    Write-Host "Conversion tools already installed." -ForegroundColor Green
} else {
    Write-Host "Installing conversion tools (PDAL + Untwine) - this downloads a few hundred MB..." -ForegroundColor Yellow
    & $conda create -n copc -c conda-forge -y untwine pdal
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Tool installation failed. Check your internet connection and re-run this." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "From now on: drag a folder of .las/.laz files onto Make-COPC.bat"
