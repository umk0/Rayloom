param([Parameter(Mandatory = $true)][string]$FixturePath)
$ErrorActionPreference = 'Stop'
$player = New-Object System.Media.SoundPlayer($FixturePath)
try { $player.Load(); $player.PlaySync() } finally { $player.Dispose() }
