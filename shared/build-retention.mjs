// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const HISTORY='build-history';
export const rendererPaths=Object.freeze({
 current:'dist',stage:`${HISTORY}/.renderer-next`,previous:`${HISTORY}/previous-renderer`,
 state:`${HISTORY}/renderer-retention.json`,lock:`${HISTORY}/.renderer-build.lock`,
 currentBackup:`${HISTORY}/.renderer-current-backup`,previousNext:`${HISTORY}/.previous-renderer-next`,
 previousBackup:`${HISTORY}/.previous-renderer-backup`,stateNext:`${HISTORY}/.renderer-retention-next.json`,
});
const scratch=new Set([rendererPaths.stage,rendererPaths.currentBackup,rendererPaths.previousNext,rendererPaths.previousBackup,rendererPaths.stateNext]);
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
const exists=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

function relativePath(value){
 if(typeof value!=='string'||!value||value.length>1000||path.posix.isAbsolute(value)||/[\\\0<>:"|?*]/.test(value))throw Error('Unsafe renderer relative path');
 const parts=value.split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'||/[ .]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw Error('Unsafe renderer relative path');
 return value;
}

function noSymlinkAncestors(absolute){
 const parsed=path.parse(absolute);let cursor=parsed.root;
 for(const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,segment);
  try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error(`Renderer retention refuses symlink: ${cursor}`);}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
}

function rootPath(projectRoot){
 const root=path.resolve(projectRoot);noSymlinkAncestors(root);
 if(!fs.statSync(root).isDirectory())throw Error('Renderer project root must be a directory');
 return root;
}

function checkedPath(root,relative){
 relativePath(relative);const absolute=path.resolve(root,...relative.split('/')),inside=path.relative(root,absolute);
 if(!inside||inside.startsWith(`..${path.sep}`)||inside==='..'||path.isAbsolute(inside))throw Error('Renderer path escapes project root');
 noSymlinkAncestors(absolute);return absolute;
}

function assertSafeTree(root,relative){
 const absolute=checkedPath(root,relative);if(!exists(absolute))return;
 const stat=fs.lstatSync(absolute);
 if(stat.isDirectory())for(const name of fs.readdirSync(absolute))assertSafeTree(root,`${relative}/${name}`);
 else if(!stat.isFile())throw Error(`Unsupported renderer file: ${relative}`);
}

// Only fixed build-owned scratch paths may ever be recursively removed.
function removeScratch(root,relative){
 if(!scratch.has(relative))throw Error('Not a renderer scratch path');
 assertSafeTree(root,relative);const absolute=checkedPath(root,relative);
 fs.rmSync(absolute,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}

function move(root,from,to){
 assertSafeTree(root,from);const source=checkedPath(root,from),destination=checkedPath(root,to);
 if(exists(destination))throw Error(`Renderer move destination already exists: ${to}`);
 fs.renameSync(source,destination);
}

/** File manifests use portable relative paths, never identifiers containing paths. */
function manifest(value){
 if(!value||typeof value.id!=='string'||!value.id.trim()||value.id.length>200||!Array.isArray(value.files)||!value.files.length)throw Error('Invalid renderer manifest');
 const seen=new Set();const files=value.files.map(file=>{
  const name=relativePath(file?.path),key=name.toLowerCase();
  if(seen.has(key)||!Number.isSafeInteger(file.size)||file.size<0||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error(`Invalid renderer file manifest: ${name}`);
  seen.add(key);return {path:name,sha256:file.sha256,size:file.size};
 }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 if(!seen.has('index.html'))throw Error('Renderer manifest has no index.html');
 return {id:value.id,files};
}

export function validateRendererState(value){
 if(value?.schemaVersion!==1||!Object.hasOwn(value,'previous'))throw Error('Invalid renderer retention state');
 return {schemaVersion:1,current:manifest(value.current),previous:value.previous===null?null:manifest(value.previous)};
}

function readState(root){
 const file=checkedPath(root,rendererPaths.state);
 if(!exists(file))return null;
 if(!fs.statSync(file).isFile()||fs.statSync(file).size>16*1024*1024)throw Error('Invalid renderer retention state file');
 return validateRendererState(JSON.parse(fs.readFileSync(file,'utf8')));
}

export function scanRendererFiles(projectRoot,relativeDir='dist'){
 const root=rootPath(projectRoot),base=checkedPath(root,relativeDir),files=[];
 if(!fs.statSync(base).isDirectory())throw Error('Renderer output must be a directory');
 const walk=relative=>{
  const directory=checkedPath(root,relative?`${relativeDir}/${relative}`:relativeDir);
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const name=relative?`${relative}/${entry.name}`:entry.name,file=checkedPath(root,`${relativeDir}/${name}`),stat=fs.lstatSync(file);
   if(stat.isDirectory())walk(name);
   else if(stat.isFile()){const content=fs.readFileSync(file);files.push({path:name,sha256:sha256(content),size:content.length});}
   else throw Error(`Unsupported renderer file: ${name}`);
  }
 };
 walk('');return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}

function verifyFiles(root,directory,files){
 for(const expected of files){
  const name=`${directory}/${expected.path}`,file=checkedPath(root,name);
  if(!exists(file)||!fs.statSync(file).isFile())throw Error(`Renderer file is missing: ${name}`);
  const content=fs.readFileSync(file);
  if(content.length!==expected.size||sha256(content)!==expected.sha256)throw Error(`Renderer file hash mismatch: ${name}`);
 }
}

function copyFile(root,from,to,relative){
 const source=checkedPath(root,`${from}/${relative}`),destination=checkedPath(root,`${to}/${relative}`);
 fs.mkdirSync(checkedPath(root,path.posix.dirname(`${to}/${relative}`)),{recursive:true});
 if(exists(destination))throw Error(`Renderer copy destination already exists: ${to}/${relative}`);
 // Vite assets are immutable after publication. Renames never modify their
 // contents; hard links save space while public files remain independent copies.
 if(relative.startsWith('assets/')&&/-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(path.posix.basename(relative))){
  try{fs.linkSync(source,destination);return;}catch(error){if(exists(destination))throw error;}
 }
 fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
}

function preflight(root,{allowStage=false}={}){
 const state=readState(root);assertSafeTree(root,rendererPaths.current);
 if(state)verifyFiles(root,rendererPaths.current,state.current.files);
 else{
  const current=checkedPath(root,rendererPaths.current);
  if(exists(current)&&(!fs.statSync(current).isDirectory()||fs.readdirSync(current).length))throw Error('Renderer retention state is missing for an existing dist. Initialize its manifest before replacing it.');
  if(!allowStage&&exists(checkedPath(root,rendererPaths.stage)))throw Error('Untracked renderer staging directory; recover it before the first build.');
 }
 if(state?.previous){assertSafeTree(root,rendererPaths.previous);verifyFiles(root,rendererPaths.previous,state.previous.files);}
 else if(exists(checkedPath(root,rendererPaths.previous)))throw Error('Untracked previous renderer directory; refusing to overwrite it');
 for(const relative of [rendererPaths.currentBackup,rendererPaths.previousNext,rendererPaths.previousBackup,rendererPaths.stateNext]){
  if(exists(checkedPath(root,relative)))throw Error(`Unfinished renderer transaction: ${relative}. Recover it before building again.`);
 }
 return state;
}

async function locked(projectRoot,callback){
 const root=rootPath(projectRoot);fs.mkdirSync(checkedPath(root,HISTORY),{recursive:true});
 const lock=checkedPath(root,rendererPaths.lock);let descriptor;
 try{descriptor=fs.openSync(lock,'wx');}catch(error){if(error.code==='EEXIST')throw Error('Another renderer build is in progress (build-history/.renderer-build.lock).');throw error;}
 try{fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,started:new Date().toISOString()}));return await callback(root);}
 finally{fs.closeSync(descriptor);fs.unlinkSync(checkedPath(root,rendererPaths.lock));}
}

