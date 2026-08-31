$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'nai_flask'
$backendPython = Join-Path $backendRoot '.venv\Scripts\python.exe'
$localPort = 5000
$configPath = Join-Path $backendRoot 'config.local.json'

if (Test-Path -LiteralPath $configPath) {
    try {
        $localConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ($null -ne $localConfig.port) {
            $localPort = [int]$localConfig.port
        }
    }
    catch {
        Write-Host '[错误] config.local.json 无法解析，请先修正配置。' -ForegroundColor Red
        exit 1
    }
}

if ($localPort -lt 1 -or $localPort -gt 65535) {
    Write-Host '[错误] 本地端口必须在 1 到 65535 之间。' -ForegroundColor Red
    exit 1
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $localPort -ErrorAction SilentlyContinue
if ($listener) {
    $expectedPython = [IO.Path]::GetFullPath($backendPython)
    $belongsToThisProject = $false
    foreach ($processId in @($listener | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        $commandLine = [string]$processInfo.CommandLine
        if (
            $commandLine.IndexOf($expectedPython, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine.IndexOf('-m waitress', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine.IndexOf("127.0.0.1:$localPort", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine.IndexOf('app:create_app', [StringComparison]::OrdinalIgnoreCase) -ge 0
        ) {
            $belongsToThisProject = $true
            break
        }
    }

    if ($belongsToThisProject) {
        $localUrl = "http://127.0.0.1:$localPort/login"
        try {
            $health = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 2
            if ($health.StatusCode -eq 200) {
                Start-Process $localUrl
                Write-Host "NovelAI Local Web 已在运行：$localUrl" -ForegroundColor Green
                exit 0
            }
        }
        catch {
            Write-Host "[错误] 已找到本项目进程，但 $localPort 端口健康检查失败。请先关闭旧启动窗口再重试。" -ForegroundColor Red
            exit 1
        }
        Write-Host "[错误] 已找到本项目进程，但 $localPort 端口没有返回可用页面。" -ForegroundColor Red
        exit 1
    }

    Write-Host "[错误] 端口 $localPort 已被其他程序占用，本项目不会自动换端口。" -ForegroundColor Red
    exit 1
}

$localUrl = "http://127.0.0.1:$localPort/login"
$browserJob = $null
try {
    Write-Host '正在启动 NovelAI Local Web...'
    $browserJob = Start-Job -ArgumentList $localUrl -ScriptBlock {
        param($url)
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            try {
                $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
                if ($response.StatusCode -eq 200) {
                    Start-Process $url
                    return
                }
            }
            catch {
                Start-Sleep -Milliseconds 250
            }
        }
    }

    Write-Host "服务就绪后将打开：$localUrl" -ForegroundColor Green
    Write-Host '保持此窗口开启；按 Ctrl+C 或关闭窗口可停止本次启动的服务。'
    Push-Location $backendRoot
    try {
        & $backendPython -m waitress --call "--listen=127.0.0.1:$localPort" --threads=4 app:create_app
        if ($LASTEXITCODE -ne 0) {
            throw "服务进程退出，代码：$LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($browserJob) {
        Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
        Remove-Job -Job $browserJob -ErrorAction SilentlyContinue
    }
}
