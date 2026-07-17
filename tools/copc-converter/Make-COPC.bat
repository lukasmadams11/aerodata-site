@echo off
rem =====================================================================
rem  AeroData COPC Converter
rem  Drag a folder (or a selection of .las/.laz files) onto this file.
rem  It merges everything into one streaming-ready, lossless .copc.laz
rem =====================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-copc.ps1" %*
echo.
pause
