// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateRendererState} from './build-retention.mjs';

const pluginFiles=Object.freeze({
 effects:'OpenRGBEffectsPlugin.dll',scheduler:'OpenRGBSchedulerPlugin.dll',
 'http-hook':'OpenRGBHttpHookPlugin.dll','hardware-sync':'OpenRGBHardwareSyncPlugin.dll',
 e131:'OpenRGBE131ReceiverPlugin.dll','visual-map':'OpenRGBVisualMapPlugin.dll',
 skin:'OpenRGBSkinPlugin.dll'
});
const safeName=name=>typeof name==='string'&&name.length>0&&name.length<240&&!/[\\/\0<>:"|?*]/.test(name)&&name!=='.'&&name!=='..'&&!/[ .]$/.test(name);
const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

function assertSafeTree(file){
 const stat=fs.lstatSync(file);
 if(stat.isSymbolicLink())throw Error(`Release input is a link: ${file}`);
 if(stat.isDirectory()){
  for(const name of fs.readdirSync(file)){
   if(!safeName(name))throw Error(`Unsafe release filename: ${name}`);
   assertSafeTree(path.join(file,name));
  }
 }else if(!stat.isFile())throw Error(`Unsupported release input: ${file}`);
}

function sameBytes(left,right){
 const a=fs.statSync(left),b=fs.statSync(right);
 if(!a.isFile()||!b.isFile()||a.size!==b.size)return false;
 const first=fs.openSync(left,'r'),second=fs.openSync(right,'r');
 const x=Buffer.allocUnsafe(1024*1024),y=Buffer.allocUnsafe(1024*1024);
 try{
  for(let offset=0;offset<a.size;offset+=x.length){
   const length=Math.min(x.length,a.size-offset);
   if(fs.readSync(first,x,0,length,offset)!==length||fs.readSync(second,y,0,length,offset)!==length||!x.subarray(0,length).equals(y.subarray(0,length)))return false;
  }
  return true;
 }finally{fs.closeSync(first);fs.closeSync(second);}
}

function copy(root,stage,source,destination=source,previous){
 const from=path.join(root,...source.split('/')),to=path.join(stage,...destination.split('/'));
 if(!exists(from))throw Error(`Release input is missing: ${source}`);
 assertSafeTree(from);
 const transfer=(input,output,relative)=>{
  const stat=fs.lstatSync(input);
  if(relative==='app/core/release/LumenRGB-Core.exe'||relative==='app/plugins/effects/release/RayloomEffectsPlugin.dll')return;
  if(stat.isDirectory()){
   fs.mkdirSync(output,{recursive:true});
   for(const name of fs.readdirSync(input))transfer(path.join(input,name),path.join(output,name),`${relative}/${name}`);
  }else{
   fs.mkdirSync(path.dirname(output),{recursive:true});
   const old=previous&&path.join(previous,...relative.split('/'));
   if(old&&exists(old)&&fs.lstatSync(old).isFile()&&sameBytes(input,old)){
    try{fs.linkSync(old,output);return;}catch{/* Filesystems without links use a copy. */}
   }
   fs.copyFileSync(input,output,fs.constants.COPYFILE_EXCL);
  }
 };
 transfer(from,to,destination);
}

function filesIn(directory){
 const result=[];
 function visit(relative){
  const here=relative?path.join(directory,...relative.split('/')):directory;
  for(const name of fs.readdirSync(here).sort()){
   if(!safeName(name))throw Error(`Unsafe release filename: ${name}`);
   const item=relative?`${relative}/${name}`:name,absolute=path.join(directory,...item.split('/'));
   const stat=fs.lstatSync(absolute);
   if(stat.isDirectory())visit(item);
   else if(stat.isFile()){
    const hash=createHash('sha256');
    hash.update(fs.readFileSync(absolute));
    result.push({path:item,size:stat.size,sha256:hash.digest('hex')});
   }else throw Error(`Release contains a link or unsupported file: ${item}`);
  }
 }
 visit('');return result.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}

function verifyPackage(directory){
 const file=path.join(directory,'release.json');
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!/^\d+\.\d+\.\d+/.test(manifest.version))throw Error('Invalid release manifest');
 const actual=filesIn(directory).filter(item=>item.path!=='release.json');
 if(JSON.stringify(actual)!==JSON.stringify(manifest.files))throw Error('Release package manifest mismatch');
 return manifest;
}

