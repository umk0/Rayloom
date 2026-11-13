// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const repo='umk0/Rayloom';
const latestUrl=`https://api.github.com/repos/${repo}/releases/latest`;
const releasesUrl=`https://api.github.com/repos/${repo}/releases?per_page=20`;
const versionPattern=/^\d+\.\d+\.\d+$/;
export function compareVersions(left,right){
 if(!versionPattern.test(left)||!versionPattern.test(right))throw Error('Invalid release version');
 const a=left.split('.').map(Number),b=right.split('.').map(Number);
 for(let i=0;i<3;i++)if(a[i]!==b[i])return Math.sign(a[i]-b[i]);
 return 0;
}
async function checkedFetch(url,fetcher,timeout=30000){
 const response=await fetcher(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'Rayloom-Updater'},signal:AbortSignal.timeout(timeout)});
 if(response.status===404)return null;
 if(!response.ok)throw Error(`GitHub returned ${response.status}`);
 return response;
}
export class UpdateService{
 constructor({version,dataDir,fetcher=fetch}={}){if(!versionPattern.test(version))throw Error('Invalid current version');this.version=version;this.dataDir=dataDir;this.fetcher=fetcher;this.available=null;this.downloaded=null;}
 async check(){
  const response=await checkedFetch(latestUrl,this.fetcher);
  let release;
  if(response)release=await response.json();
  else{
   const listing=await checkedFetch(releasesUrl,this.fetcher);
   const releases=listing?await listing.json():[];
   if(!Array.isArray(releases))throw Error('Unexpected GitHub releases response');
   release=releases.filter(item=>!item.draft&&versionPattern.test(String(item.tag_name||'').replace(/^v/,''))).sort((a,b)=>compareVersions(String(b.tag_name).replace(/^v/,''),String(a.tag_name).replace(/^v/,'')))[0];
   if(!release){this.available=null;return {status:'no-release',current:this.version};}
  }
  const version=String(release.tag_name||'').replace(/^v/,'');
  if(!versionPattern.test(version))throw Error('Unexpected release tag');
  if(compareVersions(version,this.version)<=0){this.available=null;return {status:'current',current:this.version,latest:version};}
  const name=`Rayloom-Setup-${version}.exe`,checksumName=name+'.sha256';
  const assets=[release.assets?.find(asset=>asset.name===name),release.assets?.find(asset=>asset.name===checksumName)];
  if(assets.some(asset=>!asset))throw Error('The latest release has no verified Windows installer');
  const prefix=`https://github.com/${repo}/releases/download/`;
  if(assets.some(asset=>typeof asset.browser_download_url!=='string'||!asset.browser_download_url.startsWith(prefix)))throw Error('Unexpected release asset URL');
  this.available={version,name,url:assets[0].browser_download_url,checksumUrl:assets[1].browser_download_url,size:assets[0].size};
  return {status:'available',current:this.version,latest:version,size:assets[0].size};
 }
 async download(){
  if(!this.available)throw Error('Check for updates first');
  const update=this.available,dir=path.join(this.dataDir,'updates');fs.mkdirSync(dir,{recursive:true});
  const destination=path.join(dir,update.name),temporary=destination+'.partial';
  const checksumResponse=await checkedFetch(update.checksumUrl,this.fetcher);
  if(!checksumResponse)throw Error('Release checksum is missing');
  const checksum=(await checksumResponse.text()).trim().match(/^([a-f\d]{64})(?:\s+\*?[^\s]+)?$/i)?.[1]?.toLowerCase();
  if(!checksum)throw Error('Invalid release checksum');
  const response=await checkedFetch(update.url,this.fetcher,10*60*1000);if(!response||!response.body)throw Error('Installer asset is missing');
  const maximum=750*1024*1024;
  if(update.size>maximum)throw Error('Installer asset is too large');
  if(fs.existsSync(temporary)){if(!fs.lstatSync(temporary).isFile())throw Error('Update staging path is unsafe');fs.unlinkSync(temporary);}
  const output=fs.createWriteStream(temporary,{flags:'wx'}),hash=createHash('sha256');let count=0;
  try{
   for await(const chunk of response.body){count+=chunk.length;if(count>maximum)throw Error('Installer download exceeds the size limit');hash.update(chunk);if(!output.write(chunk))await new Promise(resolve=>output.once('drain',resolve));}
   await new Promise((resolve,reject)=>output.end(error=>error?reject(error):resolve()));
   if(update.size&&count!==update.size)throw Error('Installer size mismatch');
   if(hash.digest('hex')!==checksum)throw Error('Installer checksum mismatch');
   fs.renameSync(temporary,destination);this.downloaded={...update,path:destination,checksum};
   return {status:'downloaded',version:update.version,size:count};
  }catch(error){output.destroy();if(fs.existsSync(temporary))fs.unlinkSync(temporary);throw error;}
 }
 installedPath(){
  if(!this.downloaded)throw Error('Download the update first');
  const hash=createHash('sha256'),handle=fs.openSync(this.downloaded.path,'r'),buffer=Buffer.allocUnsafe(1024*1024);
  try{while(true){const length=fs.readSync(handle,buffer,0,buffer.length,null);if(!length)break;hash.update(buffer.subarray(0,length));}}finally{fs.closeSync(handle);}
  if(hash.digest('hex')!==this.downloaded.checksum)throw Error('Downloaded installer changed');
  return this.downloaded.path;
 }
}
