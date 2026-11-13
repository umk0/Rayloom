import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scanRendererFiles,publishRendererBuild,runRendererBuild,rendererPaths,validateRendererState} from '../shared/build-retention.mjs';
import {buildRenderer} from '../scripts/build-renderer.mjs';

const oldFiles={'index.html':'old index','legacy.html':'old legacy','assets/older-AAAAAAAA.js':'old chunk','brand/logo.svg':'old logo'};
const currentFiles={'index.html':'current index','legacy.html':'current legacy','assets/current-BBBBBBBB.js':'current chunk','assets/base-CCCCCCCC.css':'current css','brand/logo.svg':'current logo'};
const nextFiles={'index.html':'next index','legacy.html':'next legacy','assets/next-DDDDDDDD.js':'next chunk','assets/base-CCCCCCCC.css':'current css','brand/logo.svg':'next logo'};
const lastFiles={'index.html':'last index','assets/last-EEEEEEEE.js':'last chunk','brand/logo.svg':'last logo'};

function temporary(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-build-retention-'));
 t.after(()=>{assert(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()),'rayloom-build-retention-')));fs.rmSync(root,{recursive:true,force:true});});return root;
}
function writeFiles(root,relative,files){
 for(const [name,content] of Object.entries(files)){const file=path.join(root,relative,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
}
const readState=root=>JSON.parse(fs.readFileSync(path.join(root,rendererPaths.state),'utf8'));
function fixture(t,{previous=true}={}){
 const root=temporary(t);writeFiles(root,'dist',currentFiles);fs.mkdirSync(path.join(root,'build-history'));
 const current={id:'current',files:scanRendererFiles(root,'dist')};let older=null;
 if(previous){writeFiles(root,rendererPaths.previous,oldFiles);older={id:'old',files:scanRendererFiles(root,rendererPaths.previous)};writeFiles(root,'dist',{'assets/older-AAAAAAAA.js':oldFiles['assets/older-AAAAAAAA.js']});}
 fs.writeFileSync(path.join(root,rendererPaths.state),JSON.stringify({schemaVersion:1,current,previous:older}));return root;
}
function protectedSnapshot(root){
 const data={state:fs.existsSync(path.join(root,rendererPaths.state))?fs.readFileSync(path.join(root,rendererPaths.state),'utf8'):null};
 for(const dir of ['dist',rendererPaths.previous])data[dir]=fs.existsSync(path.join(root,dir))?scanRendererFiles(root,dir):null;
 return data;
}
function assertNoScratch(root){
 for(const name of ['stage','lock','currentBackup','previousNext','previousBackup','stateNext'])assert.equal(fs.existsSync(path.join(root,rendererPaths[name])),false,name);
}
const generator=(root,files)=>async outDir=>{assert.equal(outDir,path.join(root,rendererPaths.stage));writeFiles(root,rendererPaths.stage,files);};

test('typecheck failure and partial bundle failure preserve current and previous bytes',async t=>{
 const root=fixture(t),before=protectedSnapshot(root);let bundleCalls=0;
 await assert.rejects(buildRenderer(root,{check:async()=>{throw Error('typecheck failed');},build:async()=>{bundleCalls++;}}),/typecheck failed/);
 assert.equal(bundleCalls,0);assert.deepEqual(protectedSnapshot(root),before);assertNoScratch(root);
 await assert.rejects(buildRenderer(root,{check:async()=>{},build:async(project,outDir)=>{assert.equal(project,root);fs.writeFileSync(path.join(outDir,'index.html'),'partial');throw Error('bundle failed');}}),/bundle failed/);
 assert.deepEqual(protectedSnapshot(root),before);assertNoScratch(root);
});

test('identical successful build preserves previous version, compatibility assets and state id',async t=>{
 const root=fixture(t),before=protectedSnapshot(root);
 const result=await runRendererBuild(root,generator(root,currentFiles),{id:'must-not-replace-id'});
 assert.equal(result.status,'unchanged');assert.equal(readState(root).current.id,'current');
 assert.deepEqual(protectedSnapshot(root),before);assertNoScratch(root);
});

test('successful rotations retain only current plus previous assets and archive exact current files',async t=>{
 const root=fixture(t),firstCurrent=readState(root).current;
 const result=await runRendererBuild(root,generator(root,nextFiles),{id:'next'});
 assert.equal(result.status,'published');assert.deepEqual(result.warnings,[]);
 const state=readState(root);assert.equal(state.current.id,'next');assert.deepEqual(state.previous,firstCurrent);
 assert.deepEqual(scanRendererFiles(root,rendererPaths.previous),firstCurrent.files);
 assert.equal(fs.existsSync(path.join(root,'dist/assets/current-BBBBBBBB.js')),true,'old open window can still import its lazy chunk');
 assert.equal(fs.existsSync(path.join(root,'dist/assets/older-AAAAAAAA.js')),false,'version older than previous is removed');
 assert.equal(state.current.files.some(file=>file.path==='assets/current-BBBBBBBB.js'),false,'compatibility copy is not a current manifest member');
 assert.equal(fs.readFileSync(path.join(root,'dist/brand/logo.svg'),'utf8'),'next logo');
 assert.equal(fs.readFileSync(path.join(root,rendererPaths.previous,'brand/logo.svg'),'utf8'),'current logo');
 const previousInode=fs.statSync(path.join(root,rendererPaths.previous,'assets/current-BBBBBBBB.js'));
 const compatibleInode=fs.statSync(path.join(root,'dist/assets/current-BBBBBBBB.js'));
 if(previousInode.nlink>1)assert.equal(previousInode.ino,compatibleInode.ino,'supported filesystems reuse immutable hashed assets');
 assertNoScratch(root);
 await runRendererBuild(root,generator(root,lastFiles),{id:'last'});
 const last=readState(root);assert.equal(last.current.id,'last');assert.equal(last.previous.id,'next');
 assert.deepEqual(scanRendererFiles(root,rendererPaths.previous),last.previous.files);
 assert.equal(fs.existsSync(path.join(root,'dist/assets/next-DDDDDDDD.js')),true);
 assert.equal(fs.existsSync(path.join(root,'dist/assets/current-BBBBBBBB.js')),false);
 assert.equal(fs.existsSync(path.join(root,rendererPaths.previous,'assets/current-BBBBBBBB.js')),false);
 assertNoScratch(root);
});

test('first rotation without an older version creates one exact previous snapshot',async t=>{
 const root=fixture(t,{previous:false}),current=readState(root).current;
 await runRendererBuild(root,generator(root,nextFiles),{id:'next'});
 assert.deepEqual(readState(root).previous,current);assert.deepEqual(scanRendererFiles(root,rendererPaths.previous),current.files);assertNoScratch(root);
});

test('fresh checkout builds successfully with previous=null and failed builds leave no published state',async t=>{
 for(const emptyDist of [false,true]){
  const root=temporary(t);if(emptyDist)fs.mkdirSync(path.join(root,'dist'));
  const before=protectedSnapshot(root);
  await assert.rejects(runRendererBuild(root,async outDir=>{fs.writeFileSync(path.join(outDir,'index.html'),'partial');throw Error('first build failed');}),/first build failed/);
  assert.deepEqual(protectedSnapshot(root),before);assertNoScratch(root);
  const result=await runRendererBuild(root,generator(root,nextFiles),{id:'first'});
  assert.equal(result.status,'published');assert.equal(readState(root).current.id,'first');assert.equal(readState(root).previous,null);
  assert.equal(fs.existsSync(path.join(root,rendererPaths.previous)),false);assertNoScratch(root);
 }
});

test('untracked existing dist or interrupted first transaction cannot be auto-initialized',async t=>{
 const root=temporary(t);writeFiles(root,'dist',currentFiles);const before=protectedSnapshot(root);let calls=0;
 await assert.rejects(runRendererBuild(root,async()=>{calls++;}),/state is missing for an existing dist/);
 assert.equal(calls,0);assert.deepEqual(protectedSnapshot(root),before);
 for(const leftover of [rendererPaths.stage,rendererPaths.currentBackup,rendererPaths.previousNext,rendererPaths.previousBackup,rendererPaths.previous]){
  const fresh=temporary(t);fs.mkdirSync(path.join(fresh,leftover),{recursive:true});fs.writeFileSync(path.join(fresh,leftover,'keep.txt'),'recover me');
  await assert.rejects(runRendererBuild(fresh,async()=>{calls++;}),/Untracked|Unfinished/);
  assert.equal(fs.readFileSync(path.join(fresh,leftover,'keep.txt'),'utf8'),'recover me');assert.equal(fs.existsSync(path.join(fresh,rendererPaths.state)),false);
 }
 assert.equal(calls,0);
});

test('missing or changed published file aborts before generator and never drops the other version',async t=>{
 for(const mutate of [(root)=>fs.unlinkSync(path.join(root,'dist/assets/current-BBBBBBBB.js')),(root)=>fs.writeFileSync(path.join(root,'dist/assets/current-BBBBBBBB.js'),'manual edit'),(root)=>fs.writeFileSync(path.join(root,rendererPaths.previous,'index.html'),'damaged backup')]){
  const root=fixture(t);mutate(root);const before=protectedSnapshot(root);let calls=0;
  await assert.rejects(runRendererBuild(root,async()=>{calls++;}),/missing|hash mismatch/);
  assert.equal(calls,0);assert.deepEqual(protectedSnapshot(root),before);assertNoScratch(root);
 }
});

test('empty or incomplete successful bundle cannot replace a working renderer',async t=>{
 const root=fixture(t),before=protectedSnapshot(root);
 await assert.rejects(runRendererBuild(root,generator(root,{'assets/only-12345678.js':'no html'})),/no index.html/);
 assert.deepEqual(protectedSnapshot(root),before);assertNoScratch(root);
});

test('escaping and ambiguous manifest paths are rejected before touching files',async t=>{
 const root=fixture(t),state=readState(root),before=protectedSnapshot(root);
 for(const unsafe of ['../outside.txt','assets/../../outside.txt','/absolute.js','C:/outside.js','assets\\outside.js','assets//file.js','assets/./file.js','assets/CON.js','assets/file.js.']){
  const invalid=structuredClone(state);invalid.current.files[0].path=unsafe;
  assert.throws(()=>validateRendererState(invalid),/Unsafe renderer relative path/);
 }
 const duplicate=structuredClone(state);duplicate.current.files.push({...duplicate.current.files[0],path:duplicate.current.files[0].path.toUpperCase()});
 assert.throws(()=>validateRendererState(duplicate),/Invalid renderer file manifest/);
 assert.deepEqual(protectedSnapshot(root),before);
});

test('manifest path escape on disk is rejected without running a generator',async t=>{
 const root=fixture(t),state=readState(root);state.current.files[0].path='../outside.txt';fs.writeFileSync(path.join(root,rendererPaths.state),JSON.stringify(state));
 let calls=0;await assert.rejects(runRendererBuild(root,async()=>{calls++;}),/Unsafe renderer relative path/);assert.equal(calls,0);
 assert.equal(readState(root).current.files[0].path,'../outside.txt');assertNoScratch(root);
});

test('symlinked staging, nested output and project ancestors are rejected without following targets',async t=>{
 const outside=temporary(t);fs.writeFileSync(path.join(outside,'keep.txt'),'protected outside data');
 const link=(target,destination)=>fs.symlinkSync(target,destination,process.platform==='win32'?'junction':'dir');
 try{
  const root=fixture(t);link(outside,path.join(root,rendererPaths.stage));
  await assert.rejects(runRendererBuild(root,generator(root,nextFiles)),/symlink/);assert.equal(fs.lstatSync(path.join(root,rendererPaths.stage)).isSymbolicLink(),true);
  const nested=fixture(t);link(outside,path.join(nested,'dist/assets/linked'));
  await assert.rejects(runRendererBuild(nested,generator(nested,nextFiles)),/symlink/);
  const actual=fixture(t),holder=temporary(t);link(actual,path.join(holder,'linked-project'));
  await assert.rejects(runRendererBuild(path.join(holder,'linked-project'),async()=>{}),/symlink/);
 }catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('This filesystem cannot create directory links');return;}throw error;}
 assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'protected outside data');assert.deepEqual(fs.readdirSync(outside),['keep.txt']);
});

