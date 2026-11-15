param(
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.tauri\novelai-local\updater.key'),
    [Parameter(Mandatory = $true)][string]$NotesFile,
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$releaseRepo = 'YILING0013/novelai_local_web'

# 只发布已经推送的干净源码；构建产物、密钥与临时记录都不进入源码提交。
if ((git status --porcelain).Count -gt 0) { throw 'Commit and push all source changes before building a release.' }
$sourceSha = (git rev-parse HEAD).Trim()
$branch = (git branch --show-current).Trim()
if (-not $branch) { throw 'A pushed source branch is required.' }
$remote = git ls-remote origin "refs/heads/$branch"
if ($LASTEXITCODE -ne 0 -or -not $remote -or ($remote -split '\s+')[0] -ne $sourceSha) { throw 'GitHub source SHA does not match local HEAD.' }
$package = Get-Content -LiteralPath 'next_nai_web/package.json' -Raw | ConvertFrom-Json
$config = Get-Content -LiteralPath 'src-tauri\tauri.conf.json' -Raw | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+$' -or $config.version -ne $version) { throw 'Release versions must match and be stable semver.' }
$cargoText = Get-Content -LiteralPath 'src-tauri\Cargo.toml' -Raw
if ($cargoText -notmatch ('(?m)^version = "' + [regex]::Escape($version) + '"\r?$')) { throw 'Cargo version does not match.' }
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "Signing key missing: $KeyPath" }
if ((Get-Content -LiteralPath ($KeyPath + '.pub') -Raw).Trim() -ne $config.plugins.updater.pubkey) { throw 'Signing public key does not match the embedded updater key.' }
$notes = Get-Content -LiteralPath $NotesFile -Raw
if ([string]::IsNullOrWhiteSpace($notes)) { throw 'Release notes are required.' }
$repository = gh repo view $releaseRepo --json name,isPrivate | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $repository.isPrivate) { throw 'The download repository must be public.' }
if (-not $Publish) {
    $oldKey = $env:TAURI_SIGNING_PRIVATE_KEY
    try {
        $env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
        & npm.cmd --prefix next_nai_web run desktop:build -- --ci -- --locked
        if ($LASTEXITCODE -ne 0) { throw 'Signed build failed.' }
    } finally { $env:TAURI_SIGNING_PRIVATE_KEY = $oldKey }

    $bundle = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis\NovelAI Local_${version}_x64-setup.exe"
    $signaturePath = $bundle + '.sig'
    if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) { throw 'Updater signature is missing.' }
    $output = Join-Path $projectRoot "output\releases\$version"
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $assetName = "NovelAI-Local_${version}_x64-setup.exe"
    $asset = Join-Path $output $assetName
    Copy-Item -LiteralPath $bundle -Destination $asset
    Copy-Item -LiteralPath $signaturePath -Destination ($asset + '.sig')
    $hash = (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant()
    $tag = "v$version"
    $manifest = [ordered]@{
        version = $version
        notes = $notes.Trim()
        pub_date = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        platforms = @{ 'windows-x86_64' = @{
            url = "https://github.com/$releaseRepo/releases/download/$tag/$assetName"
            signature = (Get-Content -LiteralPath $signaturePath -Raw).Trim()
        } }
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'latest.json') -Encoding utf8NoBOM
    "$hash  $assetName" | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding utf8NoBOM
    $notes.Trim() | Set-Content -LiteralPath (Join-Path $output 'release-notes.md') -Encoding utf8NoBOM
    @{ version=$version; sourceSha=$sourceSha; installerSha256=$hash; signed=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'build.json') -Encoding utf8NoBOM
    Write-Output "Signed package ready for acceptance: $asset"
    exit 0

}
# 发布经过验收的原包，不在发布动作中重新构建另一个文件。
$output = Join-Path $projectRoot "output\releases\$version"
$assetName = "NovelAI-Local_${version}_x64-setup.exe"
$asset = Join-Path $output $assetName
$tag = "v$version"
$built = Get-Content -LiteralPath (Join-Path $output 'build.json') -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath (Join-Path $output 'latest.json') -Raw | ConvertFrom-Json
if ($built.sourceSha -ne $sourceSha -or $built.version -ne $version -or $manifest.version -ne $version) { throw 'Accepted package source/version no longer matches HEAD.' }
if ((Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant() -ne $built.installerSha256) { throw 'Installer changed after the acceptance build.' }
if ($manifest.platforms.'windows-x86_64'.signature -ne (Get-Content -LiteralPath ($asset + '.sig') -Raw).Trim()) { throw 'Manifest and signature differ.' }
if ($manifest.platforms.'windows-x86_64'.url -ne "https://github.com/$releaseRepo/releases/download/$tag/$assetName") { throw 'Unexpected release asset URL.' }

# 所有资产先上传到草稿，最后一次发布让清单与安装包一起可见；不覆盖历史版本。
gh release view $tag --repo $releaseRepo *> $null
if ($LASTEXITCODE -eq 0) { throw "Release $tag already exists; publish a new version instead of overwriting it." }
gh release create $tag $asset ($asset + '.sig') (Join-Path $output 'latest.json') (Join-Path $output 'SHA256SUMS.txt') --repo $releaseRepo --draft --title "NovelAI Local $version" --notes-file (Join-Path $output 'release-notes.md')
if ($LASTEXITCODE -ne 0) { throw 'Draft upload failed; no stable release was published.' }
gh release edit $tag --repo $releaseRepo --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'Publish failed; inspect the draft in GitHub.' }
Write-Output "Published https://github.com/$releaseRepo/releases/tag/$tag"
