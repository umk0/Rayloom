// Real Electron lifecycle smoke, without Playwright/debugger and without hardware.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';

const root=path.resolve(import.meta.dirname,'..');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-plain-close-'));
const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
const screenshot=path.join(data,'closed.png');
const env={...process.env,RAYLOOM_MODE:'virtual',RAYLOOM_USER_DATA:data,RAYLOOM_SCREENSHOT:screenshot};
delete env.ELECTRON_RUN_AS_NODE;
const executable=path.join(root,'node_modules','electron','dist',process.platform==='win32'?'electron.exe':'electron');
const child=spawn(executable,[root],{cwd:root,env,windowsHide:true,stdio:'ignore'});
let exited=false,error=null,client;
child.once('exit',()=>{exited=true;});child.once('error',value=>{error=value;});
const report={mode:'virtual',data,electronPid:child.pid};
try{
 const deadline=Date.now()+12000;while(!exited&&!error&&Date.now()<deadline)await delay(100);
 if(error)throw error;
 report.exited=exited;report.exitCode=child.exitCode;report.screenshot=fs.existsSync(screenshot);
 client=await connectRuntime(root,data,'virtual',{launch:false});
 const agent=await client.call('runtime.state');
 report.agent={pid:agent.pid,ready:agent.ready,mode:agent.mode,memory:agent.memory,htmlRenderer:agent.htmlRenderer};
 assert.equal(report.screenshot,true,'The complete UI must have opened before its automatic close');
 assert.equal(report.exited,true,'The actual Electron main process must exit while the agent stays alive');
 assert.equal(report.exitCode,0);
 assert.equal(report.agent.ready,true);assert.equal(report.agent.mode,'virtual');
 console.log(`PASS plain Electron ${report.electronPid} exits; virtual agent ${report.agent.pid} stays ready`);
}catch(value){report.error=value.stack;process.exitCode=1;console.error(value.message);}
finally{
 if(!client)try{client=await connectRuntime(root,data,'virtual',{launch:false});}catch{}
 try{await client?.call('shutdown');}finally{client?.close();}
 await delay(500);if(!exited)child.kill();
 fs.writeFileSync(path.join(artifacts,'plain-electron-close.json'),JSON.stringify(report,null,2));
}
