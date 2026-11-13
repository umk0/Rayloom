[CmdletBinding()]
param([switch]$SkipNodeCopy)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$runtimePath = Join-Path $projectRoot 'runtime'
$nodePath = Join-Path $runtimePath 'node'
New-Item -ItemType Directory -Path $nodePath -Force | Out-Null
if (-not $SkipNodeCopy) {
    $installedNode = (Get-Command node.exe).Source
    if ([IO.Path]::GetFullPath($installedNode) -ne [IO.Path]::GetFullPath((Join-Path $nodePath 'node.exe'))) {
        Copy-Item -LiteralPath $installedNode -Destination (Join-Path $nodePath 'node.exe') -Force
        $installedLicense = Join-Path (Split-Path -Parent $installedNode) 'LICENSE'
        if (Test-Path -LiteralPath $installedLicense) { Copy-Item -LiteralPath $installedLicense -Destination (Join-Path $nodePath 'LICENSE') -Force }
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $nodePath 'node.exe'))) { throw 'Standalone Node runtime is missing' }
& (Get-Command node.exe).Source (Join-Path $projectRoot 'scripts/prepare-node-license.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Bundled Node license verification failed' }
$lumenIcon = Join-Path $projectRoot 'public/brand/rayloom.ico'
[string[]]$lumenIconArgument = if (Test-Path -LiteralPath $lumenIcon) { @('/win32icon:' + $lumenIcon) } else { @() }
& $compilerPath /nologo /target:winexe /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll @lumenIconArgument ("/out:" + (Join-Path $runtimePath 'Rayloom-Agent.exe')) (Join-Path $projectRoot 'desktop/RayloomAgentLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
Write-Output 'Built runtime/Rayloom-Agent.exe and standalone Node runtime.'
