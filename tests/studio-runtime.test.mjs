import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {StudioService} from '../desktop/studio-service.mjs';
import {normalizeSceneConfig} from '../shared/scene-config.mjs';
import {calibrateColor,logicalColor,CHANNEL_ORDERS,inferChannelOrder} from '../shared/color-calibration.mjs';
import {discoverLayout,validateLayout,deviceKey} from '../shared/spatial.mjs';

const root=path.resolve(import.meta.dirname,'..');
class FakeCore {
 constructor({writeDelay=0}={}){
  this.device={name:'Virtual test strip',vendor:'Tests',serial:'runtime',location:'Test:virtual',ledCount:12,colors:Array(12).fill(0x654321),activeMode:2,modeCount:3,zones:[{index:0,name:'Front',ledCount:12,startIndex:0,activeMode:0}]};
  this.writeDelay=writeDelay;this.pending=0;this.maxPending=0;this.writes=[];this.maps=[];this.effects={version:2,Effects:[]};
  this.configs={hardwaresync:{measures:[]},e131receiver:{running:false},scheduler:{tasks:[]},httphook:{running:false}};
  this.extraDevices=[];
 }
 async call(method,args={}){
  if(method==='devices.list')return structuredClone([this.device,...this.extraDevices,...(this.maps.some(m=>m.registered)?[{name:'Lumen Spatial',vendor:'OpenRGB',serial:'VISUAL_MAP_VISUAL_CONTROLLER_SERIAL',location:'Map',ledCount:16384,zones:[{index:0,ledCount:16384,startIndex:0}]}]:[])]);
  if(method==='devices.prepare'){for(const frame of args.frames){const device=[this.device,...this.extraDevices].find(d=>deviceKey(d)===deviceKey(frame.device));if(device)device.activeMode=1;}return true;}
  if(method==='devices.flush'){this.flushed=true;return true;}
  if(method==='runtime.wait'){await delay(args.ms);return true;}
  if(method==='devices.sample')return args.indices.map(i=>((i%256)<<16)|0x2255);
  if(method==='devices.frame'||method==='devices.restore'){
   this.pending++;this.maxPending=Math.max(this.maxPending,this.pending);
   try{if(this.writeDelay)await delay(this.writeDelay);for(const frame of args.frames){const device=[this.device,...this.extraDevices].find(d=>deviceKey(d)===deviceKey(frame.device));if(!device)throw Error('Device disconnected');for(const [index,color] of frame.pixels)device.colors[index]=color;if(method==='devices.restore')device.activeMode=frame.activeMode;}this.writes.push(structuredClone(args.frames));return true;}
   finally{this.pending--;}
  }
  if(method!=='plugin.rpc')throw Error('Unexpected method '+method);
  const id=args.plugin.replace('org.openrgb.openrgb','').replace(/plugin$/,''),r=args.request;
  if(id==='effects'){
   if(r.method==='catalog')return [{id:'RainbowWave',defaults:{EffectClassName:'RainbowWave',AutoStart:true},speedMin:1,speedMax:100}];
   if(r.method==='scene.get')return structuredClone(this.effects);
   if(r.method==='scene.apply'){this.effects=structuredClone(r.profile);return this.effects;}
   if(r.method==='stop'){for(const e of this.effects.Effects)e.AutoStart=false;return true;}
  }
  if(id==='visualmap'){
   if(r.method==='add')this.maps.push({name:r.name,registered:false,map:{}});
   if(r.method==='map.set')this.maps[r.index]={name:r.name,map:r.map,registered:false};
   if(r.method==='register')this.maps[r.index].registered=r.enabled;
   return {maps:structuredClone(this.maps)};
  }
  const c=this.configs[id];if(!c)throw Error('Unexpected plugin '+id);
  if(r.method==='config.set'){if(r.measures)c.measures=r.measures;if(r.tasks)c.tasks=r.tasks;}
  if(r.method==='stop'){c.running=false;for(const m of c.measures??[])m.running=false;for(const t of c.tasks??[])t.run=false;}
  if(r.method==='start')c.running=true;
  return structuredClone(c);
 }
}
async function fixture(options){
 const testRoot=path.join(root,'artifacts','runtime-tests');fs.mkdirSync(testRoot,{recursive:true});
 const directory=fs.mkdtempSync(path.join(testRoot,'unit-')),core=new FakeCore(options),studio=new StudioService(root,directory,()=>core);
 const layout=discoverLayout([core.device]).layout;await studio.saveLayout(layout);
 return {core,studio,layout,close:async()=>{await studio.stop();if(!path.resolve(directory).startsWith(path.resolve(testRoot)+path.sep))throw Error('Invalid test cleanup path');fs.rmSync(directory,{recursive:true,force:true});}};
}

