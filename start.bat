@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "nai_flask\.venv\Scripts\python.exe" (
  echo [错误] 尚未安装后端依赖，请先双击 setup.bat。
  pause
  exit /b 1
)

if not exist "next_nai_web\out\index.html" (
  echo [错误] 尚未完成前端构建，请先双击 setup.bat。
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 pause
