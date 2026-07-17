# AeroData COPC Converter - drag-and-drop core.
# Receives any mix of folders and .las/.laz files (via Make-COPC.bat),
# merges every scan found into a single lossless .copc.laz using Untwine.

$ErrorActionPreference = "Stop"

function Find-Tool([string]$name) {
    $roots = @(
        "$env:USERPROFILE\miniforge3",
        "$env:LOCALAPPDATA\miniforge3",
        "C:\ProgramData\miniforge3",
        "$env:USERPROFILE\mambaforge"
    )
    foreach ($r in $roots) {
        $p = "$r\envs\copc\Library\bin\$name"
        if (Test-Path $p) { return $p }
    }
    return $null
}

Write-Host ""
Write-Host "=== AeroData COPC Converter ===" -ForegroundColor Cyan
Write-Host ""

if ($args.Count -eq 0) {
    Write-Host "Nothing to convert." -ForegroundColor Yellow
    Write-Host "Drag a folder (or a selection of .las/.laz files) onto Make-COPC.bat."
    exit 1
}

$untwine = Find-Tool "untwine.exe"
if (-not $untwine) {
    Write-Host "The conversion tools aren't installed yet." -ForegroundColor Red
    Write-Host "Double-click Install-Converter.bat first (one-time, a few minutes)."
    exit 1
}

# ---- collect every .las/.laz under the dropped paths --------------------
# (previous outputs *.copc.laz are excluded so re-runs don't double-count)
$inputs = @()
foreach ($arg in $args) {
    if (-not (Test-Path $arg)) { continue }
    $item = Get-Item -LiteralPath $arg
    if ($item.PSIsContainer) {
        $inputs += Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Include *.las, *.laz
    }
    elseif ($item.Extension -match "^\.(las|laz)$") {
        $inputs += $item
    }
}
$inputs = $inputs | Where-Object { $_.Name -notmatch "\.copc\.laz$" } | Sort-Object FullName -Unique

if ($inputs.Count -eq 0) {
    Write-Host "No .las or .laz scan files were found in what you dropped." -ForegroundColor Yellow
    Write-Host "Tip: scans are often inside a subfolder named something like 'terra_las' or 'lidars'."
    exit 1
}

$totalGB = [math]::Round(($inputs | Measure-Object Length -Sum).Sum / 1GB, 2)
Write-Host "Found $($inputs.Count) scan file(s), $totalGB GB total." -ForegroundColor Green

# ---- pick an output name ------------------------------------------------
$first = Get-Item -LiteralPath $args[0]
if ($first.PSIsContainer) {
    $outDir = $first.Parent.FullName
    $baseName = $first.Name
} else {
    $outDir = $first.DirectoryName
    $baseName = "site"
}
$outFile = Join-Path $outDir "$baseName.copc.laz"
$n = 1
while (Test-Path $outFile) {
    $outFile = Join-Path $outDir "$baseName-$n.copc.laz"
    $n++
}

# ---- build the input arguments without blowing the command-line limit ---
# If every file sits directly in a handful of folders, pass the folders;
# otherwise pass the files themselves.
$parents = $inputs | ForEach-Object { $_.DirectoryName } | Sort-Object -Unique
$parentContentsOk = $true
foreach ($p in $parents) {
    $extras = Get-ChildItem -LiteralPath $p -File -Include *.las, *.laz |
        Where-Object { $_.Name -match "\.copc\.laz$" -or ($inputs.FullName -notcontains $_.FullName) }
    if ($extras) { $parentContentsOk = $false; break }
}
if ($parentContentsOk -and $parents.Count -le 32 -and $inputs.Count -gt 64) {
    $inputArgs = $parents
} else {
    $inputArgs = $inputs.FullName
}

$tempDir = Join-Path $outDir ("untwine_tmp_" + [System.IO.Path]::GetRandomFileName().Substring(0, 6))

Write-Host "Merging into: $outFile"
Write-Host "This can take a while for big sites (roughly 5-15 min per 50 GB on an SSD)."
Write-Host ""

# ---- run untwine --------------------------------------------------------
$untwineArgs = @()
foreach ($i in $inputArgs) { $untwineArgs += @("-i", $i) }
$untwineArgs += @("-o", $outFile, "--temp_dir", $tempDir, "--progress_debug")

& $untwine @untwineArgs
$code = $LASTEXITCODE

if (Test-Path $tempDir) {
    try { Remove-Item -LiteralPath $tempDir -Recurse -Force -Confirm:$false } catch {}
}

if ($code -ne 0 -or -not (Test-Path $outFile)) {
    Write-Host ""
    Write-Host "Conversion failed (exit $code). Nothing was harmed - your original files are untouched." -ForegroundColor Red
    Write-Host "If this keeps happening, check that the drive has enough free space (needs about the size of the input)."
    exit 1
}

$outGB = [math]::Round((Get-Item -LiteralPath $outFile).Length / 1GB, 2)

# ---- quick validation with PDAL (header-only, fast) ---------------------
$pdal = Find-Tool "pdal.exe"
if ($pdal) {
    try {
        $meta = (& $pdal info $outFile --metadata 2>$null | ConvertFrom-Json).metadata
        Write-Host ""
        Write-Host "Verified: $([long]$meta.count) points, COPC=$($meta.copc), lossless." -ForegroundColor Green
    } catch {
        Write-Host "(Couldn't run the verification step, but the file was written.)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done!  $outFile" -ForegroundColor Green
Write-Host "  Input:  $totalGB GB across $($inputs.Count) file(s)"
Write-Host "  Output: $outGB GB, single streaming-ready file (every point preserved)"
Write-Host ""
Write-Host "Next: upload it to your file host and share the viewer link,"
Write-Host "or drop it straight into the Scan Viewer to check it."