test('scene edits normalize blank/comma/out-of-range fields and identify malformed field',()=>{
 const value=normalizeSceneConfig({speed:'40',scale:-5,brightness:150,fps:500,color:'#204060'});
 assert.deepEqual([value.speed,value.scale,value.brightness,value.fps,value.color],[10,1,100,120,0x604020]);
 assert.equal(normalizeSceneConfig({speed:'1,5'}).speed,1.5);
 assert.equal(normalizeSceneConfig({speed:''},{speed:4}).speed,4);
 assert.throws(()=>normalizeSceneConfig({scale:'oops'}),/Масштаб/);
});

test('invalid SDK parameters are rejected before stopping the current scene',async()=>{
 const f=await fixture();
 try{
  f.studio.plugins=[{id:'com.example.parameters',effects:[{id:'test',name:'Test',parameters:[{key:'enabled',type:'boolean',label:'Включено',default:true}],rgb:[{param:'enabled'},0,0]}]}];
  await f.studio.play({effect:'solid',color:0x123456,brightness:100});
  const generation=f.studio.generation;
  await assert.rejects(f.studio.play({effect:'com.example.parameters/test',effectParameters:{'com.example.parameters/test':{enabled:1}}}),/Неверное значение/);
  assert.equal(f.studio.generation,generation);assert.equal(f.studio.current.effect,'solid');assert.equal(f.studio.running,true);
  await f.studio.play({effect:'com.example.parameters/test',brightness:100,effectParameters:{'com.example.parameters/test':{enabled:true}}});
  assert(f.core.device.colors.every(c=>c===255));
  await f.studio.play({effect:'com.example.parameters/test',brightness:100,effectParameters:{'com.example.parameters/test':{enabled:false}}});
  assert(f.core.device.colors.every(c=>c===0));
 }finally{await f.close();}
});

test('saving spatial edits resumes the scene and clears removed component LEDs without autoplaying a stopped scene',async()=>{
 const f=await fixture();
 try{
  const first=f.layout.components[0],second=structuredClone(first);second.id+='-rear';second.name='Rear';second.points=first.points.slice(6);first.points=first.points.slice(0,6);f.layout.components.push(second);
  await f.studio.saveLayout(f.layout);await f.studio.play({effect:'solid',color:0x123456,brightness:100});
  const edited=structuredClone(f.layout);edited.components[0].name='Front renamed';edited.components[0].pose.x=100;edited.components[1].enabled=false;
  let result=await f.studio.saveLayout(edited,{resume:true});assert(result.running);assert.equal(result.current.effect,'solid');assert.equal(result.layout.components[0].name,'Front renamed');
  assert(f.core.device.colors.slice(0,6).every(c=>c===0x123456));assert(f.core.device.colors.slice(6).every(c=>c===0));
  edited.components[0].enabled=false;result=await f.studio.saveLayout(edited,{resume:true});assert(!result.running);assert(f.core.device.colors.every(c=>c===0));
  edited.components.forEach(c=>c.enabled=true);result=await f.studio.saveLayout(edited,{resume:true});assert(!result.running,'saving while stopped does not autoplay');
  await f.studio.play({effect:'solid'});assert(!(await f.studio.saveLayout(edited)).running,'profile loading remains stopped by default');
 }finally{await f.close();}
});

test('save resumes native output and rejects malformed layout before stopping it',async()=>{
 const f=await fixture();
 try{
  await f.studio.play({effect:'openrgb:RainbowWave',speed:3,brightness:100});
  await assert.rejects(f.studio.saveLayout({...f.layout,version:999},{resume:true}),/Invalid layout/);assert(f.studio.running);
  const edited=structuredClone(f.layout);edited.components[0].pose.rz=90;
  const result=await f.studio.saveLayout(edited,{resume:true});assert(result.running);assert.equal(result.metrics.kind,'native');assert.equal(f.core.effects.Effects[0].EffectClassName,'RainbowWave');assert(f.core.effects.Effects[0].AutoStart);
 }finally{await f.close();}
});

test('explicit stop cancels an in-flight save before it can resume output',async()=>{
 const f=await fixture();let release;
 try{
  await f.studio.play({effect:'solid'});
  const original=f.core.call.bind(f.core);let entered;const seen=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let hold=true;
  f.core.call=async(method,args)=>{if(method==='devices.list'&&hold){hold=false;entered();await gate;}return original(method,args);};
  const saving=f.studio.saveLayout(f.layout,{resume:true});await seen;const stopping=f.studio.stop();release();await Promise.all([saving,stopping]);
  assert(!f.studio.running);const frames=f.studio.frame;await delay(90);assert.equal(f.studio.frame,frames);assert.equal(f.studio.worker,null);
 }finally{release?.();await f.close();}
});

