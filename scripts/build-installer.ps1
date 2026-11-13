[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$release=Join-Path $root 'release-history/current'
$output=Join-Path $root 'artifacts/installer'
$makensis='C:\Program Files (x86)\NSIS\makensis.exe'
if(-not (Test-Path -LiteralPath $makensis -PathType Leaf)){throw 'Install NSIS 3 before building the setup executable.'}
& (Get-Command node.exe).Source (Join-Path $root 'scripts/verify-portable-release.mjs') $release
if($LASTEXITCODE -ne 0){throw 'Portable package verification failed.'}
New-Item -ItemType Directory -Path $output -Force|Out-Null
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw|ConvertFrom-Json).version
$setup=Join-Path $output "Rayloom-Setup-$version.exe"
& $makensis '/V2' '/WX' "/DRELEASE_ROOT=$release" "/DSOURCE_ROOT=$root" "/DOUTFILE=$setup" "/DICONFILE=$(Join-Path $root 'public/brand/rayloom.ico')" (Join-Path $root 'installer/rayloom.nsi')
if($LASTEXITCODE -ne 0){throw "NSIS build failed with code $LASTEXITCODE"}
$checksum=(Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($setup+'.sha256',($checksum+' *'+[IO.Path]::GetFileName($setup)+"`n"),(New-Object Text.UTF8Encoding($false)))
Get-Item -LiteralPath $setup|Select-Object FullName,Length,LastWriteTime
