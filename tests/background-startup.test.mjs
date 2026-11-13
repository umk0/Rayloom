import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const windows=process.platform==='win32';
const powershell=path.join(process.env.WINDIR??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
function plan(dataDir,operation='StartOnce',extra=[]) {
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/start-elevated-agent.ps1'),'-DataDir',dataDir,'-Operation',operation,'-CheckOnly',...extra];
  try {return JSON.parse(execFileSync(powershell,args,{encoding:'utf8',windowsHide:true,timeout:15000}));}
  catch(error) {if(error.stdout)return JSON.parse(String(error.stdout));throw error;}
}
test('elevated startup CheckOnly is read-only and returns an at-logon Highest local action',{skip:!windows},()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-startup-check-'));
  try {
    const data=path.join(parent,'Данные Lumen');
    const result=plan(data,'Register');
    assert.equal(result.ok,true);assert.equal(result.writesPerformed,false);
    assert.equal(result.trigger,'AtLogOn');assert.equal(result.runLevel,'Highest');
    assert.match(result.executable,/Rayloom-Agent\.exe$/);
    assert.match(result.arguments,/--silent --require-elevated$/);
    assert.equal(fs.existsSync(data),false);
    assert.deepEqual(fs.readdirSync(parent),[]);
  } finally {fs.rmdirSync(parent);}
});
test('task identity is stable across casing/trailing separator and distinct per data directory',{skip:!windows},()=>{
  const data=path.join(os.tmpdir(),'Lumen Task Identity');
  const first=plan(data,'Remove');
  assert.equal(first.ok,true);
  assert.equal(plan(data.toUpperCase()+path.sep,'Remove').taskName,first.taskName);
  assert.notEqual(plan(data+' other','Remove').taskName,first.taskName);
  assert.equal(plan(data).trigger,null);
});
test('startup planning rejects network and ambiguous drive-relative paths',{skip:!windows},()=>{
  for(const data of ['\\\\server\\share\\Lumen','C:relative','C:\\'])assert.equal(plan(data,'Remove').ok,false);
  assert.equal(plan(path.join(os.tmpdir(),'Lumen'),'StartOnce',['-NoStart']).ok,false);
  assert.equal(plan(path.join(os.tmpdir(),'Lumen'),'Register',['-Restart']).ok,false);
  assert.equal(plan(path.join(os.tmpdir(),'Lumen'),'Remove',['-Restart']).ok,false);
  assert.equal(plan(path.join(os.tmpdir(),'Lumen'),'StartOnce',['-Restart']).restart,true);
});

// A faulted/incomplete mock of ShellExecute exercises cancellation/expiry without
// displaying UAC, starting an agent or invoking any Task Scheduler mutation.
function mockedElevation(dataDir,kind) {
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const source=`using System.Diagnostics; using System.Threading.Tasks; using System.ComponentModel;
public static class LumenElevationRequest {
 public static Task<Process> Start(string exe,string args,string cwd) {
  var completion=new TaskCompletionSource<Process>();
  ${kind==='cancel'?'completion.SetException(new Win32Exception(1223));':''}
  return completion.Task;
 }
}`;
  const command=`$ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition ${quote(source)}; & ${quote(path.join(root,'scripts/start-elevated-agent.ps1'))} -DataDir ${quote(dataDir)} -Operation Register -TimeoutSeconds 5`;
  try{return JSON.parse(execFileSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:12000}));}
  catch(error){if(error.stdout)return JSON.parse(String(error.stdout));throw error;}
}
for(const kind of ['cancel','timeout'])test(`mocked UAC ${kind} preserves startup settings and revokes the pending request`,{skip:!windows},()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-uac-check-'));
  const settings=path.join(data,'app-settings.json'),before='{"autoStart":false,"untouched":"profile"}';
  fs.writeFileSync(settings,before);
  try{
    const result=mockedElevation(data,kind);
    assert.equal(result.ok,false);assert.equal(result.cancelled,kind==='cancel');
    assert.equal(result.outcomeUnknown,kind==='timeout');
    assert.equal(fs.readFileSync(settings,'utf8'),before);
    assert.deepEqual(fs.readdirSync(path.join(data,'launch-requests')),[]);
  }finally{fs.unlinkSync(settings);fs.rmdirSync(path.join(data,'launch-requests'));fs.rmdirSync(data);}
});

test('Windows PowerShell 5.1 atomically replaces existing settings and result files',{skip:!windows},()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-atomic-write-'));
  const settings=path.join(data,'app-settings.json'),result=path.join(data,'result.json');
  fs.writeFileSync(settings,'{"autoStart":true}');
  fs.writeFileSync(result,'{"ok":false}');
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  // Parse only these two function declarations. Never execute the worker body,
  // which owns the UAC/Task Scheduler operations being deliberately excluded.
  const command=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);
    $tokens=$null; $parseErrors=$null;
    $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(path.join(root,'scripts/register-background-task.ps1'))},[ref]$tokens,[ref]$parseErrors);
    if($parseErrors.Count){throw 'Worker syntax error'}
    foreach($name in @('Write-LumenSettings','Write-LumenResult')) {
      $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true);
      if(-not $definition){throw ('Missing function '+$name)}
      . ([ScriptBlock]::Create($definition.Extent.Text))
    }
    $script:lumenSettingsPath=${quote(settings)};
    $ResultPath=${quote(result)}; $script:lumenResultPathValidated=$true;
    Write-LumenSettings ([Text.Encoding]::UTF8.GetBytes('{"autoStart":false,"elevatedStartup":false}'));
    $resultJson=Write-LumenResult ([ordered]@{ok=$true;operation='Remove'});
    [ordered]@{version=$PSVersionTable.PSVersion.ToString();result=($resultJson|ConvertFrom-Json)} | ConvertTo-Json -Compress`;
  try {
    const output=JSON.parse(execFileSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000}));
    assert.match(output.version,/^5\.1\./);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings,'utf8')),{autoStart:false,elevatedStartup:false});
    assert.deepEqual(JSON.parse(fs.readFileSync(result,'utf8')),{ok:true,operation:'Remove'});
    assert.deepEqual(output.result,{ok:true,operation:'Remove'});
    assert.deepEqual(fs.readdirSync(data).sort(),['app-settings.json','result.json']);
  } finally {for(const file of fs.readdirSync(data))fs.unlinkSync(path.join(data,file));fs.rmdirSync(data);}
});
