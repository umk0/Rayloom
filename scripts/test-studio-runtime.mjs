import {CoreClient} from '../desktop/core-client.mjs';
import {StudioService} from '../desktop/studio-service.mjs';
import {discoverLayout} from '../shared/spatial.mjs';
import {calibrateColor,CHANNEL_ORDERS} from '../shared/color-calibration.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const root=path.resolve(import.meta.dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-runtime-'));
const core=new CoreClient(root,path.join(runtime,'native'));
const studio=new StudioService(root,runtime,()=>core);
const report={runtime,physicalHardwareTested:false,metricsMeaning:'Host acknowledged submissions; driverFps is completed driver calls, not optical refresh.',rates:[],checks:[]};
const check=name=>{report.checks.push(name);console.log('PASS',name);};
try{
 await core.start();const layout=discoverLayout(await core.call('devices.list')).layout;await studio.saveLayout(layout);
 for(const effect of ['wave','openrgb:RainbowWave'])for(const fps of [60,120]){
  await studio.play({effect,fps,brightness:100});await delay(1700);
  assert.equal(studio.error,'');const metrics=studio.telemetry().metrics,device=(await core.call('devices.list'))[0];
  report.rates.push({effect,target:fps,hostFps:metrics.achievedFps,frameMs:metrics.frameMs,renderMs:metrics.renderMs,sendMs:metrics.sendMs,droppedFrames:metrics.droppedFrames,driver:device.metrics});
  assert(metrics.achievedFps>fps*.5,`${effect} ${fps}: ${metrics.achievedFps}`);assert(metrics.achievedFps<fps*1.2);assert(device.metrics.updates>0);
  await studio.stop();const captured=(await core.call('devices.list'))[0].colors;await delay(60);assert.deepEqual((await core.call('devices.list'))[0].colors,captured);
 }
 check('60/120 target FPS measured for worker and native rendering, output stable after flush');
 const call=core.call.bind(core);let sampled,checked=0;
 core.call=async(method,args)=>{
  const result=await call(method,args);
  if(method==='devices.sample')sampled=result;
  if(method==='devices.frame'&&sampled&&studio.metrics.kind==='native'){
   assert.deepEqual(args.frames[0].pixels.map(p=>p[1]),sampled.map(c=>calibrateColor(c,layout.components[0].calibration)));checked++;
  }
  return result;
 };
 for(const channelOrder of CHANNEL_ORDERS){
  layout.components[0].calibration={channelOrder,brightness:100};await studio.saveLayout(layout);sampled=null;
  await studio.play({effect:'openrgb:RainbowWave',brightness:100,fps:60});await delay(160);assert.equal(studio.error,'');await studio.stop();
 }
 assert(checked>=6);core.call=call;check('all six color orders applied to original native effect samples before output');
 layout.components[0].calibration={channelOrder:'GRB',brightness:100};await studio.saveLayout(layout);
 const canvas=await studio.play({effect:'canvas:test',brightness:100});
 studio.submitCanvasFrame({session:canvas.canvasSession,sequence:1,width:1,height:1,rgba:[255,0,0,255]});await delay(100);await studio.stop();
 assert((await core.call('devices.list'))[0].colors.every(c=>c===0x00ff00));check('sandbox Canvas RGBA uses the same calibrated native output and flush');
 const plays=[];
 for(let i=0;i<8;i++)plays.push(studio.play({effect:i%2?'wave':'openrgb:RainbowWave',speed:i}));
 plays.push(studio.play({effect:'solid',color:0x010203,brightness:100}));await Promise.all(plays);await delay(80);assert.equal(studio.current.effect,'solid');assert.equal(studio.error,'');await studio.stop();
 assert((await core.call('devices.list'))[0].colors.every(c=>c===0x010302));assert.equal((await core.call('devices.list')).length,1);check('rapid native/spatial switching applies latest scene and releases virtual maps');
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 try{await studio.stop();}finally{await core.stop();}
 report.exitCode=core.exitCode;report.forcedKill=!!core.forcedKill;
 if(core.exitCode!==0||core.forcedKill){report.passed=false;process.exitCode=1;}
 fs.writeFileSync(path.join(root,'artifacts/studio-runtime-integration.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,rates:report.rates,error:report.error},null,2));
}
