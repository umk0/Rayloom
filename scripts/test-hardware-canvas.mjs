// Explicitly authorized hardware test of Electron HTML -> Studio -> native device output.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {setTimeout as delay} from 'node:timers/promises';
import {CoreClient} from '../desktop/core-client.mjs';import {identity} from '../shared/spatial.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
let modulePath=process.env.RAYLOOM_PLAYWRIGHT_MODULE;try{modulePath??=require.resolve('playwright');}catch{}
if(!modulePath){const cache=path.join(os.homedir(),'AppData/Local/npm-cache/_npx');for(const folder of fs.readdirSync(cache)){const candidate=path.join(cache,folder,'node_modules/playwright');if(fs.existsSync(path.join(candidate,'package.json'))){modulePath=candidate;break;}}}
const {_electron}=require(modulePath),runtime=path.join(root,'artifacts','hardware-canvas-'+Date.now()),userDir=path.resolve(process.env.RAYLOOM_USER_DATA||path.join(root,'runtime','user-data'));
for(const relative of ['native-hardware/OpenRGB.json','hardware/studio/layout.json']){const source=path.join(userDir,relative),dest=path.join(runtime,relative);if(fs.existsSync(source)){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);}}
const report={physicalHardwareTested:true,runtime,checks:[],restored:false};let app,page,baseline;
const call=(method,args={})=>page.evaluate(([method,args])=>window.rayloom.canvas(method,args),[method,args]);
const studio=(method,args={})=>page.evaluate(([method,args])=>window.rayloom.studio(method,args),[method,args]);
const wait=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await delay(200);}throw Error('Hardware Canvas timeout');};
const check=name=>{report.checks.push(name);console.log('PASS',name);};
try{
 const env={...process.env,RAYLOOM_MODE:'hardware',RAYLOOM_USER_DATA:runtime};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],cwd:root,env,timeout:60000});page=await app.firstWindow();
 await wait(async()=>{const s=await page.evaluate(()=>window.rayloom.snapshot());return s.status?.pluginsReady&&s.status.detectionPercent===100;});
 const s=await studio('state'),snap=await page.evaluate(()=>window.rayloom.snapshot());assert.equal(s.mode,'hardware');baseline=snap.devices;report.devices=snap.devices.map(d=>d.name);fs.writeFileSync(path.join(runtime,'baseline.json'),JSON.stringify(baseline,null,2));
 const layout=s.layout,c=layout.components.find(c=>snap.devices.some(d=>d.name===c.device.name&&d.location===c.device.location&&d.ledCount>c.points.at(-1).led));assert(c);
 layout.groups.push({id:'canvas-test',name:'Canvas diagnostic port',members:[c.id]});await studio('save',{layout});
 const source='<style>html,body{margin:0;overflow:hidden}</style><canvas id="c" width="128" height="128"></canvas><script>const ctx=c.getContext("2d");ctx.fillStyle="#203040";ctx.fillRect(0,0,128,128);</script>';
 await call('play',{name:'Physical Canvas test',source,config:{effect:'canvas:editor',group:'canvas-test',brightness:50,speed:1,scale:350,fps:60,color:255}});
 await wait(async()=>{const s=await studio('state');return s.metrics.frames>20;});
 let pixels=(await page.evaluate(()=>window.rayloom.snapshot())).devices.find(d=>d.name===c.device.name&&d.location===c.device.location).colors;
 assert.equal(pixels[c.points[0].led],0x201810);check('Actual isolated HTML produces exact half-brightness RGB bytes in physical core');
 c.name='Canvas temporary calibration';c.calibration={channelOrder:'GRB',brightness:100};const before=(await studio('state')).canvasSession;
 await studio('identify',{component:c.id,layout});await wait(async()=>{const r=await call('state');const s=await studio('state');return r.output&&s.metrics.frames>10&&s.canvasSession!==before;});
 pixels=(await page.evaluate(()=>window.rayloom.snapshot())).devices.find(d=>d.name===c.device.name&&d.location===c.device.location).colors;
 assert.equal(pixels[c.points[0].led],0x201018);check('Dirty layout plus port identification restores static Canvas with new GRB calibration and session');
 await call('stop');assert.equal((await studio('state')).running,false);check('Stopping Canvas releases device output');
}catch(error){report.error=error.stack;console.error(error);process.exitCode=1;}
finally{
 if(page)await studio('stop').catch(()=>{});if(app)await app.close().catch(()=>{});
 if(baseline){const restore=new CoreClient(root,path.join(runtime,'native-hardware'),{virtual:false});try{await restore.start();for(let i=0;i<180;i++){const s=await restore.call('status');if(s.pluginsReady&&s.detectionPercent===100)break;await delay(200);}await restore.call('devices.restore',{frames:baseline.map(d=>({device:identity(d),pixels:d.colors.map((c,i)=>[i,c]),activeMode:d.activeMode,zoneModes:d.zones.map(z=>z.activeMode)}))});await restore.call('devices.flush');const restored=await restore.call('devices.list');for(const d of baseline){const match=restored.find(x=>x.name===d.name&&x.serial===d.serial&&x.location===d.location);assert.deepEqual(match.colors,d.colors);assert.equal(match.activeMode,d.activeMode);}report.restored=true;}catch(error){report.restoreError=error.stack;process.exitCode=1;}finally{await restore.stop();report.restoreCoreExit=restore.exitCode;if(restore.exitCode!==0)process.exitCode=1;}}
 fs.writeFileSync(path.join(root,'artifacts/hardware-canvas-verification.json'),JSON.stringify(report,null,2));
}
