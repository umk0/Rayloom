// Read-only evidence from the existing physical owner. Never launches a core.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {connectRuntime} from '../desktop/runtime-client.mjs';
import {normalizeSceneConfig} from '../shared/scene-config.mjs';
const root=path.resolve(import.meta.dirname,'..'),data=path.join(root,'runtime/user-data');
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('Use before or after');
const evidenceName=process.argv[3]??'feedback-runtime';if(!/^[a-z0-9-]{1,60}$/.test(evidenceName))throw Error('Invalid evidence name');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const client=await connectRuntime(root,data,'hardware',{launch:false});
try{
 const [state,runtime,snapshot,hardware]=await Promise.all([
  client.call('studio',{method:'state'}),client.call('runtime.state'),client.call('snapshot'),client.call('core',{method:'hardware.status',params:{}})
 ]);
 if(state.mode!=='hardware'||snapshot.mode!=='hardware')throw Error('Expected existing hardware owner');
 const report={at:new Date().toISOString(),phase,readOnly:true,agentPid:runtime.pid,corePid:runtime.corePid,ready:runtime.ready,elevated:hardware.elevated,running:state.running,
  settings:{autoStart:runtime.settings.autoStart,elevatedStartup:runtime.settings.elevatedStartup},
  scene:state.current?{effect:state.current.effect,speed:state.current.speed,brightness:state.current.brightness,fps:state.current.fps}:null,
  layoutHash:hash(state.layout),configHash:hash(state.current?normalizeSceneConfig(state.current):null),
  components:state.layout.components.length,groups:state.layout.groups.length,
  devices:snapshot.devices.map(d=>({name:d.name,ledCount:d.ledCount})),metrics:{fps:state.metrics?.achievedFps,frames:state.metrics?.frames}};
 if(phase==='before'){
  const backup=path.join(root,'runtime/backups/feedback-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(backup,{recursive:true});
  for(const file of ['app-settings.json','playback-hardware.json','hardware/studio/layout.json']){
   const source=path.join(data,file);if(fs.existsSync(source)){const destination=path.join(backup,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);}
  }
  report.backup=backup;
 }else{
  const rpc=(method,params={})=>client.call('core',{method:'plugin.rpc',params:{plugin:'org.openrgb.openrgbeffectsplugin',request:{method,...params}}});
  const catalog=await rpc('catalog'),sample=catalog.find(e=>e.colorCount===0);
  const legacy=structuredClone(sample.defaults);delete legacy.UserColors;
  const checked=await rpc('scene.validate',{profile:{version:2,Effects:[legacy]}});
  report.legacyValidation={effect:sample.id,userColorsRestored:Array.isArray(checked.Effects[0].UserColors),catalogCount:catalog.length,applied:false};
  const before=JSON.parse(fs.readFileSync(path.join(root,'artifacts',evidenceName+'-before.json'),'utf8'));
  report.preservation={layout:before.layoutHash===report.layoutHash,config:before.configHash===report.configHash,settings:hash(before.settings)===hash(report.settings),running:before.running===report.running,devices:hash(before.devices.slice().sort((a,b)=>a.name.localeCompare(b.name)))===hash(report.devices.slice().sort((a,b)=>a.name.localeCompare(b.name)))};
  if(Object.values(report.preservation).some(v=>!v))process.exitCode=1;
 }
 fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts',evidenceName+'-'+phase+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{client.close();}
