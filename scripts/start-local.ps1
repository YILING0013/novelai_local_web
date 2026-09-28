param([switch]$Lan)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'nai_flask'
$backendPython = Join-Path $backendRoot '.venv\Scripts\python.exe'
$localPort = 5000
$allowLan = $false
$configPath = Join-Path $backendRoot 'config.local.json'

if (Test-Path -LiteralPath $configPath) {
    try {
        $localConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ($null -ne $localConfig.port) {
            $localPort = [int]$localConfig.port
        }
        if ($null -ne $localConfig.allow_lan) {
            if ($localConfig.allow_lan -isnot [bool]) {
                throw 'allow_lan 必须为 true 或 false。'
            }
            $allowLan = $localConfig.allow_lan
        }
    }
    catch {
        Write-Host '[错误] config.local.json 无法解析，请先修正配置。' -ForegroundColor Red
        exit 1
    }
}

$previousLanEnvironment = $env:NOVELAI_LOCAL_ALLOW_LAN
if ($Lan) {
    $allowLan = $true
}
elseif ($null -ne $previousLanEnvironment) {
    if ($previousLanEnvironment -cnotin @('0', '1')) {
        Write-Host '[错误] NOVELAI_LOCAL_ALLOW_LAN 只能设置为 0 或 1。' -ForegroundColor Red
        exit 1
    }
    $allowLan = $previousLanEnvironment -ceq '1'
}

if ($localPort -lt 1 -or $localPort -gt 65535) {
    Write-Host '[错误] 本地端口必须在 1 到 65535 之间。' -ForegroundColor Red
    exit 1
}

$bindHost = if ($allowLan) { '0.0.0.0' } else { '127.0.0.1' }
$localUrl = "http://127.0.0.1:$localPort/login"
$lanAddresses = @()
if ($allowLan) {
    Push-Location $backendRoot
    try {
        # 与后端 Host 白名单使用相同地址，避免打印 VPN 公网或不接受的链接。
        $addressJson = & $backendPython -c 'import json; from app import discover_lan_ipv4_addresses; print(json.dumps(discover_lan_ipv4_addresses()))'
        if ($LASTEXITCODE -ne 0) {
            throw '无法读取局域网地址。'
        }
        $lanAddresses = ConvertFrom-Json -InputObject $addressJson
    }
    finally {
        Pop-Location
    }
}

function Show-AccessAddresses {
    <#
    .SYNOPSIS
    显示本机和手机可使用的地址；优先列出实际物理网卡，保留虚拟网卡名称供辨认。
    #>
    Write-Host "电脑访问：$localUrl" -ForegroundColor Green
    if ($allowLan) {
        $physicalInterfaces = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ifIndex)
        $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -in $lanAddresses } |
            Sort-Object @{ Expression = { $_.InterfaceIndex -notin $physicalInterfaces } }, InterfaceIndex)
        foreach ($address in $addresses) {
            Write-Host "同一 Wi-Fi / 局域网访问 [$($address.InterfaceAlias)]：http://$($address.IPAddress):$localPort/login" -ForegroundColor Cyan
        }
        if ($lanAddresses.Count -eq 0) {
            Write-Host '[提示] 未检测到局域网 IPv4，请先连接 Wi-Fi 或网线后重启。' -ForegroundColor Yellow
        }
        Write-Host '手机需自行登录。请在 Windows 防火墙中仅允许 Python 访问可信的专用网络。'
    }
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $localPort -ErrorAction SilentlyContinue
if ($listener) {
    $expectedPython = [IO.Path]::GetFullPath($backendPython)
    $belongsToThisProject = $true
    foreach ($processId in @($listener | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        $commandLine = [string]$processInfo.CommandLine
        $matchesProject = (
            $commandLine.IndexOf($expectedPython, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine.IndexOf('-m waitress', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $commandLine.IndexOf('app:create_app', [StringComparison]::OrdinalIgnoreCase) -ge 0
        )
        if (-not $matchesProject) {
            $belongsToThisProject = $false
            break
        }
    }

    if ($belongsToThisProject) {
        if (@($listener | Where-Object { $_.LocalAddress -ne $bindHost }).Count -gt 0) {
            Write-Host '[错误] 本项目已在另一种访问模式下运行。请先关闭旧启动窗口，再使用所需的启动入口。' -ForegroundColor Red
            exit 1
        }
        try {
            $health = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 2
            if ($health.StatusCode -eq 200) {
                Start-Process $localUrl
                Write-Host 'NovelAI Local Web 已在运行，已复用现有服务。' -ForegroundColor Green
                Show-AccessAddresses
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

$browserJob = $null
try {
    if ($Lan) {
        $env:NOVELAI_LOCAL_ALLOW_LAN = '1'
    }
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

    Show-AccessAddresses
    Write-Host '服务就绪后将自动打开电脑访问地址。'
    Write-Host '保持此窗口开启；按 Ctrl+C 或关闭窗口可停止本次启动的服务。'
    Push-Location $backendRoot
    try {
        & $backendPython -m waitress --call "--listen=${bindHost}:$localPort" --threads=4 app:create_app
        if ($LASTEXITCODE -ne 0) {
            throw "服务进程退出，代码：$LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    $env:NOVELAI_LOCAL_ALLOW_LAN = $previousLanEnvironment
    if ($browserJob) {
        Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
        Remove-Job -Job $browserJob -ErrorAction SilentlyContinue
    }
}