test('newer concurrent saves inherit playback intent while explicit stop revokes it',async()=>{
 const f=await fixture();
 try{
  await f.studio.play({effect:'solid',color:0x246810,brightness:100});
  const a=structuredClone(f.layout),b=structuredClone(f.layout);a.components[0].name='Older';b.components[0].name='Newest';
  await Promise.all([f.studio.saveLayout(a,{resume:true}),f.studio.saveLayout(b,{resume:true})]);
  assert(f.studio.running);assert.equal(f.studio.getLayout().components[0].name,'Newest');assert(f.core.device.colors.every(c=>c===0x246810));
  const saving=f.studio.saveLayout(a,{resume:true}),stopping=f.studio.stop(),afterStop=f.studio.saveLayout(b,{resume:true});
  await Promise.all([saving,stopping,afterStop]);assert(!f.studio.running);assert.equal(f.studio.layoutSaveIntent,null);
 }finally{await f.close();}
});

for(const failure of ['write','list','retired-flush'])test('failed layout '+failure+' restores original layout and scene while preserving the original error',async()=>{
 const f=await fixture();
 try{
  await f.studio.play({effect:'solid',color:0x246810,brightness:100});
  const edited=structuredClone(f.layout);edited.components[0].name='Must roll back';edited.components[0].points=edited.components[0].points.slice(0,6);
  const call=f.core.call.bind(f.core),write=f.studio.write.bind(f.studio);let fired=false,blackout=false;
  f.studio.write=(name,value)=>{if(failure==='write'&&name==='layout')throw Error('Original save write failure');return write(name,value);};
  f.core.call=async(method,args)=>{
   if(method==='devices.frame'&&args.frames.some(frame=>frame.pixels.length&&frame.pixels.every(([,c])=>c===0)))blackout=true;
   if(!fired&&((failure==='list'&&method==='devices.list')||(failure==='retired-flush'&&method==='devices.flush'&&blackout))){fired=true;throw Error('Original save '+failure+' failure');}
   return call(method,args);
  };
  await assert.rejects(f.studio.saveLayout(edited,{resume:true}),new RegExp('Original save '+failure+' failure'));
  assert.deepEqual(f.studio.getLayout(),f.layout);assert(f.studio.running);assert.equal(f.studio.current.effect,'solid');assert(f.core.device.colors.every(c=>c===0x246810));
 }finally{await f.close();}
});

test('a stale failing save cannot roll back a newer layout or cancel its resumed scene',async()=>{
 const f=await fixture();let release;
 try{
  await f.studio.play({effect:'solid',brightness:100});
  const call=f.core.call.bind(f.core);let entered,hold=true;const seen=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  f.core.call=async(method,args)=>{if(method==='devices.list'&&hold){hold=false;entered();await gate;throw Error('Old discovery failure');}return call(method,args);};
  const a=structuredClone(f.layout),b=structuredClone(f.layout);a.components[0].name='Old';b.components[0].name='Current';
  const old=f.studio.saveLayout(a,{resume:true});await seen;const current=f.studio.saveLayout(b,{resume:true});release();await Promise.all([old,current]);
  assert(f.studio.running);assert.equal(f.studio.getLayout().components[0].name,'Current');
 }finally{release?.();await f.close();}
});
test('all channel permutations keep independent R G B values and component gain',()=>{
 const expected={RGB:0x331107,RBG:0x113307,GRB:0x330711,GBR:0x073311,BRG:0x110733,BGR:0x071133};
 for(const channelOrder of CHANNEL_ORDERS){assert.equal(calibrateColor(0x331107,{channelOrder,brightness:100}),expected[channelOrder],channelOrder);assert.equal(logicalColor(expected[channelOrder],{channelOrder}),0x331107);}
 assert.equal(calibrateColor(0xffffff,{channelOrder:'RGB',brightness:50}),0x808080);
});

test('guided calibration infers all six wire permutations and rejects ambiguous answers',()=>{
 for(const wiring of CHANNEL_ORDERS){
  const correction=inferChannelOrder([...wiring]);
  for(const color of [0x0000ff,0x00ff00,0xff0000,0x274f91]){
   const sent=calibrateColor(color,{channelOrder:correction,brightness:100}),bytes=[sent&255,(sent>>>8)&255,(sent>>>16)&255],physical={};
   [...wiring].forEach((channel,i)=>{physical[channel]=bytes[i];});
   assert.equal(physical.R|(physical.G<<8)|(physical.B<<16),color,wiring);
  }
 }
 for(const answers of [['R','R','B'],['R','G'],['R','G','dark']])assert.throws(()=>inferChannelOrder(answers),/три разных/);
});