function currentRendererInputs(root){
 const stateFile=path.join(root,'build-history','renderer-retention.json');
 if(!exists(stateFile))throw Error('Verified renderer state is missing');
 const state=validateRendererState(JSON.parse(fs.readFileSync(stateFile,'utf8')));
 return state.current.files.map(item=>{
  const source=`dist/${item.path}`,absolute=path.join(root,...source.split('/'));
  if(!exists(absolute)||!fs.statSync(absolute).isFile())throw Error(`Renderer file is missing: ${source}`);
  const bytes=fs.readFileSync(absolute);
  if(bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error(`Renderer file hash mismatch: ${source}`);
  return [source,`app/${source}`];
 });
}

function requiredInputs(root){
 const listed=[
  ['node_modules/electron/dist','electron'],
  ['desktop','app/desktop'],['shared','app/shared'],...currentRendererInputs(root),
  ['core/release','app/core/release'],['core/LICENSE','app/core/LICENSE'],
  ['data/device-catalog.json','app/data/device-catalog.json'],
  ['sdk/runtime.mjs','app/sdk/runtime.mjs'],
  ['sdk/examples/reactor/manifest.json','app/sdk/examples/reactor/manifest.json'],
  ['public/licenses','app/public/licenses'],
  ['runtime/Rayloom-Agent.exe','app/runtime/Rayloom-Agent.exe'],
  ['runtime/node/node.exe','app/runtime/node/node.exe'],
  ['runtime/node/LICENSE','app/runtime/node/LICENSE'],
  ['scripts/start-elevated-agent.ps1','app/scripts/start-elevated-agent.ps1'],
  ['scripts/register-background-task.ps1','app/scripts/register-background-task.ps1'],
  ['scripts/prepare-uninstall.ps1','app/scripts/prepare-uninstall.ps1'],
  ['scripts/stop-background-runtime.mjs','app/scripts/stop-background-runtime.mjs'],
  ['package.json','app/package.json'],['LICENSE','app/LICENSE']
 ];
 for(const [directory,name] of Object.entries(pluginFiles)){
  const source=directory==='effects'&&exists(path.join(root,'plugins/effects/release/RayloomEffectsPlugin.dll'))?'RayloomEffectsPlugin.dll':name;
  listed.push([`plugins/${directory}/release/${source}`,`app/plugins/${directory}/release/${name}`]);
  if(exists(path.join(root,'plugins',directory,'LICENSE')))listed.push([`plugins/${directory}/LICENSE`,`app/plugins/${directory}/LICENSE`]);
 }
 const brand=path.join(root,'public','brand');
 for(const name of fs.readdirSync(brand).filter(name=>name.startsWith('rayloom-')||name==='rayloom.ico'||name==='rayloom.icns'))listed.push([`public/brand/${name}`,`app/public/brand/${name}`]);
 return listed;
}

function assertOutputRoot(root,history){
 const expected=path.join(root,'release-history');
 if(path.resolve(history)!==expected)throw Error('Release output must stay inside project release-history');
 if(exists(history)){
  if(!fs.lstatSync(history).isDirectory())throw Error('Release history is not a directory');
  for(const name of fs.readdirSync(history))if(!['current','previous'].includes(name))throw Error(`Unresolved release history entry: ${name}`);
  for(const name of ['current','previous'])if(exists(path.join(history,name)))assertSafeTree(path.join(history,name));
 }
}

export function buildPortableRelease(root,{compile,history=path.join(path.resolve(root),'release-history')}={}){
 root=path.resolve(root);history=path.resolve(history);
 if(process.platform!=='win32')throw Error('Portable package builder currently supports Windows only');
 if(!fs.lstatSync(root).isDirectory())throw Error('Release project root must be a real directory');
 assertOutputRoot(root,history);
 const metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 if(!/^\d+\.\d+\.\d+/.test(metadata.version))throw Error('Invalid package version');
 const stage=path.join(history,'.next'),retired=path.join(history,'.retired');
 if(exists(stage)||exists(retired))throw Error('Unresolved release transaction; inspect it before building again');
 fs.mkdirSync(history,{recursive:true});fs.mkdirSync(stage);
 let staged=true;
 try{
  const reusable=path.join(history,'current');
  for(const [source,destination] of requiredInputs(root))copy(root,stage,source,destination,exists(reusable)?reusable:null);
  if(!exists(path.join(stage,'app','core','release','Rayloom-Core.exe')))throw Error('Rayloom native core is missing');
  fs.writeFileSync(path.join(stage,'app','portable-release.json'),JSON.stringify({schemaVersion:1,kind:'windows-portable'})+'\n');
  const icon=path.join(root,'public','brand','rayloom.ico'),launcher=path.join(root,'desktop','RayloomLauncher.cs');
  if(!exists(icon)||!exists(launcher))throw Error('Rayloom launcher source or icon is missing');
  const output=path.join(stage,'Rayloom.exe');
  if(compile)compile({root,stage,launcher,icon,output});
  else{
   const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
   execFileSync(compiler,['/nologo','/target:winexe','/optimize+','/codepage:65001','/reference:System.Windows.Forms.dll',`/win32icon:${icon}`,`/out:${output}`,launcher],{stdio:'pipe'});
  }
  if(!exists(output))throw Error('Rayloom.exe was not built');
  const release={schemaVersion:1,product:'Rayloom',version:metadata.version,platform:'win32',arch:'x64',files:filesIn(stage)};
  fs.writeFileSync(path.join(stage,'release.json'),JSON.stringify(release,null,2)+'\n');
  verifyPackage(stage);
  const current=path.join(history,'current'),previous=path.join(history,'previous');
  const previousManifest=exists(current)?verifyPackage(current):null;
  if(previousManifest&&JSON.stringify(previousManifest.files.filter(item=>item.path!=='Rayloom.exe'))===JSON.stringify(release.files.filter(item=>item.path!=='Rayloom.exe'))){
   fs.rmSync(stage,{recursive:true});staged=false;return {status:'unchanged',current,version:metadata.version,files:release.files.length};
  }
  let retiredOld=false,movedCurrent=false;
  try{
   if(exists(previous)){fs.renameSync(previous,retired);retiredOld=true;}
   if(exists(current)){fs.renameSync(current,previous);movedCurrent=true;}
   fs.renameSync(stage,current);staged=false;
  }catch(error){
   if(movedCurrent)fs.renameSync(previous,current);
   if(retiredOld)fs.renameSync(retired,previous);
   throw error;
  }
  if(retiredOld)fs.rmSync(retired,{recursive:true});
  return {status:'published',current,version:metadata.version,files:release.files.length};
 }finally{
  if(staged&&exists(stage))fs.rmSync(stage,{recursive:true});
 }
}

export {verifyPackage};
