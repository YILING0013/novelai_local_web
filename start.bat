@echo off
setlocal
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\NovelAI Local\novelai-local.exe" (
 start "" "%LOCALAPPDATA%\NovelAI Local\novelai-local.exe" %*
 exit /b
)
if exist "src-tauri\target\release\novelai-local.exe" (
 start "" "src-tauri\target\release\novelai-local.exe" %*
 exit /b
)
call "%~dp0setup.bat"