function addOtherDevice(core){const device={...structuredClone(core.device),name:'Other controller',serial:'other',location:'Test:other',colors:Array(12).fill(0x192837),activeMode:0};core.extraDevices.push(device);return device;}

test('identify blacks out every physical controller and restores unrelated colors and modes on stop',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core),original=[...f.core.device.colors],otherOriginal=[...other.colors];
 try{
  const component={...f.layout.components[0],points:f.layout.components[0].points.slice(0,2)};
  const pending=f.studio.identify(component);await delay(100);
  assert.deepEqual(f.core.device.colors.slice(0,2),[255,255]);assert(f.core.device.colors.slice(2).every(c=>c===0));assert(other.colors.every(c=>c===0));
  await f.studio.stop();await pending;
  assert.deepEqual(f.core.device.colors,original);assert.deepEqual(other.colors,otherOriginal);assert.equal(f.core.device.activeMode,2);assert.equal(other.activeMode,0);
 }finally{await f.close();}
});

test('wizard uses raw probes, isolates a port, saves only after review, and resumes the scene',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core),otherOriginal=[...other.colors];
 try{
  f.layout.components[0].points=f.layout.components[0].points.slice(0,2);f.layout.components[0].calibration={channelOrder:'BGR',brightness:75};await f.studio.saveLayout(f.layout);
  await f.studio.play({effect:'solid',color:255,brightness:100});
  const draft=structuredClone(f.layout);draft.components[0].name='Cooling';
  let state=await f.studio.beginCalibration({component:draft.components[0].id,layout:draft});
  assert.equal(f.studio.running,false);assert(f.core.device.colors.slice(0,2).every(c=>c===255),'old BGR correction must not affect raw red probe');assert(f.core.device.colors.slice(2).every(c=>c===0));assert(other.colors.every(c=>c===0));
  assert.notEqual(f.studio.getLayout().components[0].name,'Cooling');
  state=await f.studio.answerCalibration({session:state.session,color:'G'});assert(f.core.device.colors.slice(0,2).every(c=>c===65280));
  state=await f.studio.answerCalibration({session:state.session,color:'B'});assert(f.core.device.colors.slice(0,2).every(c=>c===16711680));
  state=await f.studio.answerCalibration({session:state.session,color:'R'});assert.equal(state.phase,'review');assert.equal(state.channelOrder,'GBR');assert(f.core.device.colors.slice(0,2).every(c=>c===16711680),'corrected red review uses full brightness');
  const result=await f.studio.applyCalibration({session:state.session});
  assert.equal(result.layout.components[0].name,'Cooling');assert.deepEqual(result.layout.components[0].calibration,{channelOrder:'GBR',brightness:75});assert(f.studio.running);assert.equal(f.studio.current.effect,'solid');assert.equal(f.studio.calibrationState(),null);assert.deepEqual(other.colors,otherOriginal);assert.equal(other.activeMode,0);
  assert(f.core.device.colors.slice(0,2).every(c=>c===0xbf0000));
 }finally{await f.close();}
});

test('wizard cancellation restores all hardware and external ownership without saving draft changes',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core),before=[...f.core.device.colors],otherBefore=[...other.colors];
 f.core.effects={version:2,Effects:[{EffectClassName:'RainbowWave',AutoStart:true}]};f.core.configs.e131receiver.running=true;
 try{
  const draft=structuredClone(f.layout);draft.components[0].name='Unsaved port';
  const state=await f.studio.beginCalibration({component:draft.components[0].id,layout:draft});
  await assert.rejects(f.studio.answerCalibration({session:'expired',color:'R'}),/завершена/);
  await f.studio.cancelCalibration({session:state.session});
  assert.deepEqual(f.studio.getLayout(),f.layout);assert.deepEqual(f.core.device.colors,before);assert.deepEqual(other.colors,otherBefore);assert.equal(f.core.device.activeMode,2);assert.equal(other.activeMode,0);assert(f.core.effects.Effects[0].AutoStart);assert(f.core.configs.e131receiver.running);
 }finally{await f.close();}
});

test('wizard lease expiry restores all devices and resumes the last scene without renderer polling',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core),otherBefore=[...other.colors];f.studio.calibrationTimeoutMs=40;let ended;
 f.studio.onCalibrationEnd=event=>{ended=event;};
 try{
  await f.studio.play({effect:'solid',color:0x432165,brightness:100});
  const state=await f.studio.beginCalibration({component:f.layout.components[0].id});await delay(180);
  assert.equal(f.studio.calibrationState(),null);assert(f.studio.running);assert(f.core.device.colors.every(c=>c===0x432165));assert.deepEqual(other.colors,otherBefore);assert.deepEqual(ended,{session:state.session,reason:'timeout',resumed:true});
 }finally{await f.close();}
});

