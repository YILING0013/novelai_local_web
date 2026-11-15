@echo off
setlocal
cd /d "%~dp0"
for %%I in ("src-tauri\target\release\bundle\nsis\*_x64-setup.exe") do if exist "%%~fI" (
 start "" "%%~fI"
 exit /b
)
echo Install the Windows x64 setup.exe supplied with the desktop build.
echo Developer build: see docs\desktop.md
pause
exit /b 1
