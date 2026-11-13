// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {RuntimeConnection} from '../desktop/runtime-wire.mjs';
import {verifyPackage} from '../shared/portable-release.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'release-history','current');
const application=path.join(release,'app');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-portable-'));
const deadline=Date.now()+90000;
let client,child;
try{
 const manifest=verifyPackage(release);
 assert.equal(manifest.product,'Rayloom');
 assert.equal(fs.existsSync(path.join(application,'runtime','user-data')),false);
 assert.equal(fs.existsSync(path.join(application,'node_modules')),false);
 assert.equal(fs.existsSync(path.join(application,'portable-release.json')),true);
 execFileSync(path.join(release,'Rayloom.exe'),['--check-only'],{windowsHide:true,timeout:10000});
 execFileSync(path.join(application,'runtime','Rayloom-Agent.exe'),['--check-only','--data',dataDir,'--mode','virtual'],{windowsHide:true,timeout:10000});
 child=spawn(path.join(application,'runtime','node','node.exe'),[path.join(application,'desktop','runtime-agent.mjs'),'--data',dataDir,'--mode','virtual'],{
  cwd:application,windowsHide:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}
 });
 child.on('error',()=>{});
 let descriptor;
 while(Date.now()<deadline&&!descriptor){
  try{descriptor=JSON.parse(fs.readFileSync(path.join(dataDir,'runtime.json'),'utf8'));}catch{}
  if(!descriptor)await delay(100);
 }
 assert.ok(descriptor,'Portable agent did not publish its descriptor');
 client=await new RuntimeConnection().connect(descriptor);
 let snapshot;
 while(Date.now()<deadline){
  snapshot=await client.call('snapshot');
  if(!snapshot.starting)break;
  await delay(200);
 }
 assert.equal(snapshot?.mode,'virtual');
 assert.ok(!snapshot?.error,snapshot?.error);
 assert.ok(snapshot?.devices?.length>0,'Portable core did not expose its virtual device');
 assert.ok(snapshot?.plugins?.length>=7,'Portable core did not load seven plugins');
 const state=await client.call('runtime.state');
 const diagnostics=await client.call('runtime.diagnostics');
 assert.equal(path.resolve(diagnostics.root),application);
 assert.ok(state.corePid>0);
 console.log(`Portable runtime OK: ${snapshot.devices.length} virtual device(s), ${snapshot.plugins.length} plugins, version ${manifest.version}`);
}finally{
 try{await client?.call('shutdown');}catch{}
 client?.close();
 if(child&&child.exitCode===null){
  const exit=Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(10000)]);
  await exit;
  if(child.exitCode===null)child.kill();
 }
 const owned=path.resolve(dataDir),temp=path.resolve(os.tmpdir());
 if(path.dirname(owned)===temp&&path.basename(owned).startsWith('rayloom-portable-'))fs.rmSync(owned,{recursive:true,force:true});
}
