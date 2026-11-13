// One-time migration of the two verified October 29 renderer builds.
// Default: read-only plan. --apply snapshots the previous renderer and removes
// only asset files that belong to neither completed build.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const digest=data=>createHash('sha256').update(data).digest('hex');
const logs={current:'artifacts/mantine-device-ports-build-2026-10-29.log',previous:'artifacts/mantine-device-layouts-build-2026-10-29.log'};
const family=file=>path.posix.basename(file).replace(/-[A-Za-z0-9_-]{8}(\.[^.]+)$/,'$1');

export function bootstrapRendererRetention(workspace,{apply=false}={}){
  const root=fs.realpathSync(workspace);
  const inside=relative=>{
    if(typeof relative!=='string'||!relative||relative.includes('\\')||path.isAbsolute(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..')||relative.includes(':'))throw Error('Unsafe relative path');
    const target=path.resolve(root,...relative.split('/'));
    if(!target.startsWith(root+path.sep))throw Error('Target outside workspace');
    let cursor=root;
    for(const segment of relative.split('/')){
      cursor=path.join(cursor,segment);
      try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Refusing a symlink or junction: '+relative);}catch(reason){if(reason.code!=='ENOENT')throw reason;}
    }
    return target;
  };
  const read=relative=>fs.readFileSync(inside(relative));
  const walk=relative=>{
    const result=[];
    for(const item of fs.readdirSync(inside(relative),{withFileTypes:true})){
      const child=relative+'/'+item.name;inside(child);
      if(item.isSymbolicLink())throw Error('Refusing a symlink: '+child);
      if(item.isDirectory())result.push(...walk(child));else if(item.isFile())result.push(child);else throw Error('Not a regular file: '+child);
    }
    return result;
  };
  const list=log=>{
    const text=read(log).toString('utf8');
    if(!/built in \d/.test(text))throw Error('Build log does not confirm completion: '+log);
    const files=[...new Set([...text.matchAll(/dist\/(assets\/[^\s]+\.(?:js|css|woff2?|ttf|svg|png|wasm))\s/g)].map(match=>match[1]))];
    if(!files.length)throw Error('No asset list in '+log);
    for(const file of files)read('dist/'+file);
    return files;
  };
  const currentAssets=list(logs.current),previousAssets=list(logs.previous),keep=new Set([...currentAssets,...previousAssets]);
  const publicFiles=walk('public').map(file=>file.slice('public/'.length));
  for(const file of publicFiles)if(!read('public/'+file).equals(read('dist/'+file)))throw Error('Public file differs from deployed renderer: '+file);
  const entries=['index.html','legacy.html'],previousEntries=new Map();
  for(const entry of entries){
    const current=read('dist/'+entry).toString('utf8');
    const previous=current.replace(/\.\/assets\/([^"'\s<>]+)/g,(reference,filename)=>{
      const asset='assets/'+filename;
      if(!currentAssets.includes(asset))throw Error('Current HTML references an unlisted asset: '+asset);
      const matches=previousAssets.filter(file=>family(file)===family(asset));
      if(matches.length!==1)throw Error('Ambiguous previous entry asset: '+asset);
      return './'+matches[0];
    });
    previousEntries.set(entry,Buffer.from(previous));
  }
  const info=(file,data)=>({path:file,sha256:digest(data),size:data.length});
  const record=(id,assets,entryData)=>({id,files:[...entries,...assets,...publicFiles].sort().map(file=>info(file,entryData?.get(file)??read('dist/'+file)))});
  const state={schemaVersion:1,current:record('2026-10-29-device-ports',currentAssets),previous:record('2026-10-29-device-layouts',previousAssets,previousEntries)};
  const removed=walk('dist/assets').map(file=>file.slice('dist/'.length)).filter(file=>!keep.has(file)).map(file=>info(file,read('dist/'+file)));
  const result={currentAssets:currentAssets.length,previousAssets:previousAssets.length,retainedAssets:keep.size,removeFiles:removed.length,removeBytes:removed.reduce((sum,file)=>sum+file.size,0),files:removed.map(file=>file.path)};
  if(!apply)return result;
  const history='build-history',previousDir=history+'/previous-renderer',staging=history+'/.bootstrap-previous',stateFile=history+'/renderer-retention.json';
  for(const candidate of [previousDir,staging,stateFile,stateFile+'.tmp'])if(fs.existsSync(inside(candidate)))throw Error('Bootstrap target already exists: '+candidate);
  fs.mkdirSync(inside(history),{recursive:true});fs.mkdirSync(inside(staging));
  // Verify every current/previous file before creating the snapshot or deleting.
  for(const release of [state.current,state.previous])for(const file of release.files){const data=release===state.previous&&previousEntries.has(file.path)?previousEntries.get(file.path):read('dist/'+file.path);if(digest(data)!==file.sha256)throw Error('Renderer changed while planning');}
  for(const file of state.previous.files){
    const target=inside(staging+'/'+file.path);fs.mkdirSync(path.dirname(target),{recursive:true});
    if(/^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[^/]+$/.test(file.path)){
      // Content-hashed assets are immutable. Share their disk blocks with the
      // retained live asset; HTML/public files remain independent snapshots.
      try{fs.linkSync(inside('dist/'+file.path),target);}catch(reason){if(!['EXDEV','EPERM','ENOTSUP','EACCES'].includes(reason.code))throw reason;fs.copyFileSync(inside('dist/'+file.path),target);}
    }else fs.writeFileSync(target,previousEntries.get(file.path)??read('dist/'+file.path));
  }
  for(const file of state.previous.files)if(digest(read(staging+'/'+file.path))!==file.sha256)throw Error('Previous snapshot verification failed');
  fs.renameSync(inside(staging),inside(previousDir));
  fs.writeFileSync(inside(stateFile+'.tmp'),JSON.stringify(state,null,2)+'\n');fs.renameSync(inside(stateFile+'.tmp'),inside(stateFile));
  for(const file of removed){const target=inside('dist/'+file.path);if(digest(fs.readFileSync(target))!==file.sha256)throw Error('Stale file changed before removal');fs.unlinkSync(target);}
  fs.writeFileSync(inside(history+'/bootstrap-receipt.json'),JSON.stringify({...result,appliedAt:new Date().toISOString(),previousHtml:'reconstructed from unchanged HTML sources and the verified previous build asset list'},null,2)+'\n');
  return {...result,applied:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Usage: node scripts/bootstrap-renderer-retention.mjs [--apply]');
  console.log(JSON.stringify(bootstrapRendererRetention(fileURLToPath(new URL('..',import.meta.url)),{apply:process.argv.includes('--apply')}),null,2));
}
