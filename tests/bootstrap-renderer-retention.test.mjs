import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {bootstrapRendererRetention} from '../scripts/bootstrap-renderer-retention.mjs';

const logPaths={current:'artifacts/mantine-device-ports-build-2026-10-29.log',previous:'artifacts/mantine-device-layouts-build-2026-10-29.log'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const release=tag=>[
  `assets/main-${tag}.js`,`assets/main-${tag}.css`,`assets/legacy-${tag}.js`,
  `assets/panel-${tag}.js`,'assets/shared-SHARED01.js',
  'assets/editor.worker-WORKER01.js','assets/font-FONT0001.woff2',
];
const buildLog=files=>files.map(file=>`dist/${file} 1.00 kB`).join('\n')+'\n✓ built in 1.23s\n';

// All mutations below are restricted to newly created OS-temp fixtures. The
// real dist, application processes, renderer windows and hardware are unused.
function fixture(t){
  const temporary=fs.realpathSync(os.tmpdir()),base=fs.mkdtempSync(path.join(temporary,'rayloom-bootstrap-test-'));
  t.after(()=>{
    const relative=path.relative(temporary,path.resolve(base));
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
    fs.rmSync(base,{recursive:true,force:true});
  });
  const root=path.join(base,'workspace');fs.mkdirSync(root);
  const file=relative=>path.join(root,...relative.split('/'));
  const write=(relative,data)=>{fs.mkdirSync(path.dirname(file(relative)),{recursive:true});fs.writeFileSync(file(relative),data);};
  const current=release('CURR0001'),previous=release('PREV0001');
  for(const name of new Set([...current,...previous]))write('dist/'+name,`content for ${name}\n`);
  for(const tag of ['CURR0001','PREV0001']){
    write(`dist/assets/main-${tag}.js`,`import './shared-SHARED01.js';import('./panel-${tag}.js');`);
    write(`dist/assets/main-${tag}.css`,"@font-face{src:url('./font-FONT0001.woff2')}");
    write(`dist/assets/panel-${tag}.js`,"new Worker(new URL('./editor.worker-WORKER01.js',import.meta.url));");
  }
  const html=entry=>`<!doctype html><html><head><script type="module" src="./assets/${entry}-CURR0001.js"></script><link rel="modulepreload" href="./assets/shared-SHARED01.js"><link rel="stylesheet" href="./assets/main-CURR0001.css"><link rel="icon" href="./brand/icon.png"></head><body></body></html>`;
  write('dist/index.html',html('main'));write('dist/legacy.html',html('legacy'));
  for(const name of ['brand/icon.png','licenses/notice.txt']){write('public/'+name,'public '+name);write('dist/'+name,'public '+name);}
  write(logPaths.current,buildLog(current));write(logPaths.previous,buildLog(previous));
  write('dist/assets/obsolete-OLD00001.js','obsolete one');
  write('dist/assets/archive/obsolete-OLD00002.js','obsolete two');
  write('dist/unrelated.txt','preserve outside assets');write('user-profile.json','preserve user data');
  return {base,root,file,write,current,previous,html};
}

function tree(root){
  const result={};
  const walk=relative=>{
    const location=path.join(root,relative),stat=fs.lstatSync(location);
    if(stat.isSymbolicLink()){result[relative]={kind:'link',target:fs.readlinkSync(location)};return;}
    if(stat.isDirectory()){result[relative]={kind:'directory'};for(const name of fs.readdirSync(location).sort())walk(path.join(relative,name));return;}
    result[relative]={kind:'file',sha256:hash(fs.readFileSync(location)),size:stat.size};
  };
  walk('');return result;
}

function assertUnchangedAfterFailure(f,pattern){
  const before=tree(f.base);
  assert.throws(()=>bootstrapRendererRetention(f.root,{apply:true}),pattern);
  assert.deepEqual(tree(f.base),before);
}

function linkOrSkip(t,target,link,type){
  try{fs.symlinkSync(target,link,type);return true;}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('OS does not allow creating this symbolic link');return false;}throw error;}
}

test('bootstrap defaults to a read-only plan, including absent history directory',t=>{
  const f=fixture(t),before=tree(f.base),result=bootstrapRendererRetention(f.root);
  assert.equal(result.currentAssets,7);assert.equal(result.previousAssets,7);
  assert.equal(result.retainedAssets,11);assert.equal(result.removeFiles,2);
  assert.equal(result.removeBytes,24);
  assert.deepEqual(new Set(result.files),new Set(['assets/obsolete-OLD00001.js','assets/archive/obsolete-OLD00002.js']));
  assert.deepEqual(tree(f.base),before);assert.equal(result.applied,undefined);
});

