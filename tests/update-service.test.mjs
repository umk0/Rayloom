import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {UpdateService,compareVersions} from '../desktop/update-service.mjs';

test('version comparison uses numeric components',()=>{assert.equal(compareVersions('0.10.0','0.9.9'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);});
test('release check and checksum verified download',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-update-test-'));const bytes=Buffer.from('setup fixture'),name='Rayloom-Setup-0.7.0.exe';
 const sha=createHash('sha256').update(bytes).digest('hex');
 const fetcher=async url=>url.endsWith('/latest')?new Response(JSON.stringify({tag_name:'v0.7.0',assets:[{name,size:bytes.length,browser_download_url:`https://github.com/umk0/Rayloom/releases/download/v0.7.0/${name}`},{name:name+'.sha256',browser_download_url:`https://github.com/umk0/Rayloom/releases/download/v0.7.0/${name}.sha256`}]})):new Response(url.endsWith('.sha256')?sha:bytes);
 try{const updates=new UpdateService({version:'0.6.0',dataDir:dir,fetcher});assert.equal((await updates.check()).status,'available');assert.equal((await updates.download()).status,'downloaded');assert.equal(fs.readFileSync(updates.installedPath(),'utf8'),'setup fixture');}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('prerelease is discoverable before the first stable GitHub release',async()=>{
 const fetcher=async url=>url.endsWith('/latest')?new Response('',{status:404}):new Response(JSON.stringify([{tag_name:'v0.7.0',draft:false,prerelease:true,assets:[{name:'Rayloom-Setup-0.7.0.exe',size:12,browser_download_url:'https://github.com/umk0/Rayloom/releases/download/v0.7.0/Rayloom-Setup-0.7.0.exe'},{name:'Rayloom-Setup-0.7.0.exe.sha256',browser_download_url:'https://github.com/umk0/Rayloom/releases/download/v0.7.0/Rayloom-Setup-0.7.0.exe.sha256'}]}]));
 const updates=new UpdateService({version:'0.6.0',dataDir:os.tmpdir(),fetcher});
 assert.equal((await updates.check()).status,'available');
});
