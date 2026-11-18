# 使用环境变量或当前 Windows 用户保护的签名配置构建正式 APK。
$ErrorActionPreference = 'Stop'
$savedSigning = $false
if (!$env:NAI_LOCAL_ANDROID_KEYSTORE) {
    $signingDir = Join-Path $PSScriptRoot '..\..\.tools\android-signing\novelai-local'
    $keystore = (Resolve-Path -LiteralPath (Join-Path $signingDir 'novelai-local-release.p12')).Path
    $credential = Import-Clixml -LiteralPath (Join-Path $signingDir 'release-signing.clixml')
    $env:NAI_LOCAL_ANDROID_KEYSTORE = $keystore
    $env:NAI_LOCAL_ANDROID_KEY_ALIAS = $credential.UserName
    $env:NAI_LOCAL_ANDROID_STORE_PASSWORD = $credential.GetNetworkCredential().Password
    $env:NAI_LOCAL_ANDROID_KEY_PASSWORD = $env:NAI_LOCAL_ANDROID_STORE_PASSWORD
    $savedSigning = $true
}
try {
    & node (Join-Path $PSScriptRoot 'build.mjs') ':app:assembleRelease' ':app:lintRelease' @args
    exit $LASTEXITCODE
} finally {
    if ($savedSigning) {
        $env:NAI_LOCAL_ANDROID_KEYSTORE = $null
        $env:NAI_LOCAL_ANDROID_KEY_ALIAS = $null
        $env:NAI_LOCAL_ANDROID_STORE_PASSWORD = $null
        $env:NAI_LOCAL_ANDROID_KEY_PASSWORD = $null
    }
}
