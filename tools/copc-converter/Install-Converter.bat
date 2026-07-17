@echo off
rem =====================================================================
rem  One-time setup for the AeroData COPC Converter.
rem  Installs Miniforge (conda-forge) and the PDAL + Untwine tools.
rem  Run this once; afterwards use Make-COPC.bat forever.
rem =====================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-converter.ps1"
echo.
pause
