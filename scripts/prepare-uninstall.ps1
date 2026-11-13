[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$DataDir)
$ErrorActionPreference='Stop'
$settingsPath=Join-Path $DataDir 'app-settings.json'
if(-not(Test-Path -LiteralPath $settingsPath -PathType Leaf)){exit 0}
$settings=Get-Content -LiteralPath $settingsPath -Raw|ConvertFrom-Json
if($settings.elevatedStartup -eq $true){
  $result=& (Join-Path $PSScriptRoot 'start-elevated-agent.ps1') -DataDir $DataDir -Operation Remove -NoStart
  if($LASTEXITCODE -ne 0){throw ('Не удалось убрать задачу автозапуска: '+$result)}
}else{
  $registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $run=Get-ItemProperty -LiteralPath $registry -Name Rayloom -ErrorAction SilentlyContinue
  if($run){
    $launcher=Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\Rayloom-Agent.exe'
    $expected='"'+$launcher+'" --data "'+$DataDir+'"'
    if($run.Rayloom -ne $expected){throw 'Запись автозапуска Rayloom указывает на другой файл; автоматическое удаление остановлено.'}
    Remove-ItemProperty -LiteralPath $registry -Name Rayloom
  }
}
if(Test-Path -LiteralPath $settingsPath -PathType Leaf){
  $settings=Get-Content -LiteralPath $settingsPath -Raw|ConvertFrom-Json
  foreach($pair in @(@('autoStart',$false),@('elevatedStartup',$false),@('startupTaskName',$null))){
    $settings | Add-Member -NotePropertyName $pair[0] -NotePropertyValue $pair[1] -Force
  }
  $temp=$settingsPath+'.uninstall-'+[guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($temp,($settings|ConvertTo-Json -Depth 16),(New-Object Text.UTF8Encoding($false)))
  [IO.File]::Replace($temp,$settingsPath,[NullString]::Value)
}