test('ambiguous wizard answers cannot persist a correction and stop interrupts safely',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core),before=[...f.core.device.colors],otherBefore=[...other.colors];
 try{
  const state=await f.studio.beginCalibration({component:f.layout.components[0].id});
  await f.studio.answerCalibration({session:state.session,color:'R'});
  await assert.rejects(f.studio.answerCalibration({session:state.session,color:'R'}),/уже был выбран/);assert.equal(f.studio.calibrationState().step,1);
  const unsupported=await f.studio.answerCalibration({session:state.session,color:'mixed'});assert.equal(unsupported.phase,'unsupported');assert(f.core.device.colors.every(c=>c===0));
  await assert.rejects(f.studio.applyCalibration({session:state.session}),/три вопроса/);
  await f.studio.stop();assert(!f.studio.running);assert.equal(f.studio.calibrationState(),null);assert.deepEqual(f.core.device.colors,before);assert.deepEqual(other.colors,otherBefore);assert.deepEqual(f.studio.getLayout(),f.layout);
 }finally{await f.close();}
});

test('wizard restoration skips disconnected controllers without losing the remaining devices',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core),before=[...f.core.device.colors];
 try{
  const state=await f.studio.beginCalibration({component:f.layout.components[0].id});assert(other.colors.every(c=>c===0));f.core.extraDevices=[];
  await f.studio.cancelCalibration({session:state.session});assert.deepEqual(f.core.device.colors,before);assert.equal(f.core.device.activeMode,2);
 }finally{await f.close();}
});

test('wizard excludes source-only map controllers and restores all hardware after a probe write failure',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core),before=[...f.core.device.colors],otherBefore=[...other.colors];f.core.maps=[{name:'Existing source',registered:true,map:{source_only:true}}];
 try{
  const state=await f.studio.beginCalibration({component:f.layout.components[0].id});
  assert(f.core.writes.every(batch=>batch.every(frame=>frame.device.serial!=='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL')));
  const original=f.core.call.bind(f.core);let fail=true;f.core.call=async(method,args)=>{if(method==='devices.frame'&&fail){fail=false;throw Error('USB write failed');}return original(method,args);};
  await assert.rejects(f.studio.answerCalibration({session:state.session,color:'R'}),/USB write failed/);
  assert.equal(f.studio.calibrationState(),null);assert.deepEqual(f.core.device.colors,before);assert.deepEqual(other.colors,otherBefore);assert.equal(other.activeMode,0);assert(f.core.maps[0].registered);
 }finally{await f.close();}
});

test('read-only telemetry does not extend calibration lease; explicit wizard heartbeat does',async()=>{
 const f=await fixture();f.studio.calibrationTimeoutMs=100;
 try{
  await f.studio.beginCalibration({component:f.layout.components[0].id});const first=f.studio.calibrationState().expiresAt;await delay(35);
  assert.equal(f.studio.telemetry().calibration.expiresAt,first);assert.equal(f.studio.state().calibration.expiresAt,first);
  assert(f.studio.calibrationState(true).expiresAt>first);await f.studio.cancelCalibration();
 }finally{await f.close();}
});

test('device switch saves draft and blacks out every disabled port while the remaining scene continues',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core);
 try{
  const layout=discoverLayout([f.core.device,other],f.layout).layout;await f.studio.saveLayout(layout);await f.studio.play({effect:'solid',color:0x765432,brightness:100});
  const draft=structuredClone(layout);draft.deviceAliases={[deviceKey(f.core.device)]:'My controller'};
  const result=await f.studio.setDeviceEnabled({deviceKey:deviceKey(f.core.device),enabled:false,layout:draft});
  assert(result.running);assert.equal(result.layout.deviceAliases[deviceKey(f.core.device)],'My controller');assert(result.layout.components.filter(c=>c.deviceKey===deviceKey(f.core.device)).every(c=>!c.enabled));assert(f.core.device.colors.every(c=>c===0));assert(other.colors.every(c=>c===0x765432));
  await delay(60);assert(f.core.device.colors.every(c=>c===0));assert.equal(f.core.maxPending,1);
  await f.studio.setDeviceEnabled({deviceKey:deviceKey(f.core.device),enabled:true});assert(f.core.device.colors.every(c=>c===0x765432));assert(f.studio.running);
 }finally{await f.close();}
});

