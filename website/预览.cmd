@echo off
cd /d "%~dp0"
node build.mjs --serve --open
pause