function publish(root,{id=new Date().toISOString(),fault=()=>{}}={}){
 const state=preflight(root,{allowStage:true}),files=scanRendererFiles(root,rendererPaths.stage),current=manifest({id,files});
 if(state&&JSON.stringify(current.files)===JSON.stringify(state.current.files)){
  removeScratch(root,rendererPaths.stage);return {status:'unchanged',state,warnings:[]};
 }
 const next={schemaVersion:1,current,previous:state?.current??null};
 let movedCurrent=false,publishedCurrent=false,movedPrevious=false,publishedPrevious=false,committed=false;
 try{
  if(state){
   fs.mkdirSync(checkedPath(root,rendererPaths.previousNext));
   for(const file of state.current.files)copyFile(root,rendererPaths.current,rendererPaths.previousNext,file.path);
   verifyFiles(root,rendererPaths.previousNext,state.current.files);
   const newPaths=new Set(files.map(file=>file.path));
   for(const file of state.current.files)if(file.path.startsWith('assets/')&&!newPaths.has(file.path))copyFile(root,rendererPaths.current,rendererPaths.stage,file.path);
  }
  verifyFiles(root,rendererPaths.stage,current.files);
  // Recheck the original after potentially slow copy operations, before moving
  // any published directory. A manual edit must fail closed, not be archived.
  if(state)verifyFiles(root,rendererPaths.current,state.current.files);
  fault('before-current-move');
  if(exists(checkedPath(root,rendererPaths.current))){move(root,rendererPaths.current,rendererPaths.currentBackup);movedCurrent=true;}
  fault('after-current-move');move(root,rendererPaths.stage,rendererPaths.current);publishedCurrent=true;
  fault('after-current-publish');
  if(state?.previous){move(root,rendererPaths.previous,rendererPaths.previousBackup);movedPrevious=true;}
  fault('after-previous-move');
  if(state){move(root,rendererPaths.previousNext,rendererPaths.previous);publishedPrevious=true;}
  fault('after-previous-publish');
  fs.writeFileSync(checkedPath(root,rendererPaths.stateNext),JSON.stringify(next,null,2)+'\n',{flag:'wx'});
  fault('before-state-publish');
  fs.renameSync(checkedPath(root,rendererPaths.stateNext),checkedPath(root,rendererPaths.state));committed=true;
 }catch(error){
  const failures=[];const attempt=fn=>{try{fn();}catch(failure){failures.push(failure);}};
  if(publishedPrevious)attempt(()=>move(root,rendererPaths.previous,rendererPaths.previousNext));
  if(movedPrevious)attempt(()=>move(root,rendererPaths.previousBackup,rendererPaths.previous));
  if(publishedCurrent)attempt(()=>move(root,rendererPaths.current,rendererPaths.stage));
  if(movedCurrent)attempt(()=>move(root,rendererPaths.currentBackup,rendererPaths.current));
  if(!failures.length)for(const relative of [rendererPaths.previousNext,rendererPaths.stateNext,rendererPaths.stage])attempt(()=>removeScratch(root,relative));
  if(failures.length)throw new AggregateError([error,...failures],'Renderer publish failed; rollback is incomplete. Keep build-history scratch directories for recovery.');
  throw error;
 }
 const warnings=[];
 if(committed)for(const relative of [rendererPaths.currentBackup,rendererPaths.previousBackup])try{removeScratch(root,relative);}catch(error){warnings.push(`Published successfully; cleanup failed for ${relative}: ${error.message}`);}
 return {status:'published',state:next,warnings};
}

/** Publish an already-built .renderer-next directory; useful for recovery/tests. */
export function publishRendererBuild(projectRoot,options={}){
 return locked(projectRoot,root=>publish(root,options));
}

/** Build in isolation. Generator failures can never replace the current dist. */
export function runRendererBuild(projectRoot,generate,options={}){
 if(typeof generate!=='function')throw Error('Renderer generator is required');
 return locked(projectRoot,async root=>{
  preflight(root);removeScratch(root,rendererPaths.stage);fs.mkdirSync(checkedPath(root,rendererPaths.stage));
  try{await generate(checkedPath(root,rendererPaths.stage));return publish(root,options);}
  catch(error){
   // Incomplete rollback needs every remaining file for manual recovery.
   if(!(error instanceof AggregateError))try{removeScratch(root,rendererPaths.stage);}catch(cleanup){throw new AggregateError([error,cleanup],'Renderer build failed; staging cleanup also failed.');}
   throw error;
  }
 });
}
