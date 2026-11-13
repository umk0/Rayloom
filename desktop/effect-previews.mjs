import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CoreClient} from './core-client.mjs';
import {nativeEffectSettings} from '../shared/native-effect-config.mjs';
import {normalizeEffectParameterMap} from '../shared/effect-parameters.mjs';

// Owned by the editor process, never by the elevated lighting agent. The worker
// has its own empty profile, --nodetect, one bundled plugin and a private fixture.
export class NativeEffectPreviews {
 constructor(root,{idleMs=5000,Core=CoreClient}={}) {
  this.root=root;this.Core=Core;this.idleMs=Math.max(100,Math.min(idleMs,14000));
  this.chain=Promise.resolve();this.pending=0;this.cache=new Map();this.closed=false;
  this.version=createHash('sha256').update(fs.readFileSync(path.join(root,'plugins','effects','release','OpenRGBEffectsPlugin.dll'))).digest('hex');
 }
 enqueue(fn) {
  if(this.closed)return Promise.reject(Error('Effect previews are closed'));
  if(this.pending>=8)return Promise.reject(Error('Effect preview request queue is full'));
  ++this.pending;clearTimeout(this.idleTimer);
  const work=this.chain.then(fn);this.chain=work.catch(()=>{}).finally(()=>{
   --this.pending;
   if(!this.pending&&!this.closed&&this.core){this.idleTimer=setTimeout(()=>{void this.enqueue(()=>this.release()).catch(()=>{});},this.idleMs);this.idleTimer.unref?.();}
  });
  return work;
 }
 async ensureWorker() {
  if(this.core&&!this.core.exited)return;
  await this.release();
  this.runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-preview-'));
  this.core=new this.Core(this.root,this.runtime,{virtual:true,allPlugins:false,preview:true});
  try{
   const status=await this.core.start();
   if(status.virtual!==true)throw Error('Preview worker must be virtual');
   this.catalog=await this.rpc('catalog');
  }catch(error){await this.release();throw error;}
 }
 rpc(method,params={}){return this.core.call('plugin.rpc',{plugin:'org.openrgb.openrgbeffectsplugin',request:{method,...params}});}
 frame(request={}) {
  if(this.closed)return Promise.reject(Error('Effect previews are closed'));
  const {effectId,color=0xffffff,speed=1,animate=true}=request;
  let effectParameters;try{effectParameters=normalizeEffectParameterMap(request.effectParameters??{});}catch(error){return Promise.reject(error);}
  if(typeof effectId!=='string'||!/^[A-Za-z][A-Za-z0-9]{0,80}$/.test(effectId))return Promise.reject(Error('Invalid native preview effect'));
  if(typeof animate!=='boolean')return Promise.reject(Error('Invalid native preview animation flag'));
  // Validate before starting a process, even for malformed or unknown IDs.
  try{nativeEffectSettings({defaults:{}},{color,speed,fps:30});}catch(error){return Promise.reject(error);}
  const key=JSON.stringify([this.version,effectId,color,speed,effectParameters['openrgb:'+effectId]??{},32,16,30]);
  if(!animate&&this.cache.has(key)){
   const result=this.cache.get(key);this.cache.delete(key);this.cache.set(key,result);
   return Promise.resolve({...result,...(result.input?.kind==='audio'?{input:{...result.input,status:'idle',peak:0}}:{}),cached:true});
  }
  return this.enqueue(async()=>{
   await this.ensureWorker();
   const effect=this.catalog.find(effect=>effect.id===effectId);
   if(!effect)throw Error('Native preview effect not found');
   const settings=nativeEffectSettings(effect,{color,speed,fps:30,effectParameters});
   const audioAutomatic=(effectParameters['openrgb:'+effectId]?.['native.CustomSettings.audio_settings.audio_device']??effect.defaults.CustomSettings?.audio_settings?.audio_device)===-1;
   const result=await this.rpc('preview.frame',{effectId,settings,animate,audioAutomatic});
   this.active=animate?effectId:null;
   const output={...result,version:this.version,cached:false};
   this.cache.delete(key);this.cache.set(key,output);
   while(this.cache.size>192)this.cache.delete(this.cache.keys().next().value);
   return output;
  });
 }
 stop({effectId}={}) {
  return this.enqueue(async()=>{
   if(effectId&&this.active&&effectId!==this.active)return false;
   if(this.core&&!this.core.exited)await this.rpc('preview.stop');
   this.active=null;return true;
  });
 }
 async release() {
  const core=this.core;this.core=null;this.active=null;
  if(core)await core.stop();
  if(this.runtime){
   const owned=path.resolve(this.runtime),temp=path.resolve(os.tmpdir());
   if(path.dirname(owned)===temp&&path.basename(owned).startsWith('rayloom-preview-'))fs.rmSync(owned,{recursive:true,force:true,maxRetries:2});
   this.runtime=null;
  }
 }
 async dispose(){this.closed=true;clearTimeout(this.idleTimer);await this.chain;await this.release();this.cache.clear();}
}
