// SPDX-License-Identifier: GPL-2.0-or-later
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runRendererBuild} from '../shared/build-retention.mjs';

const execute=promisify(execFile);
async function typecheck(root){
 try{
  const result=await execute(process.execPath,[path.join(root,'node_modules','typescript','bin','tsc'),'--noEmit'],{cwd:root,maxBuffer:16*1024*1024});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
 }catch(error){if(error.stdout)process.stdout.write(error.stdout);if(error.stderr)process.stderr.write(error.stderr);throw error;}
}
async function bundle(root,outDir){
 const {build}=await import('vite');const previousDirectory=process.cwd();
 try{
  // The existing Vite config resolves its entry paths relative to cwd.
  process.chdir(root);
  await build({root,configFile:path.join(root,'vite.config.ts'),build:{outDir,emptyOutDir:true}});
 }finally{process.chdir(previousDirectory);}
}

export function buildRenderer(root,{check=typecheck,build=bundle,...options}={}){
 return runRendererBuild(root,async outDir=>{await check(root);await build(root,outDir);},options);
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 // Historical callers append this Vite flag. Retention owns output cleanup now;
 // accept only this known pair rather than forwarding arbitrary CLI overrides.
 const args=process.argv.slice(2);
 if(args.length&&JSON.stringify(args)!==JSON.stringify(['--emptyOutDir','false'])){
  console.error('Usage: node scripts/build-renderer.mjs [--emptyOutDir false]');process.exitCode=1;
 }else{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  try{const result=await buildRenderer(root);console.log(result.status==='unchanged'?'Renderer unchanged; previous build preserved.':'Renderer published; current and one previous build retained.');for(const warning of result.warnings)console.warn(warning);}
  catch(error){console.error(error.stack??error.message);process.exitCode=1;}
 }
}
