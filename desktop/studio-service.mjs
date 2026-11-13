import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import {worldPoints,validateLayout,deviceKey,identity} from '../shared/spatial.mjs';
import {migrateLegacyLayout} from '../shared/legacy-brand-migration.mjs';
import {normalizeSceneConfig} from '../shared/scene-config.mjs';
import {nativeEffectSettings} from '../shared/native-effect-config.mjs';
import {BUILTIN_EFFECTS} from '../shared/builtin-effects.mjs';
import {normalizeEffectParameterValues} from '../shared/effect-parameters.mjs';
import {calibrateColor,normalizeCalibration,logicalColor,inferChannelOrder,CALIBRATION_PROBES} from '../shared/color-calibration.mjs';
import {validateManifest} from '../sdk/runtime.mjs';
import {projectSampleIndices} from './frame-renderer.mjs';

const emptyMetrics=()=>({targetFps:60,achievedFps:0,frameMs:0,renderMs:0,sendMs:0,droppedFrames:0,frames:0,kind:'idle',sourceFps:0,sourceFrames:0});

export class StudioService {
 constructor(root,dataDir,getCore){
  this.root=root;this.dir=path.join(dataDir,'studio');this.getCore=getCore;
  fs.mkdirSync(this.dir,{recursive:true});
  this.running=false;this.inflight=false;this.frame=0;this.error='';this.warnings=[];this.events={health:1,ammo:1};this.current=null;
  this.metrics=emptyMetrics();this.workerPending=new Map();this.workerSequence=0;this.generation=0;this.loadPlugins();
 }
 file(name){return path.join(this.dir,name+'.json');}
 read(name,fallback){try{return JSON.parse(fs.readFileSync(this.file(name),'utf8'));}catch{return fallback;}}
 write(name,value){fs.writeFileSync(this.file(name)+'.tmp',JSON.stringify(value,null,2));fs.renameSync(this.file(name)+'.tmp',this.file(name));}
 loadPlugins(){
  this.plugins=[];this.pluginErrors=[];
  const dirs=[path.join(this.root,'sdk/examples/reactor'),path.join(this.dir,'extensions')];
  fs.mkdirSync(dirs[1],{recursive:true});
  for(const dir of fs.readdirSync(dirs[1],{withFileTypes:true}).filter(d=>d.isDirectory()))dirs.push(path.join(dirs[1],dir.name));
  for(const dir of dirs){
   const f=path.join(dir,'manifest.json');if(!fs.existsSync(f))continue;
   try{
    if(fs.statSync(f).size>256000)throw Error('Manifest too large');
    const m=validateManifest(JSON.parse(fs.readFileSync(f,'utf8')));
    if(this.plugins.some(p=>p.id===m.id))throw Error('Duplicate plugin ID');
    this.plugins.push(m);
   }catch(e){this.pluginErrors.push({folder:path.basename(dir),error:e.message});}
  }
 }
  getLayout(){return migrateLegacyLayout(this.read('layout',{version:1,components:[],groups:[{id:'all',name:'Всё пространство',members:[]}],scenes:[]}));}
 state(){
  return {layout:this.getLayout(),running:this.running,frame:this.frame,error:this.error,warnings:[...this.warnings],current:this.current,
   metrics:this.liveMetrics(),canvasSession:this.canvasSession??null,
   identifying:this.identification?{component:this.identification.component,flash:this.identification.flash}:null,
   calibration:this.calibrationState(),
   plugins:this.plugins,pluginErrors:this.pluginErrors,events:this.events,templates:this.read('templates',[]),scenes:this.read('scenes',[])};
 }
 liveMetrics(){
  const now=performance.now(),last=this.completedTimes?.at(-1),sourceLast=this.sourceTimes?.at(-1),age=last===undefined?null:now-last,threshold=Math.max(500,2500/this.metrics.targetFps);
  return {...this.metrics,achievedFps:this.running&&age!==null&&age<threshold?this.metrics.achievedFps:0,sourceFps:this.running&&sourceLast!==undefined&&now-sourceLast<threshold?this.metrics.sourceFps:0,frameAgeMs:age,inflight:this.inflight};
 }
 telemetry(){return {running:this.running,current:this.current,error:this.error,warnings:[...this.warnings],metrics:this.liveMetrics(),events:{...this.events},canvasSession:this.canvasSession??null,calibration:this.calibrationState(),identifying:this.identification?{component:this.identification.component,flash:this.identification.flash}:null};}
 async saveLayout(layout,{resume=false}={}){
  // Invalid drafts must never interrupt a working scene. Loading a profile
  // retains the historical stopped-by-default behavior; editing opts in.
  const saved=structuredClone(validateLayout(layout));
  // A newer save can arrive after the previous save paused output. Carry its
  // original intent forward, but never across stop/play generation changes.
  const pending=this.layoutSaveIntent?.generation===this.generation?this.layoutSaveIntent:null;
  const playback=this.running?structuredClone(this.current):pending?.playback??null;
  const previous=resume?playback:null;
  const original=pending?.original??this.getLayout();
  const oldFrames=pending?.oldFrames??(playback?structuredClone(this.frames??[]):[]);
  const generation=this.cancelOutput();
  const intent={generation,playback,original,oldFrames};this.layoutSaveIntent=intent;
  return this.control(async()=>{
   try{
    if(generation!==this.generation)return this.state();
    await this.stopOutput();if(generation!==this.generation)return this.state();
    this.write('layout',saved);
    if(previous){
     const devices=new Map(this.diagnosticDevices(await this.getCore().call('devices.list')).map(d=>[deviceKey(d),d]));
     if(generation!==this.generation)return this.state();
     const group=saved.groups.find(g=>g.id===previous.group);
     const points=group?worldPoints(saved,group.id):[];
     const validComponents=new Set(saved.components.filter(c=>c.enabled&&devices.has(c.deviceKey)&&c.points.every(p=>p.led<devices.get(c.deviceKey).ledCount)).map(c=>c.id));
     const livePoints=points.filter(p=>validComponents.has(p.component));
     const retained=new Set(livePoints.map(p=>p.deviceKey+'\0'+p.led));
     const retired=oldFrames.map(frame=>({device:frame.device,pixels:frame.pixels.filter(([led])=>devices.has(deviceKey(frame.device))&&led<devices.get(deviceKey(frame.device)).ledCount&&!retained.has(deviceKey(frame.device)+'\0'+led)).map(([led])=>[led,0])})).filter(frame=>frame.pixels.length);
     // Disabled, removed and ungrouped LEDs must not retain the last frame.
     if(retired.length){await this.getCore().call('devices.frame',{frames:retired});await this.getCore().call('devices.flush');}
     if(generation!==this.generation)return this.state();
     if(livePoints.length)await this.playOutput(previous,generation);
     else{this.error='';this.warnings=['В выбранной группе не осталось доступных компонентов. Расположение сохранено, подсветка остановлена.'];}
    }
    return this.state();
   }catch(error){
    if(generation!==this.generation)return this.state();
    // A failed disk write or device operation is not an instruction to stop the
    // previous scene. Roll back best-effort without hiding the original error.
    let restored=false;try{this.write('layout',original);restored=true;}catch{try{restored=JSON.stringify(this.getLayout())===JSON.stringify(original);}catch{}}
    if(restored&&playback&&generation===this.generation)try{await this.playOutput(playback,generation);}catch{}
    if(generation===this.generation)this.error=error.message;
    throw error;
   }finally{if(this.layoutSaveIntent===intent)this.layoutSaveIntent=null;}
  });
 }
 async setDeviceEnabled({deviceKey:key,enabled,layout}={}){
  if(typeof enabled!=='boolean'||typeof key!=='string')throw Error('Выберите устройство и его состояние.');
  if(this.calibration||this.identification)throw Error('Сначала завершите проверку подсветки.');
  const saved=structuredClone(validateLayout(layout??this.getLayout()));
  if(!saved.components.some(c=>c.deviceKey===key))throw Error('Устройство отсутствует в пространстве.');
  saved.components=saved.components.map(c=>c.deviceKey===key?{...c,enabled}:c);
  const previous=this.running?structuredClone(this.current):null,generation=this.cancelOutput();
  return this.control(async()=>{
   if(generation!==this.generation)return this.state();
   const original=this.getLayout(),nativeBackup=previous?null:await this.captureNativeState();let snapshot=[];
   try{
    await this.stopOutput();if(generation!==this.generation)return this.state();
    const devices=this.diagnosticDevices(await this.getCore().call('devices.list'));
    snapshot=this.captureDeviceColors(devices.filter(d=>deviceKey(d)===key));
    // Stop native writers before turning off a controller, otherwise its LEDs
    // would immediately be relit by an effect, receiver, or scheduled task.
    if(previous||(!enabled&&snapshot.length))await this.quietNative();
    if(!enabled&&snapshot.length)await this.blackoutDevices(snapshot);
    if(generation!==this.generation){if(snapshot.length)await this.restoreDeviceColors(snapshot);return this.state();}
    this.write('layout',saved);
    const group=saved.groups.find(g=>g.id===previous?.group),available=new Map(devices.map(d=>[deviceKey(d),d]));
    const hasTargets=group&&saved.components.some(c=>c.enabled&&(group.id==='all'||group.members.includes(c.id))&&c.points.length&&available.has(c.deviceKey)&&c.points.every(p=>p.led<available.get(c.deviceKey).ledCount));
    if(previous&&hasTargets)await this.playOutput(previous,generation);
    else{this.error='';this.warnings=previous?['Все доступные компоненты выбранной группы выключены. Выберите устройства и включите эффект.']:[];}
    return this.state();
   }catch(error){
    this.write('layout',original);
    try{if(snapshot.length)await this.restoreDeviceColors(snapshot);}catch{}
    if(generation===this.generation)try{if(previous)await this.playOutput(previous,generation);else await this.restoreNativeState(nativeBackup);}catch{}
    throw error;
   }
  });
 }
 rpc(id,method,args={}){return this.getCore().call('plugin.rpc',{plugin:'org.openrgb.openrgb'+id+'plugin',request:{method,...args}});}
 // Lifecycle mutations share one queue. Cancellation is synchronous, so a stop
 // also interrupts an active identify pulse while waiting for its restoration.
 control(action){const next=(this.controlTask??Promise.resolve()).catch(()=>{}).then(action);this.controlTask=next;return next;}
 cancelOutput(){
  this.generation++;this.running=false;clearTimeout(this.timer);this.canvasSession=null;
  if(this.identification)this.identification.cancelled=true;
  return this.generation;
 }
 stop(){this.cancelOutput();return this.control(()=>this.stopOutput());}
 async stopOutput(){
  if(this.calibration)await this.finishCalibrationOutput({resume:false,reason:'interrupted'});
  if(this.identification){this.identification.cancelled=true;await this.identifyTask?.catch(()=>{});}
  if(this.frameTask)await this.frameTask.catch(()=>{});
  if(this.paceTask)await this.paceTask.catch(()=>{});
  let failure;
  if(this.outputQueued){try{await this.getCore().call('devices.flush');this.outputQueued=false;}catch(e){failure=e;}}
  if(this.worker){const worker=this.worker;this.worker=null;await worker.terminate();}
  if(this.nativeRunning){this.nativeRunning=false;try{await this.rpc('effects','stop');}catch(e){failure??=e;}}
  if(this.mapIndex!==undefined){const index=this.mapIndex;this.mapIndex=undefined;try{await this.rpc('visualmap','register',{index,enabled:false});}catch(e){failure??=e;}}
  this.nativeSource=null;this.lastCanvas=null;
  if(failure)throw failure;
 }
 async startWorker(config,effect){
  const worker=new Worker(new URL('./frame-worker.mjs',import.meta.url));
  this.worker=worker;
  worker.on('message',message=>{
   const pending=this.workerPending.get(message.id);if(!pending)return;
   clearTimeout(pending.timer);this.workerPending.delete(message.id);
   message.error?pending.reject(Error(message.error)):pending.resolve(message);
  });
  const fail=error=>{for(const [id,pending] of this.workerPending){clearTimeout(pending.timer);pending.reject(error);this.workerPending.delete(id);}};
  worker.on('error',fail);worker.on('exit',code=>fail(Error('Вычислитель кадров завершён ('+code+').')));
  await this.workerCall({type:'init',points:this.points,config,effect});
 }
 workerCall(message){
  if(!this.worker)return Promise.reject(Error('Вычислитель кадров не запущен.'));
  const id=++this.workerSequence;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.workerPending.delete(id);reject(Error('Вычисление кадра заняло слишком много времени.'));},5000);
   this.workerPending.set(id,{resolve,reject,timer});this.worker.postMessage({...message,id});
  });
 }
 prepareTargets(points,available){
  const components=new Map(),skipped=new Set();this.warnings=[];
  for(const p of points){if(!components.has(p.component))components.set(p.component,[]);components.get(p.component).push(p);}
  for(const [id,componentPoints] of components){
   const first=componentPoints[0],name=first.componentName??first.device?.name??'Компонент',device=available.get(first.deviceKey);
   if(!device){skipped.add(id);this.warnings.push('«'+name+'»: устройство отключено. Настройка сохранена, компонент временно пропущен.');continue;}
   if(componentPoints.some(p=>!Number.isInteger(p.led)||p.led<0||p.led>=device.ledCount)){
    skipped.add(id);this.warnings.push('«'+name+'»: сохранённая матрица не соответствует устройству ('+device.ledCount+' LED). Компонент временно пропущен; проверьте подключение или матрицу.');
   }
  }
  // Skip the whole component, not just the missing LEDs: partial output could
  // misidentify a port after a wireless device reports a different topology.
  this.points=points.filter(p=>!skipped.has(p.component));
  if(!this.points.length)throw Error('В выбранной группе нет доступных компонентов. Подключите устройства или проверьте их матрицы.');
  this.devices=available;this.targets=[];this.targetCalibration=new Map();const devices=new Map();
  for(const p of this.points){
   const d=available.get(p.deviceKey);
   if(!devices.has(p.deviceKey))devices.set(p.deviceKey,{device:identity(d),pixels:new Map()});
   const pixels=devices.get(p.deviceKey).pixels;
   if(!pixels.has(p.led))pixels.set(p.led,[p.led,0]);
   this.targets.push(pixels.get(p.led));
   this.targetCalibration.set(pixels.get(p.led),p.calibration);
  }
  this.frames=[...devices.values()].map(d=>({device:d.device,pixels:[...d.pixels.values()]}));
 }
 async play(input){
  // Validate before taking ownership: a malformed edit must not stop a working scene.
  const config=normalizeSceneConfig(input,this.current??{});
  this.validateScene(config);
  const generation=this.cancelOutput();
  return this.control(()=>generation===this.generation?this.playOutput(config,generation):this.state());
 }
 validateScene(config){
  const layout=validateLayout(this.getLayout());
  if(!layout.groups.some(g=>g.id===config.group))throw Error('Эта группа удалена. Выберите другую группу.');
  const points=worldPoints(layout,config.group);if(!points.length)throw Error('Добавьте устройства в выбранную группу.');
  const effect=this.plugins.flatMap(p=>p.effects.map(e=>({key:p.id+'/'+e.id,value:e}))).find(e=>e.key===config.effect)?.value;
  if(!config.effect.startsWith('openrgb:')&&!config.effect.startsWith('canvas:')&&!BUILTIN_EFFECTS.some(e=>e.id===config.effect)&&!effect)throw Error('Эффект не найден. Выберите его в библиотеке.');
  if(effect)normalizeEffectParameterValues(effect.parameters??[],config.effectParameters?.[config.effect]??{});
  return {points,effect};
 }
 async playOutput(config,generation){
  const {points,effect}=this.validateScene(config);
  await this.stopOutput();
  const checkCurrent=()=>{if(generation!==this.generation)throw Error('Запуск отменён новой командой.');};
  try{
   checkCurrent();
   await this.quietNative();
   checkCurrent();
   const available=new Map((await this.getCore().call('devices.list')).map(d=>[deviceKey(d),d]));
   checkCurrent();
   this.prepareTargets(points,available);
   await this.getCore().call('devices.prepare',{frames:this.frames.map(f=>({device:f.device,pixels:[]}))});
   checkCurrent();
   if(config.effect.startsWith('openrgb:'))await this.prepareNative(config);
   checkCurrent();
   await this.startWorker(config,effect);
   checkCurrent();
   this.current=config;this.error='';this.started=performance.now();this.running=true;
   this.metrics={...emptyMetrics(),targetFps:config.fps,kind:config.effect.startsWith('openrgb:')?'native':config.effect.startsWith('canvas:')?'canvas':'spatial'};
   this.completedTimes=[];this.sourceTimes=[];this.firstCompletedAt=null;this.lastCanvas=null;this.lastCanvasSequence=-1;
   if(this.metrics.kind==='canvas')this.canvasSession=randomUUID();
   this.nextAt=this.started;await this.runFrame();this.schedule();
   return this.state();
  }catch(e){await this.stopOutput();if(generation!==this.generation)return this.state();this.error=e.message;throw e;}
 }
 async quietNative(){
  for(const id of ['effects','hardwaresync','e131receiver','scheduler','httphook'])await this.rpc(id,'stop');
  const maps=await this.rpc('visualmap','config.get');
  for(let i=0;i<maps.maps.length;i++)if(maps.maps[i].registered)await this.rpc('visualmap','register',{index:i,enabled:false});
 }
 schedule(){
  if(!this.running)return;
  const period=1000/this.current.fps;this.nextAt+=period;
  const now=performance.now();
  // A slow frame starts its successor immediately; skipping to a future grid point
  // would unnecessarily halve throughput when a frame only slightly exceeds budget.
  if(this.nextAt<now)this.nextAt=now;
  const generation=this.generation,waitMs=Math.max(0,this.nextAt-performance.now());
  const resume=async()=>{if(!this.running||generation!==this.generation)return;await this.runFrame();if(generation===this.generation)this.schedule();};
  if(this.current.fps>60){
   // Windows Node timers may round an 8ms delay to 15.6ms. The native host's
   // asynchronous precise timer paces this callback without spinning a CPU.
   const task=this.getCore().call('runtime.wait',{ms:Math.min(100,waitMs)});this.paceTask=task;
   task.then(()=>{if(this.paceTask===task)this.paceTask=null;return resume();}).catch(e=>{if(generation===this.generation){this.error=e.message;this.running=false;}});
  }else this.timer=setTimeout(resume,waitMs);
 }
 runFrame(){
  if(!this.running||this.inflight)return Promise.resolve();
  if(this.metrics.kind==='canvas'&&!this.lastCanvas)return Promise.resolve();
  this.inflight=true;
  const task=this.tick().finally(()=>{this.inflight=false;if(this.frameTask===task)this.frameTask=null;});
  this.frameTask=task;return task;
 }
 async tick(){
  const begun=performance.now();
  try{
   let source;const kind=this.metrics.kind;
   if(kind==='native'){
    source=await this.getCore().call('devices.sample',{device:this.nativeSource.device,indices:this.nativeSource.indices});
    if(!Array.isArray(source)||source.length!==this.points.length)throw Error('Ядро вернуло неполный кадр эффекта.');
   }
   const result=await this.workerCall({type:'render',kind,t:(begun-this.started)/1000,events:this.events,colors:source,frame:kind==='canvas'?this.lastCanvas:undefined});
   // Stop can arrive while the worker calculates; never send that late frame.
   if(!this.running)return;
   for(let i=0;i<result.colors.length;i++)this.targets[i][1]=result.colors[i];
   const sending=performance.now();this.outputQueued=true;await this.getCore().call('devices.frame',{frames:this.frames});const completed=performance.now();
   this.frame++;this.metrics.frames++;this.metrics.renderMs=result.renderMs;this.metrics.sendMs=completed-sending;this.metrics.frameMs=completed-begun;
   this.firstCompletedAt??=completed;
   this.metrics.droppedFrames=Math.max(this.metrics.droppedFrames,Math.floor((completed-this.firstCompletedAt)*this.current.fps/1000)+1-this.metrics.frames,0);
   this.completedTimes.push(completed);while(this.completedTimes.length&&this.completedTimes[0]<completed-2000)this.completedTimes.shift();
   this.metrics.achievedFps=this.completedTimes.length>1?(this.completedTimes.length-1)*1000/(completed-this.completedTimes[0]):0;
   if(this.onFrame&&completed-(this.lastPreviewAt??0)>=1000/30){
    this.lastPreviewAt=completed;
    try{this.onFrame({logical:true,devices:this.frames.map(f=>({deviceKey:deviceKey(f.device),pixels:f.pixels.map(p=>[p[0],logicalColor(p[1],this.targetCalibration.get(p))])}))});}catch{}
   }
  }catch(e){this.error=e.message;this.running=false;clearTimeout(this.timer);}
 }
 submitCanvasFrame({width,height,rgba,session,sequence}){
  if(!this.running||this.metrics.kind!=='canvas'||session!==this.canvasSession)return {accepted:false,reason:'stale-session'};
  const next=sequence??this.lastCanvasSequence+1;
  if(!Number.isSafeInteger(next)||next<0)throw Error('Недопустимый номер кадра Canvas.');
  if(next<=this.lastCanvasSequence)return {accepted:false,reason:'old-frame'};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>128||height>128)throw Error('Размер Canvas должен быть от 1 × 1 до 128 × 128.');
  if(!(Array.isArray(rgba)||ArrayBuffer.isView(rgba))||rgba.length!==width*height*4)throw Error('Canvas должен передать полный RGBA-кадр.');
  const bytes=new Uint8Array(rgba.length);
  for(let i=0;i<rgba.length;i++){const value=rgba[i];if(!Number.isInteger(value)||value<0||value>255)throw Error('Цвет Canvas должен содержать байты 0…255.');bytes[i]=value;}
  this.lastCanvasSequence=next;this.lastCanvas={width,height,rgba:bytes};
  const now=performance.now();this.sourceTimes.push(now);while(this.sourceTimes.length&&this.sourceTimes[0]<now-2000)this.sourceTimes.shift();
  this.metrics.sourceFrames++;this.metrics.sourceFps=this.sourceTimes.length>1?(this.sourceTimes.length-1)*1000/(now-this.sourceTimes[0]):0;
  return {accepted:true,sequence:next};
 }
 async prepareNative(config){
  const effect=(await this.rpc('effects','catalog')).find(e=>e.id===config.effect.slice(8));
  if(!effect)throw Error('Эффект OpenRGB не найден.');
  const name='Lumen Spatial';let maps=await this.rpc('visualmap','config.get'),index=maps.maps.findIndex(m=>m.name===name);
  if(index<0){maps=await this.rpc('visualmap','add',{name});index=maps.maps.length-1;}
  // A source-only virtual canvas. Physical output goes through our calibrated writer.
  const map={source_only:true,grid_settings:{w:128,h:128,grid_size:1,show_grid:true,show_bounds:true,snap_to_grid:false,auto_load:false,auto_register:false,hide_members:false},ctrl_zones:[]};
  await this.rpc('visualmap','map.set',{index,name,map});this.mapIndex=index;await this.rpc('visualmap','register',{index,enabled:true});
  let target;
  for(let i=0;i<30;i++){target=(await this.getCore().call('devices.list')).find(d=>d.serial==='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL'&&d.name===name);if(target)break;await delay(100);}
  if(!target)throw Error('Не удалось создать холст эффекта OpenRGB.');
  this.nativeSource={device:identity(target),indices:projectSampleIndices(this.points,128,128,config.projection)};
  const e=nativeEffectSettings(effect,config);
  e.ControllerZones=[{...identity(target),description:target.description,version:target.version,zone_idx:0,reverse:false,self_brightness:100,is_segment:false,segment_idx:-1}];
  await this.rpc('effects','scene.apply',{profile:{version:2,Effects:[e]}});this.nativeRunning=true;
 }
 async captureNativeState(){
  const keys=['effects','hardwaresync','e131receiver','scheduler','httphook','visualmap'],out={};
  for(const key of keys)try{out[key]=await this.rpc(key,key==='effects'?'scene.get':'config.get');}catch{}
  return out;
 }
 async restoreNativeState(saved){
  if(!saved)return;
  if(saved.visualmap)for(let i=0;i<saved.visualmap.maps.length;i++)if(saved.visualmap.maps[i].registered)await this.rpc('visualmap','register',{index:i,enabled:true});
  if(saved.hardwaresync?.measures.some(m=>m.running))await this.rpc('hardwaresync','config.set',{measures:saved.hardwaresync.measures});
  if(saved.e131receiver?.running)await this.rpc('e131receiver','start');
  if(saved.scheduler?.tasks.some(t=>t.run))await this.rpc('scheduler','config.set',{tasks:saved.scheduler.tasks});
  if(saved.httphook?.running)await this.rpc('httphook','start');
  if(saved.effects?.Effects.some(e=>e.AutoStart))await this.rpc('effects','scene.apply',{profile:saved.effects});
 }
 diagnosticDevices(devices){return devices.filter(d=>d.connected!==false&&d.serial!=='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL'&&d.ledCount>0);}
 captureDeviceColors(devices){return this.diagnosticDevices(devices).map(d=>({device:identity(d),pixels:Array.from({length:d.ledCount},(_,i)=>[i,d.colors?.[i]??0]),activeMode:d.activeMode,modeCount:d.modeCount,zoneModes:d.zones?.map(z=>z.activeMode)}));}
 async blackoutDevices(snapshot){
  await this.getCore().call('devices.prepare',{frames:snapshot.map(f=>({device:f.device,pixels:[]}))});
  await this.getCore().call('devices.frame',{frames:snapshot.map(f=>({device:f.device,pixels:f.pixels.map(([i])=>[i,0])}))});
  await this.getCore().call('devices.flush');
 }
 async restoreDeviceColors(snapshot){
  const live=new Map(this.diagnosticDevices(await this.getCore().call('devices.list')).map(d=>[deviceKey(d),d]));let failure;
  for(const saved of snapshot){
   const current=live.get(deviceKey(saved.device));if(!current)continue;
   const frame={device:saved.device,pixels:saved.pixels.filter(([i])=>i<current.ledCount)};
   try{
    if(Number.isInteger(saved.activeMode)&&saved.activeMode>=0&&saved.activeMode<current.modeCount){
     frame.activeMode=saved.activeMode;
     if(saved.zoneModes?.length===current.zones?.length)frame.zoneModes=saved.zoneModes;
     await this.getCore().call('devices.restore',{frames:[frame]});
    }else await this.getCore().call('devices.frame',{frames:[frame]});
   }catch(error){failure??=error;}
  }
  try{await this.getCore().call('devices.flush');}catch(error){failure??=error;}
  if(failure)throw failure;
 }
 calibrationState(heartbeat=false){
  const c=this.calibration;if(!c)return null;
  if(heartbeat&&!c.cancelled)this.renewCalibrationLease(c);
  return {session:c.session,component:c.component.id,name:c.component.name,phase:c.phase,step:c.answers.length,probe:CALIBRATION_PROBES[Math.min(c.answers.length,2)],answers:[...c.answers],channelOrder:c.channelOrder??null,expiresAt:c.expiresAt};
 }
 renewCalibrationLease(c){
  clearTimeout(c.timer);const now=Date.now();c.expiresAt=Math.min(c.started+600000,now+(this.calibrationTimeoutMs??120000));
  c.timer=setTimeout(()=>{if(this.calibration===c)void this.cancelCalibration({session:c.session,resume:true,reason:'timeout'}).catch(error=>{this.error='Не удалось восстановить подсветку после калибровки: '+error.message;});},Math.max(1,c.expiresAt-now));c.timer.unref?.();
 }
 async beginCalibration({component:componentId,layout}={}){
  if(this.calibration||this.identification)throw Error('Сначала завершите текущую проверку подсветки.');
  const saved=structuredClone(validateLayout(layout??this.getLayout())),component=saved.components.find(c=>c.id===componentId);
  if(!component||!component.points.length)throw Error('Выберите порт со светодиодами для калибровки.');
  const previous=this.running?structuredClone(this.current):null,generation=this.cancelOutput();
  return this.control(async()=>{
   if(generation!==this.generation)return null;
   const nativeBackup=previous?null:await this.captureNativeState();await this.stopOutput();
   if(generation!==this.generation)return null;
   const c={session:randomUUID(),component,layout:saved,previous,nativeBackup,generation,started:Date.now(),answers:[],phase:'question',snapshot:[],cancelled:false};this.calibration=c;
   try{
    await this.quietNative();
    const devices=await this.getCore().call('devices.list'),device=this.diagnosticDevices(devices).find(d=>deviceKey(d)===component.deviceKey);
    if(!device||component.points.some(p=>p.led>=device.ledCount))throw Error('Этот порт сейчас недоступен. Проверьте подключение устройства.');
    c.device=device;c.snapshot=this.captureDeviceColors(devices);
    await this.blackoutDevices(c.snapshot);await this.showCalibrationProbe(c);this.renewCalibrationLease(c);return this.calibrationState();
   }catch(error){await this.finishCalibrationOutput({resume:true,reason:'error'});throw error;}
  });
 }
 requireCalibration(session){const c=this.calibration;if(!c||c.session!==session||c.cancelled)throw Error('Калибровка завершена или отменена. Начните её заново.');return c;}
 async showCalibrationProbe(c){
  const raw={R:0x0000ff,G:0x00ff00,B:0xff0000},probe=CALIBRATION_PROBES[c.answers.length];
  // Ignore the previous channel correction: these questions measure raw routing.
  await this.getCore().call('devices.frame',{frames:[{device:identity(c.device),pixels:c.component.points.map(p=>[p.led,probe?raw[probe]:0])}]});await this.getCore().call('devices.flush');
 }
 answerCalibration({session,color}={}){
  return this.control(async()=>{
   const c=this.requireCalibration(session);if(c.phase!=='question')throw Error('Ответы уже собраны. Примените коррекцию или начните заново.');
   if(![...CALIBRATION_PROBES,'dark','mixed'].includes(color))throw Error('Выберите цвет, который видите на устройстве.');
   if(c.answers.includes(color))throw Error('Этот цвет уже был выбран. Для обычной RGB-коррекции должны получиться три разных цвета. Если цвета смешаны, выберите «Другой или смешанный».');
   try{
   if(['dark','mixed'].includes(color)){c.phase='unsupported';c.channelOrder=null;await this.getCore().call('devices.frame',{frames:[{device:identity(c.device),pixels:c.component.points.map(p=>[p.led,0])}]});await this.getCore().call('devices.flush');this.renewCalibrationLease(c);return this.calibrationState();}
   c.answers.push(color);
   if(c.answers.length===3){c.channelOrder=inferChannelOrder(c.answers);c.phase='review';await this.getCore().call('devices.frame',{frames:[{device:identity(c.device),pixels:c.component.points.map(p=>[p.led,calibrateColor(0x0000ff,{channelOrder:c.channelOrder,brightness:100})])}]});await this.getCore().call('devices.flush');}
   else await this.showCalibrationProbe(c);
   this.renewCalibrationLease(c);return this.calibrationState();
   }catch(error){await this.finishCalibrationOutput({resume:true,reason:'error'});throw error;}
  });
 }
 applyCalibration({session}={}){
  return this.control(async()=>{
   const c=this.requireCalibration(session);if(c.phase!=='review'||!c.channelOrder)throw Error('Ответьте на три вопроса о цвете, прежде чем применять коррекцию.');
   const saved=structuredClone(c.layout),component=saved.components.find(p=>p.id===c.component.id);component.calibration={...normalizeCalibration(component.calibration),channelOrder:c.channelOrder};validateLayout(saved);this.write('layout',saved);
   await this.finishCalibrationOutput({resume:true,reason:'applied'});return this.state();
  });
 }
 cancelCalibration({session,resume=true,reason='cancelled'}={}){
  const c=this.calibration;if(!c)return Promise.resolve(this.state());if(session&&c.session!==session)return Promise.reject(Error('Эта калибровка уже завершена.'));
  c.cancelled=true;clearTimeout(c.timer);return this.control(async()=>{if(this.calibration===c)await this.finishCalibrationOutput({resume,reason});return this.state();});
 }
 async finishCalibrationOutput({resume,reason}){
  const c=this.calibration;if(!c)return;this.calibration=null;clearTimeout(c.timer);let failure;
  try{if(c.snapshot.length)await this.restoreDeviceColors(c.snapshot);}catch(error){failure=error;}
  if(resume&&c.generation===this.generation)try{if(c.previous)await this.playOutput(c.previous,c.generation);else await this.restoreNativeState(c.nativeBackup);}catch(error){failure??=error;}
  try{this.onCalibrationEnd?.({session:c.session,reason,resumed:this.running});}catch{}
  if(failure)throw failure;
 }
 async identify(component,index,options={}){
  if(this.identification)throw Error('Дождитесь окончания определения порта.');
  if(options.layout!==undefined){
   const layout=structuredClone(validateLayout(options.layout));
   component=layout.components.find(c=>c.id===component.id);
   if(!component)throw Error('Выберите существующий компонент для проверки.');
   options={...options,layout};
  }
  normalizeCalibration(component.calibration);
  const previous=this.running?structuredClone(this.current):null,generation=this.cancelOutput();
  return this.control(()=>generation===this.generation?this.identifyOutput(component,index,options,previous,generation):false);
 }
 async identifyOutput(component,index,options,previous,generation){
  const calibration=normalizeCalibration(component.calibration);
  const nativeBackup=previous?null:await this.captureNativeState();
  await this.stopOutput();
  if(generation!==this.generation)return false;
  if(options.layout)this.write('layout',options.layout);
  const token={component:component.id,cancelled:false,flash:0};this.identification=token;
  const task=(async()=>{
   let device,snapshot;
   try{
    await this.quietNative();
    const devices=await this.getCore().call('devices.list');device=this.diagnosticDevices(devices).find(d=>deviceKey(d)===component.deviceKey);
    if(!device)throw Error('Устройство отключено.');
    if(index!==undefined&&!component.points.some(p=>p.led===index))throw Error('Выберите существующий LED.');
    const points=index===undefined?component.points:component.points.filter(p=>p.led===index);
    if(points.some(p=>p.led<0||p.led>=device.ledCount))throw Error('Диапазон LED выходит за пределы устройства.');
    const color=options.color??(index===undefined?0x0000ff:0xffffff);
    if(!Number.isInteger(color)||color<0||color>0xffffff)throw Error('Недопустимый цвет проверки.');
    snapshot=this.captureDeviceColors(devices);
    await this.blackoutDevices(snapshot);
    // Diagnostic flashes must remain visible even when the component is dimmed to zero.
    const send=on=>this.getCore().call('devices.frame',{frames:[{device:identity(device),pixels:points.map(p=>[p.led,on?calibrateColor(color,{...calibration,brightness:100}):0])}]});
    const wait=async ms=>{const until=performance.now()+ms;while(!token.cancelled&&performance.now()<until)await delay(Math.min(30,until-performance.now()));};
    const flashes=index===undefined?3:1,onMs=index===undefined?500:750,offMs=index===undefined?500:0;
    for(let i=0;i<flashes&&!token.cancelled;i++){token.flash=i+1;await send(true);await wait(onMs);if(token.cancelled)break;if(offMs){await send(false);await wait(offMs);}}
   }finally{
    try{
     if(snapshot)await this.restoreDeviceColors(snapshot);
    }finally{
     this.identification=null;this.identifyTask=null;
     if(!token.cancelled&&generation===this.generation){if(previous)await this.playOutput(previous,generation);else await this.restoreNativeState(nativeBackup);}
    }
   }
   return !token.cancelled;
  })();
  this.identifyTask=task;return task;
 }
}
