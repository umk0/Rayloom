import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildPortableRelease,verifyPackage} from '../shared/portable-release.mjs';
import {electronHostExecutable} from '../desktop/electron-host.mjs';
import userDataPath from '../desktop/user-data-path.cjs';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-release-test-'));
 const write=(name,value='fixture')=>{const file=path.join(root,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);if(name==='dist/index.html'){
  const bytes=fs.readFileSync(file),state=path.join(root,'build-history/renderer-retention.json');fs.mkdirSync(path.dirname(state),{recursive:true});
  fs.writeFileSync(state,JSON.stringify({schemaVersion:1,current:{id:'fixture',files:[{path:'index.html',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]},previous:null}));
 }};
 for(const name of [
  'node_modules/electron/dist/electron.exe','node_modules/electron/dist/LICENSE',
  'desktop/main.cjs','desktop/RayloomLauncher.cs','shared/spatial.mjs',
  'dist/index.html','core/release/Rayloom-Core.exe','core/LICENSE',
  'data/device-catalog.json','sdk/runtime.mjs','sdk/examples/reactor/manifest.json',
  'public/licenses/Mantine-MIT.txt','public/brand/rayloom.ico','public/brand/rayloom-256.png',
  'runtime/Rayloom-Agent.exe','runtime/node/node.exe','runtime/node/LICENSE',
  'scripts/start-elevated-agent.ps1','scripts/register-background-task.ps1','scripts/prepare-uninstall.ps1','scripts/migrate-startup-task.ps1','scripts/stop-background-runtime.mjs',
  'LICENSE'
 ])write(name);
 for(const [dir,name] of Object.entries({effects:'OpenRGBEffectsPlugin.dll',scheduler:'OpenRGBSchedulerPlugin.dll','http-hook':'OpenRGBHttpHookPlugin.dll','hardware-sync':'OpenRGBHardwareSyncPlugin.dll',e131:'OpenRGBE131ReceiverPlugin.dll','visual-map':'OpenRGBVisualMapPlugin.dll',skin:'OpenRGBSkinPlugin.dll'}))write(`plugins/${dir}/release/${name}`);
 write('package.json',JSON.stringify({version:'0.6.0',main:'desktop/main.cjs'}));
 const compile=({output})=>fs.writeFileSync(output,'launcher');
 return {root,write,compile,cleanup(){const owned=path.resolve(root),temp=path.resolve(os.tmpdir());if(path.dirname(owned)!==temp||!path.basename(owned).startsWith('rayloom-release-test-'))throw Error('Unsafe test cleanup');fs.rmSync(owned,{recursive:true,force:true});}};
}

test('portable release retains only current and previous; profiles stay outside package',()=>{
 const f=fixture();try{
  f.write('runtime/user-data/secret.json','private');
  f.write('plugins/effects/release/RayloomEffectsPlugin.dll','upgraded effects');
  f.write('dist/assets/stale-lumen.js','old branding retained for an already open editor');
  f.write('core/release/LumenRGB-Core.exe','legacy binary');
  let result=buildPortableRelease(f.root,{compile:f.compile});assert.equal(result.status,'published');
  assert.equal(fs.existsSync(path.join(result.current,'app/core/release/LumenRGB-Core.exe')),false);
  assert.equal(fs.readFileSync(path.join(result.current,'app/plugins/effects/release/OpenRGBEffectsPlugin.dll'),'utf8'),'upgraded effects');
  assert.equal(fs.existsSync(path.join(result.current,'app/plugins/effects/release/RayloomEffectsPlugin.dll')),false);
  assert.equal(fs.existsSync(path.join(result.current,'app/dist/assets/stale-lumen.js')),false);
  assert.equal(fs.existsSync(path.join(result.current,'app/runtime/user-data')),false);
  assert.equal(fs.existsSync(path.join(result.current,'app/node_modules')),false);
  result=buildPortableRelease(f.root,{compile:f.compile});assert.equal(result.status,'unchanged');
  f.write('dist/index.html','second');result=buildPortableRelease(f.root,{compile:f.compile});assert.equal(result.status,'published');
  const sharedOld=fs.statSync(path.join(f.root,'release-history/previous/electron/electron.exe'));
  const sharedNew=fs.statSync(path.join(f.root,'release-history/current/electron/electron.exe'));
  assert.equal(sharedOld.ino,sharedNew.ino,'unchanged Electron binary is shared by hardlink');
  assert.ok(sharedNew.nlink>=2);
  f.write('dist/index.html','third');result=buildPortableRelease(f.root,{compile:f.compile});assert.equal(result.status,'published');
  const history=path.join(f.root,'release-history');
  assert.deepEqual(fs.readdirSync(history).sort(),['current','previous']);
  assert.equal(fs.readFileSync(path.join(history,'previous/app/dist/index.html'),'utf8'),'second');
  assert.equal(fs.readFileSync(path.join(history,'current/app/dist/index.html'),'utf8'),'third');
  verifyPackage(path.join(history,'current'));verifyPackage(path.join(history,'previous'));
 }finally{f.cleanup();}
});

test('missing release input and changed published bytes cannot erase current package',()=>{
 const f=fixture();try{
  buildPortableRelease(f.root,{compile:f.compile});
  fs.rmSync(path.join(f.root,'plugins/effects/release/OpenRGBEffectsPlugin.dll'));
  assert.throws(()=>buildPortableRelease(f.root,{compile:f.compile}),/missing/);
  assert.equal(fs.existsSync(path.join(f.root,'release-history/current/release.json')),true);
  f.write('plugins/effects/release/OpenRGBEffectsPlugin.dll');
  f.write('release-history/current/app/dist/index.html','tampered');
  assert.throws(()=>buildPortableRelease(f.root,{compile:f.compile}),/manifest mismatch/);
  assert.equal(fs.existsSync(path.join(f.root,'release-history/previous')),false);
 }finally{f.cleanup();}
});

test('HTML host resolves the matching checkout or portable Electron',()=>{
 const root='C:/Rayloom/app';
 const local=path.join(root,'node_modules/electron/dist/electron.exe');
 const portable=path.join(root,'../electron/electron.exe');
 assert.equal(electronHostExecutable(root,{platform:'win32',exists:file=>file===local}),local);
 assert.equal(electronHostExecutable(root,{platform:'win32',exists:file=>file===portable}),portable);
 assert.throws(()=>electronHostExecutable(root,{platform:'win32',exists:()=>false}),/missing/);
});

test('portable profile remains outside rotating package and explicit profile wins',()=>{
 const {resolveUserDataPath}=userDataPath;
 const root=path.resolve('C:/Rayloom/release-history/current/app');
 const previous=path.resolve('C:/Rayloom/release-history/previous/app');
 const local=path.resolve('C:/Users/Tester/AppData/Local');
 const expected=path.join(local,'Rayloom');
 assert.equal(resolveUserDataPath({root,portable:true,localAppData:local}),expected);
 assert.equal(resolveUserDataPath({root:previous,portable:true,localAppData:local}),expected);
 assert.equal(resolveUserDataPath({root,portable:false}),path.join(root,'runtime','user-data'));
 const custom=path.resolve('C:/Test/Profile');
 assert.equal(resolveUserDataPath({root,portable:true,localAppData:local,override:custom}),custom);
});