test('failed publish at each swap step restores exact current, previous and manifest bytes',async t=>{
 for(const step of ['before-current-move','after-current-move','after-current-publish','after-previous-move','after-previous-publish','before-state-publish']){
  const root=fixture(t),before=protectedSnapshot(root);
  await assert.rejects(runRendererBuild(root,generator(root,nextFiles),{id:'failed',fault:phase=>{if(phase===step)throw Error(`injected ${step}`);}}),new RegExp(`injected ${step}`));
  assert.deepEqual(protectedSnapshot(root),before,step);assertNoScratch(root);
 }
});

test('first-build publish failure restores an absent or empty dist without creating state',async t=>{
 for(const emptyDist of [false,true]){
  const root=temporary(t);if(emptyDist)fs.mkdirSync(path.join(root,'dist'));const before=protectedSnapshot(root);
  await assert.rejects(runRendererBuild(root,generator(root,nextFiles),{fault:phase=>{if(phase==='before-state-publish')throw Error('state swap failed');}}),/state swap failed/);
  assert.deepEqual(protectedSnapshot(root),before);assertNoScratch(root);
 }
});

test('second build cannot overwrite a concurrent build staging directory',async t=>{
 const root=fixture(t);let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const first=runRendererBuild(root,async outDir=>{writeFiles(root,rendererPaths.stage,nextFiles);entered();await gate;assert.equal(fs.readFileSync(path.join(outDir,'index.html'),'utf8'),'next index');},{id:'first'});
 await started;
 try{await assert.rejects(runRendererBuild(root,generator(root,lastFiles)),/Another renderer build/);}finally{release();}
 assert.equal((await first).state.current.id,'first');assertNoScratch(root);
});

test('already-built staging can be published without invoking a compiler',async t=>{
 const root=fixture(t);writeFiles(root,rendererPaths.stage,nextFiles);
 const result=await publishRendererBuild(root,{id:'prebuilt'});assert.equal(result.state.current.id,'prebuilt');assertNoScratch(root);
});
