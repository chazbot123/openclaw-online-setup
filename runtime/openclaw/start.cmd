@echo off
setlocal
cd /d %~dp0
node "%~dp0mock-lobster.js"
endlocal
