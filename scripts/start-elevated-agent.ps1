# UI/runtime wrapper. Only an explicit invocation requests standard Windows UAC.
# Cancellation leaves startup settings unchanged. Caller owns stopping/reconnecting
# the old agent; no RGB process is forcibly killed here.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$DataDir,
    [ValidateSet('StartOnce','Register','Remove')][string]$Operation = 'StartOnce',
    [ValidateSet('','hardware','virtual')][string]$Mode = '',
    [switch]$NoStart,
    [switch]$Restart,
    [switch]$CheckOnly,
    [ValidateRange(5,120)][int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$lumenRequestPath=$null;$lumenResultPath=$null;$lumenTaskName=$null;$lumenCompleted=$false
function Quote-LumenPowerShell([string]$Value) { return "'" + $Value.Replace("'","''") + "'" }
function Return-LumenStatus($Value) { Write-Output ($Value | ConvertTo-Json -Depth 8 -Compress) }
try {
    $lumenWorker = Join-Path $PSScriptRoot 'register-background-task.ps1'
    $lumenSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $lumenPlanJson = & $lumenWorker -DataDir $DataDir -Operation $Operation -Mode $Mode -UserSid $lumenSid -NoStart:$NoStart -Restart:$Restart -CheckOnly
    $lumenPlan = $lumenPlanJson | ConvertFrom-Json
    if (-not $lumenPlan.ok) { Return-LumenStatus $lumenPlan;exit 1 }
    $DataDir=$lumenPlan.dataDir;$lumenTaskName=$lumenPlan.taskName
    if ($CheckOnly) { Return-LumenStatus $lumenPlan;return }
    $lumenRequests = Join-Path $DataDir 'launch-requests'
    [IO.Directory]::CreateDirectory($lumenRequests) | Out-Null
    $lumenRequestId = [Guid]::NewGuid().ToString('N')
    $lumenRequestPath = Join-Path $lumenRequests ($lumenRequestId+'.request.json')
    $lumenResultPath = Join-Path $lumenRequests ($lumenRequestId+'.result.json')
    $lumenRequest = @{id=$lumenRequestId;operation=$Operation;userSid=$lumenSid;dataDir=$DataDir;mode=$Mode;restart=[bool]$Restart;expiresAt=[DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds).ToString('o');cancelled=$false}
    [IO.File]::WriteAllText($lumenRequestPath,($lumenRequest | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
    $lumenCommand = '& ' + (Quote-LumenPowerShell $lumenWorker) + ' -DataDir ' + (Quote-LumenPowerShell $DataDir) + ' -Operation ' + $Operation + ' -UserSid ' + (Quote-LumenPowerShell $lumenSid) + ' -RequestPath ' + (Quote-LumenPowerShell $lumenRequestPath) + ' -ResultPath ' + (Quote-LumenPowerShell $lumenResultPath)
    if ($Mode) { $lumenCommand += ' -Mode ' + $Mode }
    if ($NoStart) { $lumenCommand += ' -NoStart' }
    if ($Restart) { $lumenCommand += ' -Restart' }
    $lumenEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($lumenCommand))
    $lumenPowerShell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
    # Process-scoped ExecutionPolicy only; no machine/user security settings change.
    $lumenArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + $lumenEncoded
    if (-not ('LumenElevationRequest' -as [type])) {
        Add-Type -TypeDefinition @'
using System.Diagnostics;
using System.Threading.Tasks;
public static class LumenElevationRequest {
    public static Task<Process> Start(string executable,string arguments,string directory) {
        return Task.Factory.StartNew(()=> {
            var info=new ProcessStartInfo(executable,arguments);
            info.WorkingDirectory=directory;info.UseShellExecute=true;
            info.Verb="runas";info.WindowStyle=ProcessWindowStyle.Hidden;
            return Process.Start(info);
        });
    }
}
'@
    }
    $lumenWatch = [Diagnostics.Stopwatch]::StartNew()
    $lumenElevation = [LumenElevationRequest]::Start($lumenPowerShell,$lumenArguments,$PSScriptRoot)
    $lumenProcess=$null
    while ($lumenWatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if ($lumenElevation.IsCompleted -and -not $lumenProcess) { $lumenProcess=$lumenElevation.GetAwaiter().GetResult() }
        if (Test-Path -LiteralPath $lumenResultPath -PathType Leaf) {
            $lumenResult = [IO.File]::ReadAllText($lumenResultPath) | ConvertFrom-Json
            $lumenCompleted=$true;Return-LumenStatus $lumenResult
            if (-not $lumenResult.ok) { exit 1 };return
        }
        if ($lumenProcess -and $lumenProcess.HasExited) { throw ('Повышенный процесс завершился без результата, код ' + $lumenProcess.ExitCode) }
        Start-Sleep -Milliseconds 100
    }
    # Removing the live request also prevents a late UAC approval from applying
    # an expired operation. A timeout is not treated as user approval/cancel.
    throw 'TIMEOUT: запрос повышения не завершился за отведённое время; проверьте состояние агента и автозапуска.'
} catch {
    $lumenCause=$_.Exception.GetBaseException()
    $lumenCancelled=($lumenCause -is [ComponentModel.Win32Exception] -and $lumenCause.NativeErrorCode -eq 1223)
    Return-LumenStatus ([ordered]@{ok=$false;cancelled=$lumenCancelled;operation=$Operation;taskName=$lumenTaskName;outcomeUnknown=(-not $lumenCancelled -and $null -ne $lumenRequestPath);error=$(if($lumenCancelled){'Запрос Windows UAC отменён. Настройки автозапуска не изменены.'}else{$lumenCause.Message})})
    exit 1
} finally {
    if ($lumenRequestPath -and (Test-Path -LiteralPath $lumenRequestPath)) { Remove-Item -LiteralPath $lumenRequestPath -Force -ErrorAction SilentlyContinue }
    if ($lumenCompleted -and $lumenResultPath -and (Test-Path -LiteralPath $lumenResultPath)) { Remove-Item -LiteralPath $lumenResultPath -Force -ErrorAction SilentlyContinue }
}
