@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Python Launcher。请先安装 Python 3.11 或更高版本。
  pause
  exit /b 1
)
py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
if errorlevel 1 (
  echo [错误] Python 版本低于 3.11，请升级后重试。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm。请先安装 Node.js 20 或更高版本。
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js 20 或更高版本。
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo [错误] Node.js 版本低于 20，请升级后重试。
  pause
  exit /b 1
)

if not exist "nai_flask\.venv\Scripts\python.exe" (
  echo [1/4] 创建 Python 虚拟环境...
  py -3 -m venv "nai_flask\.venv"
  if errorlevel 1 goto :failed
)

echo [2/4] 安装后端依赖...
"nai_flask\.venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :failed
"nai_flask\.venv\Scripts\python.exe" -m pip install -r "nai_flask\requirements.txt"
if errorlevel 1 goto :failed

echo [3/4] 安装前端依赖...
pushd "next_nai_web"
call npm ci
if errorlevel 1 (
  popd
  goto :failed
)

echo [4/4] 构建前端...
call npm run build
if errorlevel 1 (
  popd
  goto :failed
)
popd

echo.
echo 安装完成。现在可以双击 start.bat 启动。
pause
exit /b 0

:failed
echo.
echo [错误] 安装或构建失败，请查看上方日志。
pause
exit /b 1
