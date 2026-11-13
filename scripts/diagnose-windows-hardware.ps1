# Read-only OS metadata. Does not open an RGB device, scan SMBus, install a
# driver, change lighting, or start a second OpenRGB/Lumen process.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LumenProcessToken {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int length);
    public static string Elevation(int id) {
        IntPtr process=OpenProcess(0x1000, false, id), token=IntPtr.Zero;
        if(process==IntPtr.Zero) return "unknown: process access denied or exited";
        try {
            if(!OpenProcessToken(process,8,out token)) return "unknown: token access denied";
            int elevated, length;
            return GetTokenInformation(token,20,out elevated,4,out length) ? (elevated!=0 ? "elevated" : "standard") : "unknown: token query failed";
        } finally { if(token!=IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
}
'@

$lumenProcesses = @(Get-CimInstance Win32_Process | Where-Object Name -match '^(LumenRGB-Core|OpenRGB|SignalRgb)\.exe$' | ForEach-Object {
    [ordered]@{name=$_.Name; pid=$_.ProcessId; elevation=[LumenProcessToken]::Elevation($_.ProcessId)}
})
$lumenDrivers = @(Get-CimInstance Win32_SystemDriver | Where-Object Name -match 'PawnIO|WinRing|inpout' | Select-Object Name,State,StartMode)
$lumenMemory = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer,PartNumber,Capacity,Speed,ConfiguredClockSpeed)
$lumenDevices = @(Get-PnpDevice -PresentOnly | Where-Object {
    $_.InstanceId -match 'VID_05AC&PID_024F' -or $_.FriendlyName -match 'SMBus'
} | ForEach-Object {
    $lumenDevice = $_
    $lumenProperties = @{}
    Get-PnpDeviceProperty -InstanceId $lumenDevice.InstanceId -KeyName DEVPKEY_Device_ContainerId,DEVPKEY_Device_BusReportedDeviceDesc -ErrorAction SilentlyContinue | ForEach-Object {$lumenProperties[$_.KeyName] = [string]$_.Data}
    [ordered]@{name=$lumenDevice.FriendlyName;status=$lumenDevice.Status;instanceId=$lumenDevice.InstanceId;product=$lumenProperties['DEVPKEY_Device_BusReportedDeviceDesc'];containerId=$lumenProperties['DEVPKEY_Device_ContainerId']}
})
[ordered]@{
    collectedAt=(Get-Date).ToUniversalTime().ToString('o')
    readOnly=$true
    processes=$lumenProcesses
    drivers=$lumenDrivers
    memory=$lumenMemory
    presentDevices=$lumenDevices
    note='PawnIO running does not imply the RGB core is elevated. A standard core cannot use PawnIO SMBus. Device support and actual bus detection must also be checked in the core.'
} | ConvertTo-Json -Depth 5
