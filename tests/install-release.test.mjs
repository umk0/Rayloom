import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {installRelease,rollbackRelease,uninstallRelease} from '../shared/install-release.mjs';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-install-test-'));
 const input=path.join(root,'input'),install=path.join(root,'installed'),data=path.join(root,'profile'),source=path.join(root,'source');
 const write=(base,name,value)=>{const target=path.join(base,...name.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);};
 const release=(version,content)=>{
  const dir=path.join(input,version);write(dir,'Rayloom.exe',content);write(dir,'app/dist/index.html',`<title>${version}</title>`);
  const files=['Rayloom.exe','app/dist/index.html'].map(name=>{const bytes=fs.readFileSync(path.join(dir,...name.split('/')));return {path:name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}).sort((a,b)=>a.path.localeCompare(b.path,'en'));
  write(dir,'release.json',JSON.stringify({schemaVersion:1,product:'Rayloom',version,files}));return dir;
 };
 return {root,install,data,source,write,release,cleanup(){assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^rayloom-install-test-/);fs.rmSync(root,{recursive:true,force:true});}};
}
test('install, update, rollback and uninstall preserve a separate profile',()=>{
 const f=fixture();try{
  const first=f.release('0.6.0','first'),second=f.release('0.7.0','second');
  f.write(f.source,'hardware/studio/layout.json','{"components":[1]}');
  f.write(f.source,'app-settings.json',JSON.stringify({mode:'hardware',autoStart:true,elevatedStartup:true,startupTaskName:'old'}));
  f.write(f.source,'runtime.json','live token that must not migrate');
  f.write(f.source,'hardware/studio/scenes.json','{"scene":"mine"}');
  // A stale descriptor with no owner is safe to ignore, but never copy it.
  f.write(f.source,'runtime.json',JSON.stringify({pid:2147483647}));
  let result=installRelease({packageDir:first,installDir:f.install,dataDir:f.data,sourceProfile:f.source});
  assert.equal(result.operation,'install');assert.equal(result.migrated,true);
  assert.equal(fs.readFileSync(path.join(f.data,'hardware/studio/layout.json'),'utf8'),'{"components":[1]}');
  assert.equal(fs.existsSync(path.join(f.data,'runtime.json')),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data,'app-settings.json'))).autoStart,false);
  assert.equal(fs.readFileSync(path.join(f.install,'profile-path.txt'),'utf8').trim(),f.data);
  assert.equal(fs.readFileSync(path.join(f.source,'app-settings.json'),'utf8').includes('"autoStart":true'),true);
  result=installRelease({packageDir:second,installDir:f.install,dataDir:f.data});assert.equal(result.operation,'update');
  assert.equal(fs.readFileSync(path.join(f.install,'previous/Rayloom.exe'),'utf8'),'first');
  assert.equal(fs.readFileSync(path.join(f.install,'current/Rayloom.exe'),'utf8'),'second');
  rollbackRelease({installDir:f.install,dataDir:f.data});assert.equal(fs.readFileSync(path.join(f.install,'current/Rayloom.exe'),'utf8'),'first');
  result=uninstallRelease({installDir:f.install,dataDir:f.data});assert.equal(result.dataPreserved,true);
  assert.equal(fs.existsSync(path.join(f.install,'current')),false);assert.equal(fs.existsSync(path.join(f.data,'hardware/studio/layout.json')),true);
 }finally{f.cleanup();}
});
test('installer rejects damaged releases, occupied data and running engines',()=>{
 const f=fixture();try{
  const first=f.release('0.6.0','first');
  f.write(f.data,'other.json','unrelated');
  assert.throws(()=>installRelease({packageDir:first,installDir:f.install,dataDir:f.data}),/not an existing Rayloom profile/);
  assert.equal(fs.existsSync(path.join(f.install,'current')),false);
  fs.rmSync(f.data,{recursive:true});
  f.write(first,'Rayloom.exe','tampered');
  assert.throws(()=>installRelease({packageDir:first,installDir:f.install,dataDir:f.data}),/manifest mismatch/);
  f.write(first,'Rayloom.exe','first');
  installRelease({packageDir:first,installDir:f.install,dataDir:f.data});
  f.write(f.data,'runtime.json',JSON.stringify({pid:process.pid}));
  assert.throws(()=>installRelease({packageDir:first,installDir:f.install,dataDir:f.data}),/running/);
  assert.throws(()=>uninstallRelease({installDir:f.install,dataDir:f.data}),/running/);
 }finally{f.cleanup();}
});
test('explicit profile deletion requires the matching installation marker',()=>{
 const f=fixture();try{
  const first=f.release('0.6.0','first');installRelease({packageDir:first,installDir:f.install,dataDir:f.data});
  f.write(f.data,'.rayloom-profile.json',JSON.stringify({product:'Rayloom',installId:'another-installation'}));
  assert.throws(()=>uninstallRelease({installDir:f.install,dataDir:f.data,deleteData:true}),/not created/);
  assert.equal(fs.existsSync(path.join(f.install,'current')),true);
  const state=JSON.parse(fs.readFileSync(path.join(f.install,'rayloom-install.json')));
  f.write(f.data,'.rayloom-profile.json',JSON.stringify({product:'Rayloom',installId:state.installId}));
  uninstallRelease({installDir:f.install,dataDir:f.data,deleteData:true});assert.equal(fs.existsSync(f.data),false);
 }finally{f.cleanup();}
});
test('reinstall adopts a preserved profile without replacing its settings',()=>{
 const f=fixture();try{
  const first=f.release('0.6.0','first');installRelease({packageDir:first,installDir:f.install,dataDir:f.data});
  f.write(f.data,'scenes/desk.json','my scene');
  uninstallRelease({installDir:f.install,dataDir:f.data});
  installRelease({packageDir:first,installDir:f.install,dataDir:f.data});
  assert.equal(fs.readFileSync(path.join(f.data,'scenes/desk.json'),'utf8'),'my scene');
  assert.equal(fs.existsSync(path.join(f.install,'current/Rayloom.exe')),true);
 }finally{f.cleanup();}
});