test('disabling the last device succeeds with stopped output and can remember an offline device',async()=>{
 const f=await fixture();
 try{
  await f.studio.play({effect:'solid',color:255,brightness:100});const result=await f.studio.setDeviceEnabled({deviceKey:deviceKey(f.core.device),enabled:false});
  assert(!result.running);assert(f.core.device.colors.every(c=>c===0));assert(result.warnings.length);assert(!result.layout.components[0].enabled);
  const missing={...structuredClone(result.layout.components[0]),id:'offline',device:{...f.core.device,serial:'offline'},enabled:true};missing.deviceKey=deviceKey(missing.device);
  result.layout.components.push(missing);const saved=await f.studio.setDeviceEnabled({deviceKey:missing.deviceKey,enabled:false,layout:result.layout});assert(!saved.layout.components.find(c=>c.id==='offline').enabled);
 }finally{await f.close();}
});

test('failed device blackout rolls back layout and previous lighting',async()=>{
 const f=await fixture(),other=addOtherDevice(f.core);
 try{
  const layout=discoverLayout([f.core.device,other],f.layout).layout;await f.studio.saveLayout(layout);await f.studio.play({effect:'solid',color:0x245678,brightness:100});
  const original=f.core.call.bind(f.core);let fail=true;f.core.call=async(method,args)=>{if(method==='devices.frame'&&args.frames.every(frame=>frame.pixels.every(p=>p[1]===0))&&fail){fail=false;throw Error('Blackout failed');}return original(method,args);};
  await assert.rejects(f.studio.setDeviceEnabled({deviceKey:deviceKey(f.core.device),enabled:false}),/Blackout failed/);
  assert.deepEqual(f.studio.getLayout(),layout);assert(f.studio.running);assert(f.core.device.colors.every(c=>c===0x245678));assert(other.colors.every(c=>c===0x245678));
 }finally{await f.close();}
});
test('aliases and calibrated component identity survive rediscovery',()=>{
 const d=new FakeCore().device,layout=discoverLayout([d]).layout;
 layout.components[0].name='Передние вентиляторы';layout.components[0].calibration={channelOrder:'GRB',brightness:80};layout.deviceAliases={[layout.components[0].deviceKey]:'Мой корпус'};
 validateLayout(layout);const rediscovered=discoverLayout([d],layout).layout;
 assert.equal(rediscovered.components[0].name,'Передние вентиляторы');assert.equal(rediscovered.components[0].calibration.channelOrder,'GRB');assert.equal(rediscovered.deviceAliases[layout.components[0].deviceKey],'Мой корпус');
});
test('worker renderer paces output, reports measured FPS, and rejects invalid edit without stopping',async()=>{
 const f=await fixture();
 try{
  await f.studio.play({effect:'solid',color:0xabcdef,fps:60});await delay(300);
  assert(f.studio.metrics.frames>=10);assert(f.studio.metrics.achievedFps>30);assert(f.studio.metrics.achievedFps<90);assert(f.studio.worker);
  await assert.rejects(f.studio.play({speed:'broken'}),/Скорость/);assert(f.studio.running);assert.equal(f.studio.current.color,0xabcdef);
  await f.studio.stop();const writes=f.core.writes.length;await delay(60);assert.equal(f.core.writes.length,writes);assert.equal(f.core.maxPending,1);assert(f.core.flushed);
 }finally{await f.close();}
});
test('slow device writes never overlap and skipped deadlines are counted',async()=>{
 const f=await fixture({writeDelay:35});
 try{await f.studio.play({effect:'wave',fps:120});await delay(280);assert.equal(f.core.maxPending,1);assert(f.studio.metrics.droppedFrames>5);assert(f.studio.metrics.achievedFps<35);assert(f.studio.metrics.sendMs>=25);}
 finally{await f.close();}
});
test('canvas frames are bounded, session scoped, ordered, and calibrated after sampling',async()=>{
 const f=await fixture();f.layout.components[0].calibration={channelOrder:'GRB',brightness:100};await f.studio.saveLayout(f.layout);
 try{
  const state=await f.studio.play({effect:'canvas:test',brightness:100,fps:60});
  assert.equal(f.studio.submitCanvasFrame({session:'stale',width:1,height:1,rgba:[255,0,0,255]}).accepted,false);
  assert.throws(()=>f.studio.submitCanvasFrame({session:state.canvasSession,width:129,height:1,rgba:[]}),/128/);
  assert(f.studio.submitCanvasFrame({session:state.canvasSession,sequence:2,width:1,height:1,rgba:[255,0,0,255]}).accepted);
  assert.equal(f.studio.submitCanvasFrame({session:state.canvasSession,sequence:1,width:1,height:1,rgba:[0,0,255,255]}).accepted,false);
  await delay(70);assert(f.core.device.colors.every(c=>c===0x00ff00));
  await f.studio.play({effect:'solid',color:0x123456});assert.equal(f.studio.submitCanvasFrame({session:state.canvasSession,width:1,height:1,rgba:[255,0,0,255]}).accepted,false);
 }finally{await f.close();}
});
test('native source canvas uses selected FPS and calibrated host output without physical map writer',async()=>{
 const f=await fixture();f.layout.components[0].calibration={channelOrder:'BGR',brightness:100};await f.studio.saveLayout(f.layout);
 try{
  await f.studio.play({effect:'openrgb:RainbowWave',brightness:100,fps:90});await delay(50);
  assert.equal(f.core.effects.Effects[0].FPS,90);assert.deepEqual(f.core.maps[0].map.ctrl_zones,[]);assert.equal(f.core.maps[0].map.source_only,true);
  assert.equal(f.studio.metrics.kind,'native');assert.equal(f.core.device.colors[0],0x552200);
  await f.studio.stop();assert(!f.core.maps[0].registered);assert(!f.core.effects.Effects[0].AutoStart);
 }finally{await f.close();}
});

