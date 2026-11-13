# Elevated worker. Normally invoked by start-elevated-agent.ps1 after UAC.
# No kernel driver installation, security-policy changes or process termination.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$DataDir,
    [ValidateSet('StartOnce','Register','Remove')][string]$Operation = 'StartOnce',
    [ValidateSet('','hardware','virtual')][string]$Mode = '',
    [string]$UserSid = '',
    [string]$RequestPath = '',
    [string]$ResultPath = '',
    [switch]$NoStart,
    [switch]$Restart,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$lumenRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$lumenIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$lumenResultPathValidated = $false
if (-not $UserSid) { $UserSid = $lumenIdentity.User.Value }

function ConvertTo-LumenArgument([string]$Value) {
    # The accepted local paths contain no quotes and cannot end in a root slash.
    return '"' + $Value + '"'
}
function Get-LumenTaskName([string]$Sid, [string]$Directory, [string]$Prefix = 'Rayloom') {
    $lumenHasher = [Security.Cryptography.SHA256]::Create()
    try { $lumenDigest = $lumenHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Sid + '|' + $Directory.ToLowerInvariant())) }
    finally { $lumenHasher.Dispose() }
    return $Prefix + '-Agent-' + ([BitConverter]::ToString($lumenDigest).Replace('-','').Substring(0,24).ToLowerInvariant())
}
function Assert-LumenRequest {
    if (-not $RequestPath) { return }
    if (-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)) { throw 'Запрос повышения отменён или истёк. Ничего не изменено.' }
    $lumenRequest = [IO.File]::ReadAllText($RequestPath) | ConvertFrom-Json
    if ($lumenRequest.cancelled -or [DateTimeOffset]::Parse($lumenRequest.expiresAt) -le [DateTimeOffset]::UtcNow -or
        $lumenRequest.userSid -ne $UserSid -or $lumenRequest.operation -ne $Operation -or $lumenRequest.dataDir -ne $DataDir -or
        $lumenRequest.restart -isnot [bool] -or $lumenRequest.restart -ne [bool]$Restart -or [string]$lumenRequest.mode -cne $Mode) {
        throw 'Запрос повышения отменён, истёк или не соответствует операции.'
    }
}
function Write-LumenSettings([byte[]]$Bytes) {
    $lumenTemporary = $script:lumenSettingsPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllBytes($lumenTemporary,$Bytes)
        # Windows PowerShell 5.1 binds $null to String.Empty for this overload.
        # NullString passes an actual null backup path to System.IO.File.Replace.
        if (Test-Path -LiteralPath $script:lumenSettingsPath) { [IO.File]::Replace($lumenTemporary,$script:lumenSettingsPath,[NullString]::Value) }
        else { [IO.File]::Move($lumenTemporary,$script:lumenSettingsPath) }
    } finally { if (Test-Path -LiteralPath $lumenTemporary) { Remove-Item -LiteralPath $lumenTemporary -Force } }
}
function Write-LumenResult($Value) {
    $lumenJson = $Value | ConvertTo-Json -Depth 8 -Compress
    if ($ResultPath -and $script:lumenResultPathValidated) {
        $lumenTempResult = $ResultPath + '.tmp'
        [IO.File]::WriteAllText($lumenTempResult,$lumenJson,(New-Object Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $ResultPath) { [IO.File]::Replace($lumenTempResult,$ResultPath,[NullString]::Value) }
        else { [IO.File]::Move($lumenTempResult,$ResultPath) }
    }
    Write-Output $lumenJson
}

$lumenTaskName = $null
try {
    if ($NoStart -and $Operation -eq 'StartOnce') { throw '-NoStart применим только к Register и Remove.' }
    if ($Restart -and $Operation -ne 'StartOnce') { throw '-Restart применим только к StartOnce.' }
    if ($DataDir -notmatch '^[A-Za-z]:[\\/]' -or $DataDir.IndexOf('"') -ge 0) { throw 'DataDir должен быть абсолютным локальным путём Windows.' }
    $DataDir = [IO.Path]::GetFullPath($DataDir).TrimEnd('\','/')
    if ($DataDir.Length -lt 4) { throw 'Корень диска нельзя использовать как каталог данных.' }
    $lumenTaskName = Get-LumenTaskName $UserSid $DataDir
    $lumenLegacyTaskName = Get-LumenTaskName $UserSid $DataDir 'LumenRGB'
    $lumenLauncher = Join-Path $lumenRoot 'runtime/Rayloom-Agent.exe'
    $lumenLegacyLauncher = Join-Path $lumenRoot 'runtime/LumenRGB-Agent.exe'
    $lumenNode = Join-Path $lumenRoot 'runtime/node/node.exe'
    $lumenAgent = Join-Path $lumenRoot 'desktop/runtime-agent.mjs'
    $lumenStopHelper = Join-Path $PSScriptRoot 'stop-background-runtime.mjs'
    if ($Restart -and -not (Test-Path -LiteralPath $lumenStopHelper -PathType Leaf)) { throw 'Не найден помощник штатного перезапуска агента.' }
    if ($Operation -ne 'Remove') {
        foreach ($lumenFile in @($lumenLauncher,$lumenNode,$lumenAgent)) {
            if (-not (Test-Path -LiteralPath $lumenFile -PathType Leaf)) { throw ('Не найден локальный файл: ' + $lumenFile + '. Выполните scripts/build-launcher.ps1.') }
        }
    }
    if ($ResultPath -or $RequestPath) {
        $lumenRequestDirectory = [IO.Path]::GetFullPath((Join-Path $DataDir 'launch-requests')) + [IO.Path]::DirectorySeparatorChar
        foreach ($lumenRequestFile in @($ResultPath,$RequestPath)) {
            if ($lumenRequestFile -and -not [IO.Path]::GetFullPath($lumenRequestFile).StartsWith($lumenRequestDirectory,[StringComparison]::OrdinalIgnoreCase)) {
                throw 'Файлы результата и запроса должны находиться в launch-requests данного профиля.'
            }
        }
        $lumenResultPathValidated = $true
    }
    if ($UserSid -ne $lumenIdentity.User.Value) { throw 'Подтвердите UAC от той же учётной записи Windows, в которой открыт Rayloom.' }
    $lumenArguments = '--data ' + (ConvertTo-LumenArgument $DataDir) + ' --silent --require-elevated'
    $lumenDescription = 'Rayloom background agent; user=' + $UserSid + '; data=' + $lumenTaskName
    $lumenLegacyDescription = 'LumenRGB background agent; user=' + $UserSid + '; data=' + $lumenLegacyTaskName
    if ($CheckOnly) {
        Write-LumenResult ([ordered]@{ok=$true;checkOnly=$true;operation=$Operation;restart=[bool]$Restart;taskName=$lumenTaskName;legacyTaskName=$lumenLegacyTaskName;userSid=$UserSid;dataDir=$DataDir;executable=$lumenLauncher;arguments=$lumenArguments;trigger=$(if($Operation -eq 'Register'){'AtLogOn'}else{$null});runLevel='Highest';writesPerformed=$false})
        return
    }
    if (-not (New-Object Security.Principal.WindowsPrincipal($lumenIdentity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Операция требует стандартного подтверждения Windows UAC.'
    }
    Assert-LumenRequest
    if (-not (Test-Path -LiteralPath $DataDir -PathType Container)) { [IO.Directory]::CreateDirectory($DataDir) | Out-Null }

    if ($Operation -eq 'StartOnce') {
        if ($Mode) { $lumenArguments += ' --mode ' + $Mode }
        Assert-LumenRequest
        if ($Restart) {
            $lumenStopArguments = (ConvertTo-LumenArgument $lumenStopHelper) + ' --data ' + (ConvertTo-LumenArgument $DataDir)
            $lumenStopProcess = Start-Process -FilePath $lumenNode -ArgumentList $lumenStopArguments -WorkingDirectory $lumenRoot -WindowStyle Hidden -PassThru
            if (-not $lumenStopProcess.WaitForExit(35000)) { throw 'Помощник штатного завершения не ответил. Принудительное завершение и новый запуск не выполнялись.' }
            if ($lumenStopProcess.ExitCode -ne 0) { throw 'Не удалось штатно завершить старый агент. Новый агент не запущен; проверьте artifacts/elevated-discovery-before-restart.json.' }
            Assert-LumenRequest
        }
        $lumenBootstrap = Start-Process -FilePath $lumenLauncher -ArgumentList $lumenArguments -WorkingDirectory $lumenRoot -WindowStyle Hidden -PassThru
        if (-not $lumenBootstrap.WaitForExit(15000)) { throw 'Фоновый запуск не завершился за 15 секунд; проверьте состояние агента.' }
        if ($lumenBootstrap.ExitCode -ne 0) { throw ('Не удалось запустить агент, код ' + $lumenBootstrap.ExitCode + '. Подробности в launcher.log.') }
        Write-LumenResult ([ordered]@{ok=$true;cancelled=$false;operation=$Operation;restart=[bool]$Restart;taskName=$lumenTaskName;launched=$true;startupChanged=$false})
        return
    }

    Import-Module ScheduledTasks
    $lumenExistingTask = Get-ScheduledTask -TaskPath '\' -TaskName $lumenTaskName -ErrorAction SilentlyContinue
    if ($lumenExistingTask -and $lumenExistingTask.Description -ne $lumenDescription) { throw 'Найдено чужое задание с таким именем; оно не изменено.' }
    $lumenExistingXml = if ($lumenExistingTask) { Export-ScheduledTask -TaskPath '\' -TaskName $lumenTaskName } else { $null }
    $lumenLegacyTask = Get-ScheduledTask -TaskPath '\' -TaskName $lumenLegacyTaskName -ErrorAction SilentlyContinue
    if ($lumenLegacyTask -and ($lumenLegacyTask.Description -ne $lumenLegacyDescription -or
        $lumenLegacyTask.Actions.Count -ne 1 -or $lumenLegacyTask.Actions[0].Execute -ne $lumenLegacyLauncher -or
        $lumenLegacyTask.Actions[0].Arguments -ne $lumenArguments)) {
        throw 'Найдена задача прежней версии с несовпадающими параметрами; она не изменена.'
    }
    $lumenLegacyXml = if ($lumenLegacyTask) { Export-ScheduledTask -TaskPath '\' -TaskName $lumenLegacyTaskName } else { $null }
    $script:lumenSettingsPath = Join-Path $DataDir 'app-settings.json'
    $lumenOriginalSettings = if (Test-Path -LiteralPath $lumenSettingsPath) { [IO.File]::ReadAllBytes($lumenSettingsPath) } else { $null }
    $lumenSettings = [ordered]@{}
    if ($null -ne $lumenOriginalSettings) {
        $lumenOldSettings = [Text.Encoding]::UTF8.GetString($lumenOriginalSettings).TrimStart([char]0xFEFF) | ConvertFrom-Json
        foreach ($lumenProperty in $lumenOldSettings.PSObject.Properties) { $lumenSettings[$lumenProperty.Name] = $lumenProperty.Value }
    }
    $lumenRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $lumenLegacyRun = $null
    $lumenRunProperties = Get-ItemProperty -LiteralPath $lumenRegistryPath -ErrorAction SilentlyContinue
    if ($lumenRunProperties -and $lumenRunProperties.PSObject.Properties['LumenRGB']) { $lumenLegacyRun = $lumenRunProperties.LumenRGB }
    $lumenOwnLegacyRun = $lumenLegacyRun -eq ('"' + $lumenLegacyLauncher + '" --data "' + $DataDir + '"')
    $lumenTaskChanged=$false;$lumenSettingsChanged=$false;$lumenLegacyChanged=$false;$lumenLegacyTaskChanged=$false
    try {
        Assert-LumenRequest
        if ($Operation -eq 'Register') {
            $lumenAction = New-ScheduledTaskAction -Execute $lumenLauncher -Argument $lumenArguments -WorkingDirectory $lumenRoot
            $lumenTrigger = New-ScheduledTaskTrigger -AtLogOn -User $UserSid
            $lumenPrincipal = New-ScheduledTaskPrincipal -UserId $UserSid -LogonType Interactive -RunLevel Highest
            $lumenTaskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
            $lumenTaskChanged=$true
            Register-ScheduledTask -TaskPath '\' -TaskName $lumenTaskName -Action $lumenAction -Trigger $lumenTrigger -Principal $lumenPrincipal -Settings $lumenTaskSettings -Description $lumenDescription -Force | Out-Null
            if ($lumenLegacyTask) { $lumenLegacyTaskChanged=$true;Unregister-ScheduledTask -TaskPath '\' -TaskName $lumenLegacyTaskName -Confirm:$false }
            $lumenSettings.autoStart=$true;$lumenSettings.elevatedStartup=$true;$lumenSettings.startupTaskName=$lumenTaskName
        } else {
            if ($lumenExistingTask) { $lumenTaskChanged=$true;Unregister-ScheduledTask -TaskPath '\' -TaskName $lumenTaskName -Confirm:$false }
            if ($lumenLegacyTask) { $lumenLegacyTaskChanged=$true;Unregister-ScheduledTask -TaskPath '\' -TaskName $lumenLegacyTaskName -Confirm:$false }
            $lumenSettings.autoStart=$false;$lumenSettings.elevatedStartup=$false;$lumenSettings.startupTaskName=$null
        }
        if ($lumenOwnLegacyRun) { $lumenLegacyChanged=$true;Remove-ItemProperty -LiteralPath $lumenRegistryPath -Name 'LumenRGB' }
        $lumenSettingsChanged=$true
        Write-LumenSettings ([Text.Encoding]::UTF8.GetBytes(($lumenSettings | ConvertTo-Json -Depth 16)))
        if ($Operation -eq 'Register' -and -not $NoStart) { Start-ScheduledTask -TaskPath '\' -TaskName $lumenTaskName }
    } catch {
        $lumenOriginalError=$_;$lumenRollbackErrors=@()
        if ($lumenTaskChanged) { try { if ($lumenExistingXml) { Register-ScheduledTask -TaskPath '\' -TaskName $lumenTaskName -Xml $lumenExistingXml -Force | Out-Null } else { Unregister-ScheduledTask -TaskPath '\' -TaskName $lumenTaskName -Confirm:$false -ErrorAction SilentlyContinue } } catch { $lumenRollbackErrors += $_.Exception.Message } }
        if ($lumenLegacyTaskChanged) { try { Register-ScheduledTask -TaskPath '\' -TaskName $lumenLegacyTaskName -Xml $lumenLegacyXml -Force | Out-Null } catch { $lumenRollbackErrors += $_.Exception.Message } }
        if ($lumenSettingsChanged) { try { if ($null -ne $lumenOriginalSettings) { Write-LumenSettings $lumenOriginalSettings } else { Remove-Item -LiteralPath $lumenSettingsPath -Force } } catch { $lumenRollbackErrors += $_.Exception.Message } }
        if ($lumenLegacyChanged) { try { Set-ItemProperty -LiteralPath $lumenRegistryPath -Name 'LumenRGB' -Value $lumenLegacyRun } catch { $lumenRollbackErrors += $_.Exception.Message } }
        if ($lumenRollbackErrors.Count) { throw ($lumenOriginalError.Exception.Message + '; Не удалось полностью откатить: ' + ($lumenRollbackErrors -join '; ')) }
        throw $lumenOriginalError
    }
    Write-LumenResult ([ordered]@{ok=$true;cancelled=$false;operation=$Operation;taskName=$lumenTaskName;launched=($Operation -eq 'Register' -and -not $NoStart);autoStart=($Operation -eq 'Register');elevatedStartup=($Operation -eq 'Register');startupChanged=$true})
} catch {
    Write-LumenResult ([ordered]@{ok=$false;cancelled=$false;operation=$Operation;taskName=$lumenTaskName;error=$_.Exception.Message})
    exit 1
}
