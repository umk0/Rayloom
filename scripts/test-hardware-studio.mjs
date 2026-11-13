import {CoreClient} from '../desktop/core-client.mjs';
import {StudioService} from '../desktop/studio-service.mjs';
import {discoverLayout,identity} from '../shared/spatial.mjs';
import {calibrateColor} from '../shared/color-calibration.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
// Explicitly authorized physical LED tests. All data is isolated; restore captured cache/modes in finally.
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'artifacts','hardware-'+Date.now()),nativeDir=path.join(dir,'native');fs.mkdirSync(nativeDir,{recursive:true});
const userDir=path.resolve(process.env.RAYLOOM_USER_DATA||path.join(root,'runtime','user-data')),settings=path.join(userDir,'native-hardware','OpenRGB.json');
if(fs.existsSync(settings))fs.copyFileSync(settings,path.join(nativeDir,'OpenRGB.json'));
const core=new CoreClient(root,nativeDir,{virtual:false}),studio=new StudioService(root,dir,()=>core);
const report={physicalHardwareTested:true,runtime:dir,checks:[],rates:[],effects:[],restored:false,limitation:'Driver completion and native cache are measured; actual emitted LED color and firmware refresh require visual measurement.'};
const check=name=>{report.checks.push(name);console.log('PASS',name);};let baseline;
const config={effect:'wave',group:'all',brightness:35,speed:3,scale:350,color:0xb07020,gameReactive:false,fps:60,projection:'xy'};
try{
 await core.start();for(let i=0;i<180;i++){const s=await core.call('status');if(s.pluginsReady&&s.detectionPercent===100)break;await delay(250);}
 const status=await core.call('status');assert(status.pluginsReady);assert.equal(status.detectionPercent,100);
 baseline=await core.call('devices.list');assert(baseline.length>0);report.devices=baseline.map(d=>({name:d.name,ledCount:d.ledCount,zones:d.zones.map(z=>({name:z.name,ledCount:z.ledCount}))}));fs.writeFileSync(path.join(dir,'captured-device-state.json'),JSON.stringify(baseline,null,2));
 const layoutFile=path.join(userDir,'hardware','studio','layout.json');const previous=fs.existsSync(layoutFile)?JSON.parse(fs.readFileSync(layoutFile,'utf8')):undefined;
 if(previous)fs.copyFileSync(layoutFile,path.join(dir,'user-layout-backup.json'));
 const layout=discoverLayout(baseline,previous).layout;await studio.saveLayout(layout);check('Automatic detection completed; user port sizes and geometry retained in isolated test');
 if(!process.argv.includes('--probe'))for(const effect of ['rainbow','wave','breathing','solid','ripple','com.lumen.reactor/reactor']){
  const key=effect.startsWith('com.')?studio.plugins[0].id+'/'+studio.plugins[0].effects[0].id:effect;
  await studio.play({...config,effect:key});await delay(1000);assert(studio.running,studio.error);assert(studio.metrics.frames>0);await studio.stop();check('Physical Studio '+key);
 }
 for(const effect of process.argv.includes('--probe')?['wave']:['wave','openrgb:RainbowWave'])for(const fps of [30,60,120]){
  await studio.play({...config,effect,fps});await delay(2400);const current=await core.call('devices.list');report.rates.push({effect,target:fps,host:studio.telemetry().metrics,devices:current.filter(d=>d.serial!=='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL').map(d=>({name:d.name,...d.metrics}))});assert(studio.running,studio.error);await studio.stop();console.log('FPS',effect,fps,report.rates.at(-1).host.achievedFps.toFixed(1));
 }
 if(process.argv.includes('--probe')){fs.writeFileSync(path.join(root,'artifacts/hardware-before-pacing.json'),JSON.stringify(report,null,2));throw Object.assign(Error('Probe complete'),{probeComplete:true});}
 await studio.play({...config,speed:100,brightness:150,scale:0,fps:200});assert.equal(studio.current.speed,10);assert.equal(studio.current.brightness,100);assert.equal(studio.current.fps,120);await studio.stop();check('Former invalid scene range inputs normalize without a runtime error');
 const component=layout.components.find(c=>c.points.length>2),savedCalibration=component.calibration;
 layout.groups.push({id:'test-port',name:'Temporary diagnostic port',members:[component.id]});
 for(const channelOrder of ['RGB','RBG','GRB','GBR','BRG','BGR']){
  component.calibration={channelOrder,brightness:100};await studio.saveLayout(layout);await studio.play({...config,effect:'solid',group:'test-port',color:0x804020,brightness:100});await delay(130);await studio.stop();const d=(await core.call('devices.list')).find(d=>d.name===component.device.name&&d.location===component.device.location&&d.serial===component.device.serial);assert.equal(d.colors[component.points[0].led],calibrateColor(0x804020,component.calibration));
 }component.calibration=savedCalibration;await studio.saveLayout(layout);check('All six RGB channel orders reach selected physical port with exact packed bytes');
 for(const c of layout.components){const before=(await core.call('devices.list')).find(d=>d.name===c.device.name&&d.location===c.device.location&&d.serial===c.device.serial);if(!before||c.points.some(p=>p.led>=before.ledCount)){check('Temporarily unavailable port retained without writing: '+c.name);continue;}await studio.identify(c);const after=(await core.call('devices.list')).find(d=>d.name===c.device.name&&d.location===c.device.location&&d.serial===c.device.serial);assert.deepEqual(after.colors,before.colors);assert.equal(after.activeMode,before.activeMode);check('Three red flashes and restore: '+c.name);}
 const catalog=await studio.rpc('effects','catalog');assert.equal(catalog.length,58);
 for(const effect of catalog){
  try{await studio.play({...config,effect:'openrgb:'+effect.id});await delay(320);assert(studio.running,studio.error);assert(studio.metrics.frames>0);report.effects.push({id:effect.id,started:true,frames:studio.metrics.frames,requiresSetup:['Ambient','GIFPlayer','Shaders','Layers','CustomBlink'].includes(effect.id)});await studio.stop();console.log('EFFECT',effect.id);}
  catch(e){report.effects.push({id:effect.id,error:e.message});await studio.stop();}
 }
 assert.equal(report.effects.filter(e=>e.error).length,0,JSON.stringify(report.effects.filter(e=>e.error)));check('All 58 native Effects start through Studio projection and calibrated physical writer');
 await studio.play({...config,effect:'canvas:hardware-test'});studio.submitCanvasFrame({width:2,height:2,rgba:[80,0,0,255,0,80,0,255,0,0,80,255,60,20,80,255],session:studio.canvasSession,sequence:1});await delay(350);assert(studio.metrics.frames>5);await studio.stop();check('Canvas frame samples into physical layout');
 await studio.play({...config,effect:'solid',gameReactive:true});studio.events.health=.15;await delay(200);assert(studio.running);studio.events.health=1;await delay(200);await studio.stop();check('Game health events override and return to base scene');
}catch(error){if(!error.probeComplete){report.error=error.stack;console.error(error);process.exitCode=1;}}
finally{
 await studio.stop().catch(e=>{report.stopError=e.message;});
 if(baseline)try{await core.call('devices.restore',{frames:baseline.map(d=>({device:identity(d),pixels:d.colors.map((c,i)=>[i,c]),activeMode:d.activeMode,zoneModes:d.zones.map(z=>z.activeMode)}))});await delay(300);const restored=await core.call('devices.list');for(const d of baseline){const current=restored.find(x=>x.name===d.name&&x.serial===d.serial&&x.location===d.location);assert.deepEqual(current.colors,d.colors);assert.equal(current.activeMode,d.activeMode);}report.restored=true;}catch(e){report.restoreError=e.stack;process.exitCode=1;}
 await core.stop();report.exitCode=core.exitCode;report.forcedKill=!!core.forcedKill;if(core.exitCode!==0||core.forcedKill){report.shutdownError='Native core did not exit cleanly';process.exitCode=1;}fs.writeFileSync(path.join(root,'artifacts/hardware-studio-verification.json'),JSON.stringify(report,null,2));if(process.argv.includes('--probe'))fs.writeFileSync(path.join(root,'artifacts/hardware-before-pacing.json'),JSON.stringify(report,null,2));
}
