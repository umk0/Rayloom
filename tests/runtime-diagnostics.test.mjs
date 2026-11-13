import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runtimeDiagnostics,diagnosticArgv} from '../desktop/runtime-diagnostics.mjs';

test('diagnostic arguments retain only executable/script and known path/mode arguments',()=>{
 assert.deepEqual(diagnosticArgv(['node.exe','agent.mjs','--token','secret','--data','C:/Profile','--api-key=secret','--mode','hardware']),['node.exe','agent.mjs','--data','C:/Profile','--mode','hardware']);
});
test('configuration diagnostics distinguish cache, actual JSON, missing files and malformed JSON without changing files',t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-diagnostic-')),studioDir=path.join(dataDir,'hardware','studio');fs.mkdirSync(studioDir,{recursive:true});
 t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const settingsFile=path.join(dataDir,'app-settings.json'),layoutFile=path.join(studioDir,'layout.json');
 const bytes=JSON.stringify({autoStart:true,elevatedStartup:true,privateToken:'never-return-this',startupTaskName:'LumenRGB-Agent-'+ 'a'.repeat(24)});fs.writeFileSync(settingsFile,bytes);fs.writeFileSync(layoutFile,JSON.stringify({version:1,components:[{name:'private device'}],groups:[]}));
 const params={dataDir,studioDir,root:dataDir,mode:'hardware',settings:{autoStart:false}};let result=runtimeDiagnostics(params);
 assert.equal(result.cachedSettings.autoStart,false);assert.equal(result.files.settings.read.result.autoStart,true);assert.equal(result.files.layout.read.result.components,1);assert.equal(result.files.playback.read.error.code,'ENOENT');assert(!JSON.stringify(result).includes('never-return-this'));assert(!JSON.stringify(result).includes('private device'));assert.equal(fs.readFileSync(settingsFile,'utf8'),bytes);
 fs.writeFileSync(settingsFile,'\ufeff'+bytes);result=runtimeDiagnostics(params);assert.equal(result.files.settings.read.ok,false);assert.equal(result.files.settings.read.error.name,'SyntaxError');assert.equal(result.files.settings.read.error.message,'Invalid JSON');assert.deepEqual(result.files.settings.firstBytes.slice(0,3),[239,187,191]);
 fs.writeFileSync(settingsFile,'x'.repeat(65537));assert.equal(runtimeDiagnostics(params).files.settings.read.error.code,'DIAGNOSTIC_SIZE_LIMIT');
});
