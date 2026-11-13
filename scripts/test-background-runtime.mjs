// Runs a real detached Node owner and native core, exclusively with virtual LEDs.
// Uses an isolated configuration directory; never changes startup or physical RGB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';
import {RuntimeConnection} from '../desktop/runtime-wire.mjs';
import {discoverLayout,deviceKey} from '../shared/spatial.mjs';
import {effectProfile,effectsId} from '../desktop/effects.mjs';

const root=path.resolve(import.meta.dirname,'..');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-background-virtual-'));
fs.writeFileSync(path.join(directory,'app-settings.json'),JSON.stringify({mode:'virtual',autoStart:false,continueOnClose:true}));
const report={started:new Date().toISOString(),directory,physicalHardwareTested:false,checks:[]};
let client;
const check=async(name,action)=>{await action();report.checks.push(name);console.log('PASS',name);};
const wait=async(label,read,timeout=15000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await delay(80);}throw Error('Timeout: '+label);};
const studio=(method='state',args={})=>client.call('studio',{method,args});
const canvas=(method='state',args={})=>client.call('canvas',{method,args});
const effectRpc=(method,args={})=>client.call('core',{method:'plugin.rpc',params:{plugin:effectsId,request:{method,...args}}});
const devices=async()=>{const value=await client.call('snapshot');assert.equal(value.mode,'virtual');assert(value.status?.virtual,'No physical hardware allowed');return value.devices.filter(d=>d.serial!=='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL');};
const connect=async()=>{client=await connectRuntime(root,directory,'virtual');await wait('native virtual core ready',async()=>{const state=await client.call('runtime.state');if(state.error)throw Error(state.error);assert.equal(state.mode,'virtual');return state.ready;},95000);await devices();return client;};
const shutdown=async()=>{if(!client)return;await client.call('shutdown');client.close();client=null;await wait('runtime descriptor removed',()=>!fs.existsSync(path.join(directory,'runtime.json')),15000);};
const source='<canvas id="effect" width="128" height="128"></canvas><script>const ctx=document.getElementById("effect").getContext("2d");ctx.fillStyle="#123456";ctx.fillRect(0,0,128,128);</script>';
try{
 await check('simultaneous cold starts acquire one background owner for the same configuration',async()=>{
  const peers=await Promise.all([0,1,2].map(()=>connectRuntime(root,directory,'virtual')));client=peers[0];
  try{const greetings=await Promise.all(peers.map(peer=>peer.call('hello')));assert.equal(new Set(greetings.map(g=>g.pid)).size,1);assert(greetings.every(g=>g.mode==='virtual'));report.coldStartPid=greetings[0].pid;}finally{peers.slice(1).forEach(peer=>peer.close());}
 });
 client.close();await connect();const initial=await client.call('runtime.state');report.firstPid=initial.pid;
 await check('RPC uses authenticated IPv4 loopback while the named pipe remains an instance lock',async()=>{
  const descriptor=JSON.parse(fs.readFileSync(path.join(directory,'runtime.json'),'utf8'));assert.equal(descriptor.version,2);assert.equal(descriptor.transport,'tcp-loopback');assert(Number.isInteger(descriptor.port));assert.equal(client.socket.remoteAddress,'127.0.0.1');report.transport=descriptor.transport;
  const override=new RuntimeConnection();try{await override.connect({...descriptor,host:'203.0.113.1'});assert.equal((await override.call('hello')).pid,initial.pid);}finally{override.close();}
  const raw=net.connect({host:'127.0.0.1',port:descriptor.port});raw.on('error',()=>{});await new Promise(resolve=>raw.once('connect',resolve));
  const closed=new Promise(resolve=>raw.once('close',resolve));raw.write(JSON.stringify({id:1,method:'shutdown',token:descriptor.token})+'\n');await closed;
  assert.equal((await client.call('hello')).pid,initial.pid,'a connection must authenticate with hello before issuing commands');
 });
 await check('an invalid IPC token is rejected without disturbing the authenticated client',async()=>{
  const descriptor=JSON.parse(fs.readFileSync(path.join(directory,'runtime.json'),'utf8')),unauthorized=new RuntimeConnection();
  try{await assert.rejects(unauthorized.connect({...descriptor,token:'0'.repeat(64)}),/отключился/);}finally{unauthorized.close();}
  assert.equal((await client.call('hello')).pid,initial.pid);
 });
 let layout=discoverLayout(await devices()).layout;assert(layout.components.length);await studio('save',{layout});
 await check('detached builtin output continues with zero UI connections and reconnects to the same owner',async()=>{
  await studio('play',{config:{effect:'solid',color:0x234567,brightness:100,fps:60}});await delay(200);const before=await studio();client.close();client=null;await delay(500);await connect();
  const owner=await client.call('runtime.state'),after=await studio();assert.equal(owner.pid,initial.pid);assert(after.running);assert(after.frame>before.frame);assert.equal(owner.htmlRenderer,false);assert((await devices()).every(d=>d.colors.every(c=>c===0x234567)));report.builtinNodeRssBytes=owner.memory.rss;
 });
 await check('startup settings reload leaves the active scene and owner intact',async()=>{
  const file=path.join(directory,'app-settings.json'),saved=JSON.parse(fs.readFileSync(file,'utf8')),before=await studio();
  fs.writeFileSync(file,JSON.stringify({...saved,autoStart:false,elevatedStartup:false,startupTaskName:null}));
  const refreshed=await client.call('runtime.settings.reload');assert.equal(refreshed.settings.autoStart,false);assert.equal(refreshed.pid,initial.pid);assert((await studio()).running);assert.equal((await studio()).current.effect,before.current.effect);
 });
 await check('saving a live layout preserves builtin output and the persisted playback intent',async()=>{
  layout.components[0].name='Saved while running';layout.components[0].pose.x=125;
  const result=await studio('save',{layout,resume:true});assert(result.running);assert.equal(result.current.effect,'solid');assert.equal(result.layout.components[0].name,'Saved while running');
  await wait('saved layout keeps solid output',async()=>(await devices()).every(d=>d.colors.every(c=>c===0x234567)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'playback-virtual.json'),'utf8')).kind,'studio');
 });
 await check('clean owner restart restores the saved profile without the Electron interface',async()=>{
  await shutdown();await connect();const owner=await client.call('runtime.state');assert.notEqual(owner.pid,initial.pid);report.restartedPid=owner.pid;
  await wait('saved solid restored',async()=>{const s=await studio();return s.running&&s.current.effect==='solid'&&(await devices()).every(d=>d.colors.every(c=>c===0x234567));});
 });
 await check('guided calibration isolates raw probes and cancellation restores the running scene',async()=>{
  const draft=structuredClone(layout),component=draft.components[0];component.points=component.points.slice(0,Math.max(1,Math.floor(component.points.length/2)));
  const state=await studio('calibration.begin',{component:component.id,layout:draft});assert.equal(state.phase,'question');
  const [device]=await devices(),lit=new Set(component.points.map(p=>p.led));assert(device.colors.every((color,index)=>color===(lit.has(index)?255:0)));
  await studio('calibration.step',{session:state.session,color:'R'});assert((await devices())[0].colors.filter((_,i)=>lit.has(i)).every(c=>c===65280));
  await studio('calibration.cancel',{session:state.session});const after=await studio();assert(after.running);assert.equal(after.calibration,null);assert.deepEqual(after.layout,layout);assert((await devices()).every(d=>d.colors.every(c=>c===0x234567)));
 });
 await check('HTML Canvas output survives disconnection and static image resumes after calibration',async()=>{
  await canvas('play',{name:'Background static',source,config:{brightness:100,fps:60}});
  await wait('static Canvas reaches native virtual LEDs',async()=>{const s=await canvas();return s.output&&(await devices()).every(d=>d.colors.every(c=>c===0x563412));});
  const before=await studio(),owner=await client.call('runtime.state');assert(owner.htmlRenderer);report.canvasPid=owner.canvasPid;client.close();client=null;await delay(500);await connect();
  assert.equal((await client.call('runtime.state')).canvasPid,owner.canvasPid);assert((await studio()).frame>before.frame);assert((await canvas()).output);
  const pending=studio('calibration.begin',{component:layout.components[0].id});await studio('calibration.cancel');await pending;
  await wait('closing during calibration preparation restores Canvas',async()=>(await studio()).calibration===null&&(await canvas()).output&&(await devices()).every(d=>d.colors.every(c=>c===0x563412)));
  const calibration=await studio('calibration.begin',{component:layout.components[0].id});await studio('calibration.cancel',{session:calibration.session});
  await wait('static Canvas resumes without a new paint',async()=>{const s=await studio();return s.canvasSession!==before.canvasSession&&(await canvas()).output&&(await devices()).every(d=>d.colors.every(c=>c===0x563412));});
 });
 await check('saving during static Canvas preserves its helper and rebinds the new output session',async()=>{
  const before=await studio(),owner=await client.call('runtime.state');assert(owner.canvasPid);
  layout.components[0].pose.y=75;
  const result=await studio('save',{layout,resume:true});assert(result.running);assert.notEqual(result.canvasSession,before.canvasSession);
  await wait('saved Canvas resumes its last static paint',async()=>(await canvas()).output&&(await devices()).every(d=>d.colors.every(c=>c===0x563412)));
  assert.equal((await client.call('runtime.state')).canvasPid,owner.canvasPid,'same Canvas helper');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'playback-virtual.json'),'utf8')).kind,'canvas');
 });
 await check('concurrent Canvas saves retain output and a malformed save restores the same helper',async()=>{
  const owner=await client.call('runtime.state'),a=structuredClone(layout),b=structuredClone(layout);a.components[0].name='Older Canvas save';b.components[0].name='Newest Canvas save';
  await Promise.all([studio('save',{layout:a,resume:true}),studio('save',{layout:b,resume:true})]);layout=b;
  await wait('latest Canvas save preserves output',async()=>(await studio()).running&&(await canvas()).output&&(await devices()).every(d=>d.colors.every(c=>c===0x563412)));
  assert.equal((await studio()).layout.components[0].name,'Newest Canvas save');assert.equal((await client.call('runtime.state')).canvasPid,owner.canvasPid);
  await assert.rejects(studio('save',{layout:{...layout,version:999},resume:true}),/Invalid layout/);
  await wait('invalid Canvas save rebinds suspended output',async()=>(await canvas()).output&&(await devices()).every(d=>d.colors.every(c=>c===0x563412)));
  assert.equal((await client.call('runtime.state')).canvasPid,owner.canvasPid);
 });
 await check('a stop concurrent with a Canvas layout save prevents resume and releases the helper',async()=>{
  await Promise.all([studio('save',{layout,resume:true}),studio('stop')]);
  assert(!(await studio()).running);assert(!(await client.call('runtime.state')).htmlRenderer);
  const before=(await studio()).frame;await delay(200);assert.equal((await studio()).frame,before);
  await canvas('play',{name:'Resume after save race',source,config:{brightness:100}});
 });
 await check('switching to a builtin releases the HTML renderer and keeps output running',async()=>{
  await studio('play',{config:{effect:'aurora',brightness:100,fps:60}});
  const owner=await wait('HTML renderer released',async()=>{const s=await client.call('runtime.state');return !s.htmlRenderer&&s;});assert(!owner.canvasPid);assert((await studio()).running);assert.equal((await studio()).current.effect,'aurora');assert.equal((await canvas()).running,false);
  await canvas('stop');assert((await studio()).running,'stopping an unowned Canvas must preserve builtin output');assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'playback-virtual.json'),'utf8')).kind,'studio');
 });
 await check('device switch immediately blacks out the last controller and persists its disabled state',async()=>{
  const device=(await devices())[0];const result=await studio('device.enabled',{deviceKey:deviceKey(device),enabled:false});assert(!result.running);assert(result.layout.components.filter(c=>c.deviceKey===deviceKey(device)).every(c=>!c.enabled));assert((await devices())[0].colors.every(c=>c===0));
  await studio('device.enabled',{deviceKey:deviceKey(device),enabled:true});await studio('play',{config:{effect:'solid',color:0x234567,brightness:100}});
 });
 await check('stop during pending HTML startup leaves no renderer or subsequent frames',async()=>{
  await studio('stop');const pending=canvas('play',{name:'Cancelled startup',source,config:{brightness:100,fps:60}}).then(result=>({result}),error=>({error:error.message}));
  await wait('HTML process spawned',async()=>(await client.call('runtime.state')).htmlRenderer);await canvas('stop');await pending;
  await wait('cancelled startup stopped',async()=>{const r=await client.call('runtime.state'),s=await studio();return !r.htmlRenderer&&!s.running;});
  const before=await studio();await delay(300);const after=await studio();assert.equal(after.frame,before.frame);assert.equal((await canvas()).running,false);
 });
 await check('double Canvas play and a stale failing start keep the newest helper and profile',async()=>{
  const secondSource=source.replace('#123456','#224466');
  await Promise.all([canvas('play',{name:'Old canvas',source,config:{brightness:100}}),canvas('play',{name:'Newest canvas',source:secondSource,config:{brightness:100}})]);
  await wait('newest Canvas owns output',async()=>{const s=await canvas();return s.output&&s.name==='Newest canvas'&&(await devices()).every(d=>d.colors.every(c=>c===0x664422));});
  const stale=canvas('play',{name:'Failing old page',source:'<script>throw Error("Old page failure")</script>',config:{brightness:100}}).catch(()=>null);
  await canvas('play',{name:'Replacement canvas',source:secondSource,config:{brightness:100}});await stale;
  await wait('replacement survived stale completion',async()=>(await canvas()).name==='Replacement canvas'&&(await studio()).running);await delay(250);assert.equal((await canvas()).name,'Replacement canvas');
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'playback-virtual.json'),'utf8'));assert.equal(saved.kind,'canvas');assert.equal(saved.args.name,'Replacement canvas');
  const forged=new RuntimeConnection();try{await forged.connect(JSON.parse(fs.readFileSync(path.join(directory,'runtime.json'),'utf8')));await assert.rejects(forged.call('canvas.register',{token:'invalid'}),/не ожидался/);}finally{forged.close();}
 });
 await check('a newer stop wins while an earlier builtin play tears down Canvas',async()=>{
  await Promise.all([studio('play',{config:{effect:'wave',brightness:100}}),studio('stop')]);
  assert.equal((await studio()).running,false);assert.equal((await client.call('runtime.state')).htmlRenderer,false);const before=(await studio()).frame;await delay(200);assert.equal((await studio()).frame,before);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'playback-virtual.json'),'utf8')).kind,'stopped');
 });
 await check('Canvas stop after calibration cancels the rebound session and releases the helper',async()=>{
  await canvas('play',{name:'Rebound canvas',source,config:{brightness:100}});const calibration=await studio('calibration.begin',{component:layout.components[0].id});await studio('calibration.cancel',{session:calibration.session});
  await wait('calibration resumed output',async()=>(await canvas()).output&&(await devices()).every(d=>d.colors.every(c=>c===0x563412)));
  await canvas('stop');assert.equal((await studio()).running,false);assert.equal((await client.call('runtime.state')).htmlRenderer,false);
 });
 await check('saving a native scene rebuilds its virtual source and continues mapped output',async()=>{
  await studio('play',{config:{effect:'openrgb:RainbowWave',speed:4,brightness:100,fps:60}});
  layout.components[0].pose.rz=25;
  const result=await studio('save',{layout,resume:true});assert(result.running);assert.equal(result.metrics.kind,'native');
  const profile=await effectRpc('scene.get');assert.equal(profile.Effects[0].EffectClassName,'RainbowWave');assert(profile.Effects[0].AutoStart);
  const before=(await devices())[0].colors;await wait('native frames continue after save',async()=>JSON.stringify((await devices())[0].colors)!==JSON.stringify(before));
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'playback-virtual.json'),'utf8')).kind,'studio');
 });
 await check('native Effects profile is restored after the owner restarts',async()=>{
  await studio('stop');const profile=effectProfile({effect:'RainbowWave',speed:63,brightness:72,devices:await devices()});await effectRpc('scene.apply',{profile});
  const before=await effectRpc('scene.get');assert.equal(before.Effects[0].Speed,63);assert(before.Effects[0].AutoStart);await shutdown();await connect();
  await wait('native profile auto starts',async()=>{const profile=await effectRpc('scene.get');return profile.Effects?.[0]?.EffectClassName==='RainbowWave'&&profile.Effects[0].Speed===63&&profile.Effects[0].AutoStart;});
  const colors=(await devices())[0].colors;await delay(250);assert.notDeepEqual((await devices())[0].colors,colors);await effectRpc('stop');
 });
 await check('active game receiver restarts on the saved port and accepts authenticated events',async()=>{
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  await studio('play',{config:{effect:'solid',color:0x234567,brightness:100}});await studio('game.start',{port});const config=await studio('game.config');const token=config.match(/"token"\s+"([^"]+)"/)?.[1];assert(token);await shutdown();await connect();
  await wait('saved game receiver restored',async()=>{const s=await studio();return s.gameService.enabled&&s.gameService.port===port;});
  const response=await fetch('http://127.0.0.1:'+port+'/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,event:{name:'health',value:.25}})});assert.equal(response.status,204);assert.equal((await studio()).events.health,.25);await studio('game.stop');
 });
 report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;console.error(error);process.exitCode=1;}
finally{
 try{await shutdown();}catch(error){report.cleanupError=error.message;console.error('Cleanup:',error.message);process.exitCode=1;client?.close();}
 report.finished=new Date().toISOString();fs.writeFileSync(path.join(root,'artifacts','background-integration.json'),JSON.stringify(report,null,2));console.log('Report: artifacts/background-integration.json');
}