test('bootstrap apply snapshots previous references and deletes only obsolete assets',t=>{
  const f=fixture(t),before=tree(f.root),result=bootstrapRendererRetention(f.root,{apply:true});
  assert.equal(result.applied,true);assert.equal(result.removeFiles,2);
  for(const name of [...new Set([...f.current,...f.previous]),'index.html','legacy.html','brand/icon.png','licenses/notice.txt','unrelated.txt']){
    const relative=path.join('dist',name);assert.deepEqual(tree(f.root)[relative],before[relative],relative);
  }
  assert.equal(fs.existsSync(f.file('dist/assets/obsolete-OLD00001.js')),false);
  assert.equal(fs.existsSync(f.file('dist/assets/archive/obsolete-OLD00002.js')),false);
  assert.equal(fs.readFileSync(f.file('user-profile.json'),'utf8'),'preserve user data');
  for(const [entry,kind] of [['index.html','main'],['legacy.html','legacy']]){
    assert.equal(fs.readFileSync(f.file('build-history/previous-renderer/'+entry),'utf8'),f.html(kind).replaceAll('CURR0001','PREV0001'));
  }
  const state=JSON.parse(fs.readFileSync(f.file('build-history/renderer-retention.json'),'utf8'));
  assert.equal(state.schemaVersion,1);
  for(const [kind,directory] of [['current','dist'],['previous','build-history/previous-renderer']]){
    assert.equal(state[kind].files.length,11);
    for(const record of state[kind].files){const bytes=fs.readFileSync(f.file(directory+'/'+record.path));assert.equal(record.sha256,hash(bytes));assert.equal(record.size,bytes.length);}
  }
  assert.equal(fs.existsSync(f.file('build-history/.bootstrap-previous')),false);
  const receipt=JSON.parse(fs.readFileSync(f.file('build-history/bootstrap-receipt.json'),'utf8'));
  assert.deepEqual(receipt.files,result.files);assert.match(receipt.previousHtml,/reconstructed/);
});

test('missing previous asset aborts before snapshot or deletion',t=>{
  const f=fixture(t);fs.unlinkSync(f.file('dist/assets/panel-PREV0001.js'));
  assertUnchangedAfterFailure(f,/ENOENT/);
});

test('ambiguous previous HTML asset family aborts before deletion',t=>{
  const f=fixture(t),duplicate='assets/main-PREV0002.js';
  f.write('dist/'+duplicate,'alternate previous entry');
  f.write(logPaths.previous,buildLog([...f.previous,duplicate]));
  assertUnchangedAfterFailure(f,/Ambiguous previous entry asset/);
});

test('unfinished build and unlisted current HTML references fail closed',t=>{
  const f=fixture(t);f.write(logPaths.previous,buildLog(f.previous).replace('✓ built in 1.23s','build failed'));
  assertUnchangedAfterFailure(f,/does not confirm completion/);
  f.write(logPaths.previous,buildLog(f.previous));
  f.write('dist/index.html',f.html('main').replace('main-CURR0001.js','missing-UNKNOWN1.js'));
  assertUnchangedAfterFailure(f,/unlisted asset/);
});

test('mismatched deployed public asset aborts before deletion',t=>{
  const f=fixture(t);f.write('dist/brand/icon.png','newer icon');
  assertUnchangedAfterFailure(f,/Public file differs/);
});

test('existing previous snapshot is never overwritten by a second bootstrap',t=>{
  const f=fixture(t);bootstrapRendererRetention(f.root,{apply:true});
  f.write('dist/assets/newly-obsolete-OLD00003.js','must remain on rejected retry');
  assertUnchangedAfterFailure(f,/Bootstrap target already exists/);
});

test('traversal and Windows path injection in the historical log are rejected before deletion',t=>{
  const f=fixture(t);
  for(const unsafe of ['assets/../../outside.js','assets/../outside.js','assets/C:/outside.js','assets/back\\slash.js']){
    f.write(logPaths.previous,buildLog([...f.previous,unsafe]));
    assertUnchangedAfterFailure(f,/Unsafe relative path/);
  }
});

test('an unused asset junction pointing outside the workspace aborts safely',t=>{
  const f=fixture(t),outside=path.join(f.base,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'preserve.txt'),'outside');
  if(!linkOrSkip(t,outside,f.file('dist/assets/external'),process.platform==='win32'?'junction':'dir'))return;
  assertUnchangedAfterFailure(f,/symlink|junction/);
});

test('a dangling history junction is rejected before creating external files',t=>{
  const f=fixture(t),outside=path.join(f.base,'absent-external');
  if(!linkOrSkip(t,outside,f.file('build-history'),process.platform==='win32'?'junction':'dir'))return;
  assertUnchangedAfterFailure(f,/symlink|junction/);
  assert.equal(fs.existsSync(outside),false);
});

test('a dangling state temp symlink cannot redirect snapshot state writes outside the workspace',t=>{
  const f=fixture(t),outside=path.join(f.base,'outside-state.json');fs.mkdirSync(f.file('build-history'));
  if(!linkOrSkip(t,outside,f.file('build-history/renderer-retention.json.tmp'),'file'))return;
  assertUnchangedAfterFailure(f,/symlink|junction/);
  assert.equal(fs.existsSync(outside),false);
});
