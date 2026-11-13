// SPDX-License-Identifier: GPL-2.0-or-later
// Per-user release transaction. Data lives outside the versioned application.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyPackage} from './portable-release.mjs';

const marker='rayloom-install.json',profileMarker='.rayloom-profile.json';
const owned=new Set(['current','previous','.next','.retired','.swap']);
const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
function directory(value,label){
 if(typeof value!=='string'||!path.isAbsolute(value))throw Error(`${label} must be an absolute path`);
 const result=path.resolve(value),root=path.parse(result).root;
 if(result===root||path.relative(root,result).split(path.sep).filter(Boolean).length<2)throw Error(`${label} is too close to a drive root`);
 let cursor=root;
 for(const segment of result.slice(root.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,segment);
  if(exists(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error(`${label} contains a link`);
 }
 return result;
}
function paths(options){
 const install=directory(options.installDir,'Install directory'),data=directory(options.dataDir,'Data directory');
 if(install===data||inside(install,data)||inside(data,install))throw Error('Application and data directories must be separate');
 return {install,data};
}
function file(root,name){if(!owned.has(name))throw Error('Not an owned version directory');return path.join(root,name);}
function readMarker(install){
 const target=path.join(install,marker);if(!exists(target))return null;
 const value=JSON.parse(fs.readFileSync(target,'utf8'));
 if(value?.product!=='Rayloom'||value.schemaVersion!==1||typeof value.installId!=='string'||!value.installId||typeof value.dataDir!=='string')throw Error('Invalid Rayloom installation marker');
 if(directory(value.dataDir,'Recorded data directory')!==value.dataDir)throw Error('Invalid recorded data directory');
 return value;
}
function writeAtomic(target,value){
 const temporary=target+'.'+randomUUID()+'.tmp';
 fs.writeFileSync(temporary,value,{flag:'wx'});
 try{fs.renameSync(temporary,target);}finally{if(exists(temporary))fs.unlinkSync(temporary);}
}
function assertOwnedTree(target){
 const stat=fs.lstatSync(target);if(stat.isSymbolicLink())throw Error('Installation contains a link');
 if(stat.isDirectory())for(const name of fs.readdirSync(target))assertOwnedTree(path.join(target,name));
 else if(!stat.isFile())throw Error('Installation contains a special file');
}
function removeVersion(install,name){
 const target=file(install,name);if(!exists(target))return;
 assertOwnedTree(target);fs.rmSync(target,{recursive:true});
}
function ensureStopped(data){
 const descriptor=path.join(data,'runtime.json');if(!exists(descriptor))return;
 let pid;try{pid=JSON.parse(fs.readFileSync(descriptor,'utf8')).pid;}catch{throw Error('Unreadable runtime descriptor; stop Rayloom before changing files');}
 if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);throw Error('Rayloom is running. Stop the background engine before updating or removing it.');}catch(error){if(error.code==='ESRCH')return;throw error;}}
 throw Error('Unknown runtime owner; stop Rayloom before changing files');
}
const profileEntries=['app-settings.json','scene.json','playback-hardware.json','playback-virtual.json','hardware','virtual','scenes','presets','native','native-hardware','native-virtual'];
function copyProfile(source,data,id){
 if(!source)return false;
 source=directory(source,'Source profile');
 if(source===data||inside(source,data)||inside(data,source))throw Error('Profile source and destination overlap');
 if(!exists(path.join(source,'hardware','studio','layout.json')))throw Error('Source has no hardware layout');
 ensureStopped(source);
 if(exists(data)&&fs.readdirSync(data).length)throw Error('Selected data directory is not empty');
 const stage=data+'.rayloom-next-'+randomUUID();
 if(exists(stage))throw Error('Profile stage already exists');
 fs.mkdirSync(stage,{recursive:true});let moved=false;
 try{
  let count=0,total=0;
  const transfer=(relative)=>{
   const input=path.join(source,relative);if(!exists(input))return;
   const stat=fs.lstatSync(input);if(stat.isSymbolicLink())throw Error('Profile contains a link: '+relative);
   if(stat.isDirectory()){for(const name of fs.readdirSync(input))transfer(path.join(relative,name));return;}
   if(!stat.isFile()||stat.size>20*1024*1024||++count>10000||(total+=stat.size)>512*1024*1024)throw Error('Profile exceeds migration limits');
   const bytes=fs.readFileSync(input),target=path.join(stage,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});
   if(createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw Error('Profile copy mismatch');
  };
  for(const entry of profileEntries)transfer(entry);
  const settings=path.join(stage,'app-settings.json');
  if(exists(settings)){const value=JSON.parse(fs.readFileSync(settings,'utf8'));writeAtomic(settings,JSON.stringify({...value,autoStart:false,elevatedStartup:false,startupTaskName:null},null,2));}
  fs.writeFileSync(path.join(stage,profileMarker),JSON.stringify({schemaVersion:1,product:'Rayloom',installId:id,source,createdAt:new Date().toISOString()})+'\n',{flag:'wx'});
  if(exists(data)){if(fs.readdirSync(data).length)throw Error('Selected data directory changed during migration');fs.rmdirSync(data);}
  fs.renameSync(stage,data);moved=true;return true;
 }finally{if(!moved&&exists(stage)){assertOwnedTree(stage);fs.rmSync(stage,{recursive:true});}}
}
function copyRelease(packageDir,stage){
 verifyPackage(packageDir);
 if(exists(stage))throw Error('Unfinished release stage exists');
 try{fs.cpSync(packageDir,stage,{recursive:true,errorOnExist:true,force:false});verifyPackage(stage);}
 catch(error){if(exists(stage)){assertOwnedTree(stage);fs.rmSync(stage,{recursive:true});}throw error;}
}
function checkInstall(install,data,required=true){
 const state=readMarker(install);
 if(!state){if(required)throw Error('Rayloom is not installed here');return null;}
 if(state.dataDir!==data)throw Error('Data directory differs from the installed profile');
 for(const name of ['.next','.retired','.swap'])if(exists(file(install,name)))throw Error('Unfinished installation transaction: '+name);
 verifyPackage(file(install,'current'));
 if(exists(file(install,'previous')))verifyPackage(file(install,'previous'));
 return state;
}
function publish(install,packageDir,state){
 const stage=file(install,'.next'),current=file(install,'current'),previous=file(install,'previous'),retired=file(install,'.retired');
 copyRelease(packageDir,stage);
 const release=JSON.parse(fs.readFileSync(path.join(stage,'release.json'),'utf8'));
 let oldPrevious=false,oldCurrent=false,newCurrent=false,committed=false;
 try{
  if(exists(previous)){fs.renameSync(previous,retired);oldPrevious=true;}
  if(exists(current)){fs.renameSync(current,previous);oldCurrent=true;}
  fs.renameSync(stage,current);newCurrent=true;
  writeAtomic(path.join(install,marker),JSON.stringify({...state,version:release.version,updatedAt:new Date().toISOString()},null,2)+'\n');committed=true;
 }catch(error){
  const failures=[];const attempt=fn=>{try{fn();}catch(failure){failures.push(failure);}};
  if(newCurrent)attempt(()=>fs.renameSync(current,stage));
  if(oldCurrent)attempt(()=>fs.renameSync(previous,current));
  if(oldPrevious)attempt(()=>fs.renameSync(retired,previous));
  if(!failures.length&&exists(stage))attempt(()=>removeVersion(install,'.next'));
  if(failures.length)throw new AggregateError([error,...failures],'Installation rollback is incomplete');
  throw error;
 }
 if(committed&&oldPrevious)removeVersion(install,'.retired');
 return {version:release.version,current,previous:oldCurrent?previous:null};
}
export function installRelease({packageDir,installDir,dataDir,sourceProfile}={}){
 const {install,data}=paths({installDir,dataDir}),source=directory(packageDir,'Package directory');
 if(source===install||inside(source,install)||inside(install,source)||source===data||inside(source,data)||inside(data,source))throw Error('Package, application and data paths must be separate');
 verifyPackage(source);
 const prior=readMarker(install);
 if(prior){if(sourceProfile)throw Error('Profile source applies only to a first installation');ensureStopped(data);checkInstall(install,data);return {operation:'update',...publish(install,source,prior)};}
 if(exists(install)&&fs.readdirSync(install).length)throw Error('Install directory is not empty');
 fs.mkdirSync(install,{recursive:true});
 const state={schemaVersion:1,product:'Rayloom',installId:randomUUID(),dataDir:data,createdAt:new Date().toISOString()};
 const migrated=copyProfile(sourceProfile,data,state.installId);
 if(!migrated){
  if(exists(data)&&fs.readdirSync(data).length){
   const marked=path.join(data,profileMarker),known=exists(marked)||exists(path.join(data,'app-settings.json'))||exists(path.join(data,'hardware','studio','layout.json'));
   if(!known)throw Error('Selected data directory is not an existing Rayloom profile');
   ensureStopped(data);assertOwnedTree(data);
   if(exists(marked)&&JSON.parse(fs.readFileSync(marked,'utf8')).product!=='Rayloom')throw Error('Selected profile belongs to another application');
   writeAtomic(marked,JSON.stringify({schemaVersion:1,product:'Rayloom',installId:state.installId,reusedAt:new Date().toISOString()})+'\n');
  }else{
   fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,profileMarker),JSON.stringify({schemaVersion:1,product:'Rayloom',installId:state.installId,createdAt:new Date().toISOString()})+'\n',{flag:'wx'});
  }
 }
 try{
  writeAtomic(path.join(install,'profile-path.txt'),data+'\n');
  const result=publish(install,source,state);
  return {operation:'install',migrated,...result};
 }catch(error){
  // Keep the imported profile for recovery. Remove only an unpublished pointer.
  if(!exists(path.join(install,marker))&&exists(path.join(install,'profile-path.txt')))fs.unlinkSync(path.join(install,'profile-path.txt'));
  throw error;
 }
}
export function rollbackRelease({installDir,dataDir}={}){
 const {install,data}=paths({installDir,dataDir});ensureStopped(data);const state=checkInstall(install,data);
 const current=file(install,'current'),previous=file(install,'previous'),swap=file(install,'.swap');
 if(!exists(previous))throw Error('There is no previous version to restore');
 let a=false,b=false,c=false;
 try{fs.renameSync(current,swap);a=true;fs.renameSync(previous,current);b=true;fs.renameSync(swap,previous);c=true;
  const release=JSON.parse(fs.readFileSync(path.join(current,'release.json'),'utf8'));
  writeAtomic(path.join(install,marker),JSON.stringify({...state,version:release.version,updatedAt:new Date().toISOString()},null,2)+'\n');
  return {operation:'rollback',version:release.version,current};
 }catch(error){
  if(c){fs.renameSync(current,swap);fs.renameSync(previous,current);fs.renameSync(swap,previous);}
  else if(b){fs.renameSync(current,previous);fs.renameSync(swap,current);}
  else if(a)fs.renameSync(swap,current);
  throw error;
 }
}
export function uninstallRelease({installDir,dataDir,deleteData=false}={}){
 const {install,data}=paths({installDir,dataDir});ensureStopped(data);const state=checkInstall(install,data);
 if(deleteData){const profile=path.join(data,profileMarker),value=exists(profile)?JSON.parse(fs.readFileSync(profile,'utf8')):null;
  if(value?.product!=='Rayloom'||value.installId!==state.installId)throw Error('Profile was not created by this installation');
  assertOwnedTree(data);
 }
 removeVersion(install,'previous');removeVersion(install,'current');
 for(const name of [marker,'profile-path.txt']){const target=path.join(install,name);if(exists(target))fs.unlinkSync(target);}
 if(deleteData)fs.rmSync(data,{recursive:true});
 return {operation:'uninstall',dataPreserved:!deleteData};
}
export function checkUninstall({installDir,dataDir}={}){
 const {install,data}=paths({installDir,dataDir});ensureStopped(data);const state=checkInstall(install,data);
 return {operation:'check-uninstall',version:state.version};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1]};
 try{
  const options={packageDir:get('--package'),installDir:get('--install'),dataDir:get('--data'),sourceProfile:get('--source-profile'),deleteData:args.includes('--delete-data')};
  const operation=get('--operation');
  const result=operation==='install'?installRelease(options):operation==='rollback'?rollbackRelease(options):operation==='uninstall'?uninstallRelease(options):operation==='check-uninstall'?checkUninstall(options):null;
  if(!result)throw Error('Unknown install operation');console.log(JSON.stringify({ok:true,...result}));
 }catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
