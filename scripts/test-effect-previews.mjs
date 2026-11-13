// Native, virtual-only integration test. Never connects to the lighting agent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeEffectPreviews} from '../desktop/effect-previews.mjs';
import {CoreClient} from '../desktop/core-client.mjs';
import {nativeEffectSettings} from '../shared/native-effect-config.mjs';

const root=path.resolve(import.meta.dirname,'..'),service=new NativeEffectPreviews(root,{idleMs:1000});
const report={physicalHardwareTested:false,fixtures:[],checks:[],renderer:'native RGBEffect::StepEffect',width:32,height:16};
const digest=colors=>createHash('sha256').update(JSON.stringify(colors)).digest('hex');
let guard;
try {
 for(const bad of [{effectId:'../RainbowWave'},{effectId:'RainbowWave',color:-1},{effectId:'RainbowWave',speed:Infinity},{effectId:'RainbowWave',speed:11},{effectId:'RainbowWave',animate:'yes'}])await assert.rejects(service.frame(bad));
 assert.equal(service.core,undefined,'invalid requests cannot start a worker');report.checks.push('input validation before spawn');
 await service.frame({effectId:'RainbowWave',color:0x80ff20,speed:4,animate:false});
 const catalog=service.catalog;
 assert.equal(catalog.length,58);
 const devicesBefore=await service.core.call('devices.list');
 assert.equal(devicesBefore.length,1);assert.equal(devicesBefore[0].serial,'preview-001');
 const sceneBefore=await service.rpc('scene.get');
 for(const effect of catalog){
  const sample=await service.frame({effectId:effect.id,color:0x80ff20,speed:4,animate:false});
  assert.equal(sample.source,'native');assert.equal(sample.effectId,effect.id);
  assert(['ready','needs-input'].includes(sample.status));
  if(sample.status==='ready'){
   assert.equal(sample.colors.length,512);assert(sample.colors.every(c=>Number.isInteger(c)&&c>=0&&c<=0xffffff));
   assert.deepEqual(sample.settings,nativeEffectSettings(effect,{color:0x80ff20,speed:4,fps:30}),'same settings as real output');
  }else assert(sample.reason&&sample.colors===undefined,'missing input has no imitation pixels');
  report.fixtures.push({id:effect.id,status:sample.status,reason:sample.reason,hash:sample.colors&&digest(sample.colors),lit:sample.colors?.filter(Boolean).length});
  console.log('PASS',effect.id,sample.status);
 }
 assert.deepEqual(await service.core.call('devices.list'),devicesBefore,'private fixture is not registered and source strip unchanged');
 assert.deepEqual(await service.rpc('scene.get'),sceneBefore,'preview does not load or alter a profile');
 report.checks.push('all 58 actual frame or explicit input requirement; unregistered fixture; unchanged scene');
 const red=await service.frame({effectId:'CustomMarquee',color:255,speed:4,animate:false});
 const green=await service.frame({effectId:'CustomMarquee',color:65280,speed:4,animate:false});
 assert(red.colors.every(c=>c===255));assert(green.colors.every(c=>c===65280));
 const slow=await service.frame({effectId:'RainbowWave',color:255,speed:1,animate:false});
 const fast=await service.frame({effectId:'RainbowWave',color:255,speed:9,animate:false});
 assert.notEqual(digest(slow.colors),digest(fast.colors));
 assert(fast.settings.Speed>slow.settings.Speed);
 report.checks.push('selected palette color matches exact native RGB pixels; speed changes native phase and cache key');
 const first=await service.frame({effectId:'RainbowWave',color:0x80ff20,speed:4});await delay(180);
 const second=await service.frame({effectId:'RainbowWave',color:0x80ff20,speed:4});assert(second.frame>first.frame);assert.notEqual(digest(first.colors),digest(second.colors));
 const workerPid=service.core.child.pid;
 const cached=await service.frame({effectId:'RainbowWave',color:0x80ff20,speed:4,animate:false});assert.equal(cached.cached,true);assert.equal(digest(cached.colors),digest(second.colors));
 await service.stop();
 await delay(1400);assert.equal(service.core,null,'idle releases native worker');
 assert.throws(()=>process.kill(workerPid,0),'worker no longer exists');
 report.checks.push('native timer changes frames; exact cached frame; idle terminates worker');
 await service.frame({effectId:'RainbowWave',speed:3});
 const core=service.core;await service.dispose();assert.equal(core.exited,true);assert.equal(core.forcedKill,undefined);await assert.rejects(service.frame({effectId:'RainbowWave',animate:false}),/closed/);
 report.checks.push('dispose graceful exit; closed service rejects cached calls');
 const guardDir=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-preview-guard-'));
 guard=new CoreClient(root,guardDir,{virtual:true,allPlugins:false});await guard.start();
 await assert.rejects(guard.call('plugin.rpc',{plugin:'org.openrgb.openrgbeffectsplugin',request:{method:'preview.stop'}}),/isolated virtual/);
 report.checks.push('native RPC rejected outside dedicated preview process');
 assert.equal(report.fixtures.length,58);
 report.ready=report.fixtures.filter(x=>x.status==='ready').length;
 report.needsInput=report.fixtures.filter(x=>x.status==='needs-input').length;
 report.distinctFrames=new Set(report.fixtures.map(x=>x.hash).filter(Boolean)).size;
 assert(report.distinctFrames>30,'native results must not collapse to generic sketches');
} catch(error){report.error=error.stack;throw error;}
finally {await service.dispose();await guard?.stop();fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts','effect-previews-smoke.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({ready:report.ready,needsInput:report.needsInput,distinctFrames:report.distinctFrames,checks:report.checks.length}));
