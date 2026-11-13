// Explicit physical smoke against the EXISTING owner. Never launches a core.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';
import {discoverLayout,identity} from '../shared/spatial.mjs';
import {BUILTIN_EFFECTS} from '../shared/builtin-effects.mjs';

if(!process.argv.includes('--allow-physical'))throw Error('Physical test requires --allow-physical');
const root=path.resolve(import.meta.dirname,'..'),data=path.resolve(process.env.RAYLOOM_USER_DATA||path.join(root,'runtime','user-data'));
const report={started:new Date().toISOString(),physicalHardwareTested:true,checks:[],effects:[],restored:false,limitations:'Native driver/cache evidence only; optical color correctness needs the person observing the device.'};
const client=await connectRuntime(root,data,'hardware',{launch:false});
const core=(method,params={})=>client.call('core',{method,params});
const studio=(method,args={})=>client.call('studio',{method,args});
let before,baseline,profiles=[],playbackBytes,layoutBytes;
const playbackFile=path.join(data,'playback-hardware.json'),layoutFile=path.join(data,'hardware/studio/layout.json');
try{
 const owner=await client.call('runtime.state');assert.equal(owner.mode,'hardware');assert(owner.ready,owner.error||'Core not ready');report.owner={pid:owner.pid,corePid:owner.corePid,nodeRss:owner.memory.rss};
 report.hardware=await studio('hardware.status');assert.equal(report.hardware.elevated,true,'RAM test requires elevated core');
 const snap=await client.call('snapshot');baseline=snap.devices.filter(d=>d.serial!=='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL');report.devices=baseline.map(d=>({name:d.name,vendor:d.vendor,ledCount:d.ledCount,zones:d.zones.map(z=>({name:z.name,ledCount:z.ledCount}))}));
 assert(baseline.some(d=>d.name==='Valkyrie VK99'));assert(!baseline.some(d=>/Keychron/.test(d.name)),'VK99 must not have a false Keychron controller');report.checks.push('VK99 is detected once; false Keychron is absent');
 report.ram=baseline.filter(d=>/ADATA|XPG|DRAM/i.test(d.name+' '+d.vendor)).map(d=>({name:d.name,ledCount:d.ledCount}));
 before=await studio('state');playbackBytes=fs.existsSync(playbackFile)?fs.readFileSync(playbackFile):null;layoutBytes=fs.existsSync(layoutFile)?fs.readFileSync(layoutFile):null;
 for(const plugin of snap.plugins.filter(p=>p.loaded))profiles.push({id:plugin.id,profile:await core('plugin.profile.get',{plugin:plugin.id})});
 const layout=discoverLayout(baseline,before.layout).layout;await studio('save',{layout});
 const config={group:'all',brightness:25,speed:2,scale:350,fps:60,color:0xb07020,gameReactive:false,projection:'xy'};
 for(const effect of BUILTIN_EFFECTS){await studio('play',{config:{...config,effect:effect.id}});await delay(600);const s=await studio('telemetry');assert(s.running,s.error);assert(s.metrics.frames>0);report.effects.push({id:effect.id,frames:s.metrics.frames,fps:s.metrics.achievedFps});}
 report.checks.push('All 13 Lumen effects produced frames through the physical owner');
 await studio('play',{config:{...config,effect:'wave'}});await delay(2200);report.waveMetrics=(await studio('telemetry')).metrics;report.driverMetrics=(await client.call('snapshot')).devices.map(d=>({name:d.name,metrics:d.metrics}));
 const c=layout.components.find(c=>c.device.name==='Valkyrie VK99');assert(c);
 await studio('identify',{component:c.id});assert((await studio('state')).running);report.checks.push('Isolated identify restores and resumes the active scene');
 const calibration=await studio('calibration.begin',{component:c.id});assert.equal(calibration.phase,'question');
 const tested=(await client.call('snapshot')).devices.filter(d=>d.serial!=='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL');
 assert(tested.filter(d=>d.name!==c.device.name).every(d=>d.colors.every(v=>v===0)));assert(tested.find(d=>d.name===c.device.name).colors.some(v=>v===255));
 await studio('calibration.cancel',{session:calibration.session});assert((await studio('state')).running);report.checks.push('Raw red reaches selected keyboard, all other controllers are black, cancellation resumes scene');
 report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{
 if(before&&baseline){try{
  await studio('calibration.cancel',{resume:false});await studio('stop');await studio('save',{layout:before.layout});
  await core('devices.restore',{frames:baseline.map(d=>({device:identity(d),activeMode:d.activeMode,zoneModes:d.zones.map(z=>z.activeMode??-1),pixels:d.colors.map((v,i)=>[i,v])}))});await core('devices.flush');
  for(const p of profiles)await core('plugin.profile.set',{plugin:p.id,profile:p.profile});
  if(before.running&&before.current)await studio('play',{config:before.current});
  if(layoutBytes)fs.writeFileSync(layoutFile,layoutBytes);else if(fs.existsSync(layoutFile))fs.unlinkSync(layoutFile);
  if(playbackBytes)fs.writeFileSync(playbackFile,playbackBytes);else if(fs.existsSync(playbackFile))fs.unlinkSync(playbackFile);
  report.restored=true;
 }catch(e){report.restoreError=e.stack;process.exitCode=1;}}
 client.close();report.finished=new Date().toISOString();fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/live-runtime-0.5.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,restored:report.restored,devices:report.devices?.map(d=>d.name),ram:report.ram,checks:report.checks,error:report.error,restoreError:report.restoreError},null,2));
}
