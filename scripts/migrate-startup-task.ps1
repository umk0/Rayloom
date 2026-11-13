# Move a Rayloom elevated startup task when a profile is copied to a new location.
# The old task is removed only after the new action has been registered.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$SourceData,
 [Parameter(Mandatory=$true)][string]$DestData,
 [switch]$Elevated,
 [switch]$CheckOnly,
 [string]$ExpiresAt='',
 [string]$ResultPath=''
)
$ErrorActionPreference='Stop'
$SourceData=[IO.Path]::GetFullPath($SourceData).TrimEnd('\','/')
$DestData=[IO.Path]::GetFullPath($DestData).TrimEnd('\','/')
$worker=Join-Path $PSScriptRoot 'register-background-task.ps1'
$sourceSettingsPath=Join-Path $SourceData 'app-settings.json'
$sourceSettings=Get-Content -LiteralPath $sourceSettingsPath -Raw|ConvertFrom-Json
if($sourceSettings.elevatedStartup -ne $true){[pscustomobject]@{ok=$true;needed=$false}|ConvertTo-Json -Compress;return}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$plan=(& $worker -DataDir $SourceData -Operation Remove -UserSid $sid -CheckOnly|ConvertFrom-Json)
if(-not $plan.ok -or $sourceSettings.startupTaskName -ne $plan.taskName){throw 'Source task does not match the profile.'}
if($SourceData -eq $DestData){throw 'Source and destination profiles must differ.'}
if($CheckOnly){
 $destination=(& $worker -DataDir $DestData -Operation Register -UserSid $sid -NoStart -CheckOnly|ConvertFrom-Json)
 if(-not $destination.ok){throw 'Cannot prepare the destination task.'}
 [pscustomobject]@{ok=$true;checkOnly=$true;sourceTask=$plan.taskName;destinationTask=$destination.taskName;writesPerformed=$false}|ConvertTo-Json -Compress
 return
}
if(-not $Elevated){
 $requestDir=Join-Path $DestData 'launch-requests';[IO.Directory]::CreateDirectory($requestDir)|Out-Null
 $result=Join-Path $requestDir ([guid]::NewGuid().ToString('N')+'.migration.json')
 $expiry=[DateTimeOffset]::UtcNow.AddMinutes(3).ToString('o')
 function Q([string]$s){return "'"+$s.Replace("'","''")+"'"}
 $command='& '+(Q $PSCommandPath)+' -SourceData '+(Q $SourceData)+' -DestData '+(Q $DestData)+' -ResultPath '+(Q $result)+' -ExpiresAt '+(Q $expiry)+' -Elevated'
 $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
 $exe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
 try{
  $child=Start-Process -FilePath $exe -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+$encoded) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  if(-not(Test-Path -LiteralPath $result -PathType Leaf)){throw 'Startup migration returned no result.'}
  $out=Get-Content -LiteralPath $result -Raw|ConvertFrom-Json
  if($child.ExitCode -ne 0 -or -not $out.ok){throw [string]$out.error}
  $out|ConvertTo-Json -Compress
 }finally{if(Test-Path -LiteralPath $result){Remove-Item -LiteralPath $result -Force}}
 return
}
try{
 if(-not $ExpiresAt -or [DateTimeOffset]::UtcNow -ge [DateTimeOffset]::Parse($ExpiresAt)){throw 'Startup migration request expired.'}
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $principal=New-Object Security.Principal.WindowsPrincipal($identity)
 if($identity.User.Value -ne $sid -or -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Confirm UAC using the same Windows account.'}
 Import-Module ScheduledTasks
 $old=Get-ScheduledTask -TaskPath '\' -TaskName $plan.taskName -ErrorAction Stop
 $expected='--data "'+$SourceData+'" --silent --require-elevated'
 $description='Rayloom background agent; user='+$sid+'; data='+$plan.taskName
 if($old.Actions.Count -ne 1 -or $old.Actions[0].Arguments -ne $expected -or $old.Description -ne $description -or [IO.Path]::GetFileName($old.Actions[0].Execute) -ne 'Rayloom-Agent.exe'){throw 'The existing task differs from the Rayloom task and was not changed.'}
 $oldXml=Export-ScheduledTask -TaskPath '\' -TaskName $plan.taskName
 $original=[IO.File]::ReadAllBytes($sourceSettingsPath)
 $newPlan=(& $worker -DataDir $DestData -Operation Register -UserSid $sid -NoStart -CheckOnly|ConvertFrom-Json)
 if(-not $newPlan.ok){throw 'Cannot prepare the destination task.'}
 $newExisting=Get-ScheduledTask -TaskPath '\' -TaskName $newPlan.taskName -ErrorAction SilentlyContinue
 if($newExisting){throw 'A destination task already exists; migration stopped.'}
 $newRegistered=$false;$oldRemoved=$false
 try{
  $registered=(& $worker -DataDir $DestData -Operation Register -UserSid $sid -NoStart|ConvertFrom-Json)
  if(-not $registered.ok){throw [string]$registered.error}
  $newRegistered=$true
  Unregister-ScheduledTask -TaskPath '\' -TaskName $plan.taskName -Confirm:$false;$oldRemoved=$true
  $sourceSettings.autoStart=$false;$sourceSettings.elevatedStartup=$false;$sourceSettings.startupTaskName=$null
  $temporary=$sourceSettingsPath+'.migration-'+[guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($temporary,($sourceSettings|ConvertTo-Json -Depth 16),(New-Object Text.UTF8Encoding($false)))
  [IO.File]::Replace($temporary,$sourceSettingsPath,[NullString]::Value)
 }catch{
  $failure=$_;if($oldRemoved){Register-ScheduledTask -TaskPath '\' -TaskName $plan.taskName -Xml $oldXml -Force|Out-Null}
  if($newRegistered){& $worker -DataDir $DestData -Operation Remove -UserSid $sid -NoStart|Out-Null}
  [IO.File]::WriteAllBytes($sourceSettingsPath,$original)
  throw $failure
 }
 $out=[ordered]@{ok=$true;needed=$true;taskName=$newPlan.taskName}
 if($ResultPath){[IO.File]::WriteAllText($ResultPath,($out|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))}
 $out|ConvertTo-Json -Compress
}catch{
 $out=[ordered]@{ok=$false;error=$_.Exception.Message}
 if($ResultPath){[IO.File]::WriteAllText($ResultPath,($out|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))}
 $out|ConvertTo-Json -Compress
 exit 1
}