test('rapid native/spatial changes and stop serialize ownership; the newest scene wins',async()=>{
 const f=await fixture({writeDelay:12});
 const original=f.core.call.bind(f.core);let pluginPending=0,maxPluginPending=0;
 f.core.call=async(method,args)=>{if(method==='plugin.rpc'){pluginPending++;maxPluginPending=Math.max(maxPluginPending,pluginPending);try{await delay(4);return await original(method,args);}finally{pluginPending--;}}return original(method,args);};
 try{
  const first=f.studio.play({effect:'openrgb:RainbowWave'});await delay(15);
  const pending=[first,f.studio.play({effect:'canvas:pending'}),f.studio.stop(),f.studio.play({effect:'wave'}),f.studio.play({effect:'solid',color:0x010203,brightness:100})];
  await Promise.all(pending);await delay(50);
  assert.equal(f.studio.current.effect,'solid');assert(f.studio.running);assert(f.core.device.colors.every(c=>c===0x010203));assert.equal(maxPluginPending,1);assert.equal(f.core.maxPending,1);assert(f.core.maps.every(m=>!m.registered));
  const next=f.studio.play({effect:'openrgb:RainbowWave'});await delay(10);await f.studio.stop();await next;assert(!f.studio.running);assert(!f.studio.worker);assert(f.core.maps.every(m=>!m.registered));
 }finally{await f.close();}
});

test('preview reverses channel wiring while preserving calibrated component brightness',async()=>{
 const f=await fixture();f.layout.components[0].calibration={channelOrder:'GBR',brightness:50};await f.studio.saveLayout(f.layout);
 try{
  let preview;f.studio.onFrame=frame=>{preview=frame;};
  await f.studio.play({effect:'solid',color:0x0000ff,brightness:100});await delay(60);
  assert(f.core.device.colors.every(c=>c===0x800000));assert(preview.logical);assert(preview.devices[0].pixels.every(p=>p[1]===0x000080));
 }finally{await f.close();}
});
test('port identification emits three calibrated flashes and restores cached mode/colors',async()=>{
 const f=await fixture();f.layout.components[0].calibration={channelOrder:'BGR',brightness:100};await f.studio.saveLayout(f.layout);
 try{
  const before=[...f.core.device.colors],begun=performance.now();await f.studio.identify(f.layout.components[0]);
  assert(performance.now()-begun>=2900);
  assert.equal(f.core.writes.filter(batch=>batch[0].pixels.every(p=>p[1]===0xff0000)).length,3);
  assert.deepEqual(f.core.device.colors,before);assert.equal(f.core.device.activeMode,2);
 }finally{await f.close();}
});
test('identify resumes existing scene; explicit stop cancels pulse without restarting it',async()=>{
 const f=await fixture();
 try{
  await f.studio.play({effect:'solid',brightness:100,color:0x123456});await f.studio.identify(f.layout.components[0],0);
  assert(f.studio.running);assert(f.core.device.colors.every(c=>c===0x123456));
  const flash=f.studio.identify(f.layout.components[0]);await delay(130);await f.studio.stop();assert.equal(await flash,false);
  assert(!f.studio.running);assert(!f.studio.identification);assert(f.core.device.colors.every(c=>c===0x123456));
 }finally{await f.close();}
});

test('identify restores externally running native effects, routes, and receiver ownership',async()=>{
 const f=await fixture();
 f.core.effects={version:2,Effects:[{EffectClassName:'RainbowWave',AutoStart:true}]};
 f.core.maps=[{name:'Existing user map',registered:true,map:{}}];f.core.configs.e131receiver.running=true;f.core.configs.httphook.running=true;f.core.configs.scheduler.tasks=[{run:true}];f.core.configs.hardwaresync.measures=[{running:true}];
 try{
  const before=[...f.core.device.colors];await f.studio.identify(f.layout.components[0],0);
  assert.deepEqual(f.core.device.colors,before);assert(f.core.effects.Effects[0].AutoStart);assert(f.core.maps[0].registered);assert(f.core.configs.e131receiver.running);assert(f.core.configs.httphook.running);assert(f.core.configs.scheduler.tasks[0].run);assert(f.core.configs.hardwaresync.measures[0].running);
 }finally{await f.close();}
});

test('dirty layout identify saves atomically and resumes the previous scene with new calibration',async()=>{
 const f=await fixture();
 try{
  await f.studio.play({effect:'solid',brightness:100,color:0x0000ff});
  const updated=structuredClone(f.layout);updated.components[0].name='Передние вентиляторы';updated.components[0].calibration={channelOrder:'GRB',brightness:100};
  await f.studio.identify(updated.components[0],0,{layout:updated});
  assert(f.studio.running);assert.equal(f.studio.current.effect,'solid');assert.equal(f.studio.getLayout().components[0].name,'Передние вентиляторы');assert(f.core.device.colors.every(c=>c===0x00ff00));
  const bad=structuredClone(updated);bad.components[0].calibration.channelOrder='invalid';
  await assert.rejects(f.studio.identify(bad.components[0],0,{layout:bad}),/порядок/);assert(f.studio.running);
 }finally{await f.close();}
});

test('dirty Canvas identify resumes a fresh session and rejects frames from the suspended session',async()=>{
 const f=await fixture();
 try{
  const first=await f.studio.play({effect:'canvas:test',brightness:100});
  f.studio.submitCanvasFrame({session:first.canvasSession,width:1,height:1,rgba:[255,0,0,255]});await delay(35);
  const updated=structuredClone(f.layout);updated.components[0].name='Water cooling';
  await f.studio.identify(updated.components[0],0,{layout:updated});
  assert(f.studio.running);assert.equal(f.studio.current.effect,'canvas:test');assert.notEqual(f.studio.canvasSession,first.canvasSession);
  assert.equal(f.studio.submitCanvasFrame({session:first.canvasSession,width:1,height:1,rgba:[255,0,0,255]}).accepted,false);
  assert(f.studio.submitCanvasFrame({session:f.studio.canvasSession,width:1,height:1,rgba:[0,255,0,255]}).accepted);await delay(35);assert(f.core.device.colors.every(c=>c===0x00ff00));
 }finally{await f.close();}
});

test('changed LED topology skips a whole component, preserves other ports and returns when restored',async()=>{
 const f=await fixture();
 try{
  const source=f.layout.components[0],changed=structuredClone(source);changed.id+='-headset';changed.name='Наушники';changed.points=source.points.slice(1,3);source.points=source.points.slice(0,1);source.name='Передние вентиляторы';f.layout.components.push(changed);await f.studio.saveLayout(f.layout);
  const saved=f.studio.getLayout();f.core.device.ledCount=2;
  const state=await f.studio.play({effect:'solid',color:0x123456,brightness:100});await delay(35);
  assert(f.studio.running);assert.equal(state.warnings.length,1);assert.match(state.warnings[0],/Наушники.*2 LED/);assert.deepEqual(f.studio.telemetry().warnings,state.warnings);assert.equal(f.core.device.colors[0],0x123456);assert.equal(f.core.device.colors[1],0x654321);assert(f.core.writes.every(batch=>batch[0].pixels.every(([led])=>led===0)));assert.deepEqual(f.studio.getLayout(),saved);
  await f.studio.stop();f.core.device.ledCount=12;await f.studio.play({effect:'solid',color:0xabcdef,brightness:100});await delay(35);
  assert.deepEqual(f.studio.state().warnings,[]);assert(f.core.device.colors.slice(0,3).every(c=>c===0xabcdef));assert.deepEqual(f.studio.getLayout(),saved);
 }finally{await f.close();}
});

test('disconnected components warn without blocking connected ones; an unavailable-only group fails clearly',async()=>{
 const f=await fixture();
 try{
  const missing=structuredClone(f.layout.components[0]);missing.id+='-missing';missing.name='Отключённая клавиатура';missing.device.serial='missing';missing.deviceKey=deviceKey(missing.device);f.layout.components.push(missing);f.layout.groups.push({id:'missing',name:'Отключённые',members:[missing.id]});await f.studio.saveLayout(f.layout);
  await f.studio.play({effect:'solid',brightness:100,color:0x123456});assert(f.studio.running);assert.equal(f.studio.warnings.length,1);assert.match(f.studio.warnings[0],/Отключённая клавиатура.*отключено/);
  await assert.rejects(f.studio.play({group:'missing'}),/нет доступных компонентов/);assert(!f.studio.running);assert.equal(f.studio.state().warnings.length,1);assert.equal(f.studio.getLayout().components.length,2);
 }finally{await f.close();}
});
