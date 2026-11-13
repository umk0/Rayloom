// Persistent lighting owner. This process does not load Electron or Chromium.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {CoreClient} from './core-client.mjs';
import {StudioService} from './studio-service.mjs';
import {GameEvents} from './game-events.mjs';
import {pipePath,receiveLines,authenticated,isLoopbackAddress} from './runtime-wire.mjs';
import {validateCanvasSource} from './canvas-source.mjs';
import {runtimeDiagnostics} from './runtime-diagnostics.mjs';
import {setBasicStartup} from './runtime-access.mjs';
import {electronHostExecutable} from './electron-host.mjs';

const argv=process.argv.slice(2),arg=(key,fallback)=>{const i=argv.indexOf(key);return i>=0?argv[i+1]??fallback:fallback;};
const root=path.resolve(import.meta.dirname,'..'),dataDir=path.resolve(arg('--data',process.env.RAYLOOM_USER_DATA??process.env.LUMEN_USER_DATA??path.join(root,'runtime','user-data')));
fs.mkdirSync(dataDir,{recursive:true});
const read=(name,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(dataDir,name+'.json'),'utf8'));}catch{return fallback;}};
const write=(name,value)=>{const file=path.join(dataDir,name+'.json');fs.writeFileSync(file+'.agent.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.agent.tmp',file);};
let settings={mode:'hardware',autoStart:false,continueOnClose:true,...read('app-settings',{})};
let mode=arg('--mode',settings.mode);if(!['hardware','virtual'].includes(mode))mode='hardware';
const instanceSuffix=createHash('sha256').update(dataDir.toLowerCase()).digest('hex').slice(0,24);
const descriptor={version:2,transport:'tcp-loopback',pipe:'rayloom-runtime-'+instanceSuffix,token:randomBytes(32).toString('hex'),pid:process.pid,root};
let core,studio,games,ready=false,restoring=false,error=null,changing=false,shuttingDown=false,canvasOwner=null,canvasSequence=0,canvasEpoch=0,outputEpoch=0,coreEpoch=0,pendingCalibration=null;
const clients=new Set();
function emit(event,value){for(const socket of clients)if(!socket.destroyed&&socket.writableLength<1024*1024)socket.write(JSON.stringify({event,value})+'\n');}
function attachStudio(){studio=new StudioService(root,path.join(dataDir,mode),()=>core);games=new GameEvents(studio);studio.onFrame=frame=>emit('preview',frame);studio.onCalibrationEnd=value=>{emit('calibration.end',value);const owner=canvasOwner;if(owner?.calibration===value.session){owner.calibration=null;void resumeCanvas(owner).catch(()=>{});}};}
function state(){return {...studio.state(),generation:studio.generation,mode,gameService:games.state()};}
function remember(value){write('playback-'+mode,{...value,savedAt:new Date().toISOString()});}
const idleCanvas=()=>({running:false,output:false});
const canvasState=()=>canvasOwner?.state??idleCanvas();
const currentOutput=operation=>operation===outputEpoch&&!shuttingDown;
async function disposeCanvas(owner){
 if(!owner)return;if(owner.disposal)return owner.disposal;
 owner.disposal=(async()=>{
  if(owner.socket){try{await canvasCommand('quit',{},owner);}catch{}}
  const child=owner.child;if(child){for(let i=0;i<20&&child.exitCode===null;i++)await delay(50);if(child.exitCode===null){child.kill();for(let i=0;i<20&&child.exitCode===null;i++)await delay(50);}}
  for(const p of owner.waiters.values()){clearTimeout(p.timer);p.reject(Error('HTML-движок завершён'));}owner.waiters.clear();owner.socket?.destroy();owner.socket=null;
 })();return owner.disposal;
}
function stopCanvas(){canvasEpoch++;const owner=canvasOwner;canvasOwner=null;return disposeCanvas(owner);}
async function canvasCommand(method,args={},owner=canvasOwner){
 if(!owner?.socket||owner.socket.destroyed){if(['resume','suspend','quit'].includes(method))return null;throw Error('HTML-движок не запущен');}
 const id=++canvasSequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{owner.waiters.delete(id);reject(Error('HTML-движок не отвечает'));},method==='quit'?2000:20000);owner.waiters.set(id,{resolve,reject,timer});owner.socket.write(JSON.stringify({event:'canvas.command',value:{id,method,args}})+'\n');});
}
async function resumeCanvas(owner){
 if(!owner||canvasOwner!==owner)return;
 owner.operation=outputEpoch;owner.session=studio.canvasSession??null;owner.studioGeneration=owner.session?studio.generation:undefined;
 await canvasCommand('resume',{},owner);
}
async function startCanvas(args,operation){
 validateCanvasSource(args.source);const epoch=++canvasEpoch,previous=canvasOwner;canvasOwner=null;await disposeCanvas(previous);
 if(epoch!==canvasEpoch||!currentOutput(operation))return idleCanvas();
 const owner={token:randomBytes(24).toString('hex'),operation,state:idleCanvas(),source:args,waiters:new Map(),socket:null,child:null};canvasOwner=owner;
 const executable=electronHostExecutable(root);
 const child=spawn(executable,[path.join(root,'desktop/canvas-host.cjs')],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,RAYLOOM_USER_DATA:dataDir,RAYLOOM_MODE:mode,RAYLOOM_CANVAS_TOKEN:owner.token}});owner.child=child;
 const owns=()=>canvasOwner===owner&&epoch===canvasEpoch&&currentOutput(operation);
 child.on('error',e=>{owner.error=e.message;});child.on('exit',()=>{owner.exited=true;for(const p of owner.waiters.values()){clearTimeout(p.timer);p.reject(Error('HTML-движок завершён'));}owner.waiters.clear();if(canvasOwner===owner){canvasOwner=null;if(owner.session&&studio.canvasSession===owner.session)void studio.stop();}});
 try{
  const deadline=Date.now()+15000;while(!owner.socket&&!owner.exited&&!owner.error&&owns()&&Date.now()<deadline)await delay(25);
  if(!owns()){await disposeCanvas(owner);return idleCanvas();}
  if(!owner.socket)throw Error(owner.error??'Не удалось запустить HTML-движок');
  const result=await canvasCommand('start',{...args,output:true},owner);
  if(!owns()){await disposeCanvas(owner);return idleCanvas();}
  owner.state=result;remember({kind:'canvas',args,game:games.state()});return result;
 }catch(e){if(canvasOwner===owner)canvasOwner=null;await disposeCanvas(owner);if(!currentOutput(operation)||epoch!==canvasEpoch)return idleCanvas();throw e;}
}
async function startCore(){
 const epoch=++coreEpoch,operation=outputEpoch,ownedMode=mode,ownedStudio=studio,ownedGames=games,ownedCore=new CoreClient(root,path.join(dataDir,'native-'+mode),{virtual:mode==='virtual'});core=ownedCore;ready=false;restoring=true;error=null;
 const owns=()=>epoch===coreEpoch&&core===ownedCore&&!shuttingDown;
 try{await ownedCore.start();const deadline=Date.now()+90000;let detected=false;while(owns()&&Date.now()<deadline){const status=await ownedCore.call('status');if(status.pluginsReady&&status.detectionPercent>=100){detected=true;break;}await delay(200);}if(!owns())return;if(!detected)throw Error('Ядро не завершило обнаружение за 90 секунд');ready=true;
  const saved=read('playback-'+ownedMode,{});
  if(currentOutput(operation)){
   if(saved.kind==='studio')await ownedStudio.play(saved.config);
   if(saved.kind==='canvas')await startCanvas(saved.args,operation);
   if(saved.kind==='native')for(const item of saved.plugins??[]){if(!owns()||!currentOutput(operation))break;await ownedCore.call('plugin.profile.set',{plugin:item.id,profile:item.profile});}
   if(owns()&&currentOutput(operation)&&saved.game?.enabled)await ownedGames.start(saved.game.port);
  }
 }catch(e){if(owns()){error=e.message;console.error(new Date().toISOString(),e.stack);}}
 finally{if(owns())restoring=false;}
}
async function rememberNative(operation){
 const plugins=[];for(const p of await core.call('plugins.list'))if(p.loaded){try{plugins.push({id:p.id,profile:await core.call('plugin.profile.get',{plugin:p.id})});}catch{}}
 if(currentOutput(operation))remember({kind:'native',plugins,game:games.state()});
}
async function shutdown(){if(shuttingDown)return;shuttingDown=true;outputEpoch++;coreEpoch++;clearInterval(telemetryTimer);await stopCanvas();await studio.cancelCalibration({resume:false}).catch(()=>{});await studio.stop();await games.stop();await core.stop();for(const socket of connections)socket.destroy();server.close();instanceLock.close();legacyInstanceLock.close();try{if(read('runtime',{}).pid===process.pid)fs.unlinkSync(path.join(dataDir,'runtime.json'));}catch{}process.exit(0);}
async function startupSetting(enabled){
 const launcher=path.join(root,'runtime','Rayloom-Agent.exe');
 const registry='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
 settings={...settings,...read('app-settings',{})};
 settings=await setBasicStartup({settings,enabled,mode,platform:process.platform,launcherExists:fs.existsSync(launcher),write:value=>write('app-settings',value),execute:async value=>{
  if(value)await promisify(execFile)('reg.exe',['ADD',registry,'/v','Rayloom','/t','REG_SZ','/d','"'+launcher+'" --data "'+dataDir+'"','/f'],{windowsHide:true});
  else{try{await promisify(execFile)('reg.exe',['DELETE',registry,'/v','Rayloom','/f'],{windowsHide:true});}catch(e){if(e.code!==1)throw e;}}
 }});
}
const coreReads=new Set(['status','devices.list','plugins.list','hardware.status','diagnostics','profiles.list']);
const coreCalls=new Set([...coreReads,'plugin.rpc','plugin.profile.get','plugin.profile.set','profiles.save-effects','devices.prepare','devices.restore','devices.frame','devices.flush']);
async function handle(socket,method,args={}){
 if(method==='hello')return {pid:process.pid,mode,ready:ready&&!restoring,transport:descriptor.transport};
 if(method==='snapshot')return error?{mode,error,devices:[],plugins:[]}:!ready||restoring?{starting:true,mode,devices:[],plugins:[]}:{mode,status:await core.call('status'),devices:await core.call('devices.list'),plugins:await core.call('plugins.list')};
 if(method==='runtime.state')return {pid:process.pid,corePid:core.child?.pid,ready:ready&&!restoring,error,mode,settings,memory:process.memoryUsage(),htmlRenderer:!!canvasOwner,canvasPid:canvasOwner?.child?.pid,engine:'Node + OpenRGB',restoresLastProfile:true};
 if(method==='runtime.settings'){if(typeof args.settings?.autoStart==='boolean')await startupSetting(args.settings.autoStart);return handle(socket,'runtime.state');}
 if(method==='runtime.settings.reload'){settings={...settings,...read('app-settings',{})};return handle(socket,'runtime.state');}
 if(method==='runtime.diagnostics')return runtimeDiagnostics({dataDir,studioDir:studio.dir,root,mode,settings});
 if(method==='shutdown'){setTimeout(()=>void shutdown(),10);return true;}
 if(method==='core'){
  if(!coreCalls.has(args.method))throw Error('Недопустимая команда ядра');if(!ready||restoring)throw Error('Ядро ещё запускается');
  const mutation=args.method==='plugin.profile.set'||(args.method==='plugin.rpc'&&!['catalog','scene.get','scene.validate','audio.status','config.get','gradient.read','screens','shaders','shader.read','diagnostics','blendModes','globals.get'].includes(args.params?.request?.method)),operation=mutation?++outputEpoch:outputEpoch;
  const result=await core.call(args.method,args.params);if(mutation)await rememberNative(operation);return result;
 }
 if(method==='canvas.register'){const owner=canvasOwner;if(!owner||owner.socket||!authenticated(args.token,owner.token))throw Error('HTML-движок не ожидался');owner.socket=socket;socket.canvasOwner=owner;return state();}
 if(method==='canvas.reply'){const owner=socket.canvasOwner;if(!owner||socket!==owner.socket)throw Error('Неверный HTML-движок');const p=owner.waiters.get(args.id);if(p){clearTimeout(p.timer);owner.waiters.delete(args.id);args.error?p.reject(Error(args.error)):p.resolve(args.result);}return true;}
 if(method==='canvas.telemetry'){if(socket!==canvasOwner?.socket)return false;canvasOwner.state=args;return true;}
 if(method==='canvas.frame'){if(socket!==canvasOwner?.socket)return {accepted:false};return studio.submitCanvasFrame({...args,rgba:Buffer.from(args.rgba,'base64')});}
 if(method==='canvas'){
  if(args.method==='state')return canvasState();
  if(args.method==='play'){if(!ready||restoring)throw Error('Ядро ещё запускается');return startCanvas(args.args,++outputEpoch);}
  if(args.method==='stop'){const owner=canvasOwner,operation=owner?++outputEpoch:outputEpoch;await stopCanvas();if(owner&&currentOutput(operation)&&!studio.running)remember({kind:'stopped',game:games.state()});return canvasState();}
  if(args.method==='parameters'){const owner=canvasOwner,result=await canvasCommand('parameters',args.args,owner);if(owner&&canvasOwner===owner){owner.state=result;owner.source.parameters=args.args.parameters;remember({kind:'canvas',args:owner.source,game:games.state()});}return result;}
  throw Error('Неизвестная команда HTML-движка');
 }
 if(method!=='studio')throw Error('Неизвестная команда движка');
 const m=args.method,a=args.args??{};
 if(m==='state')return state();if(m==='telemetry')return {...studio.telemetry(),generation:studio.generation};
 if(m==='save'){
  const operation=++outputEpoch,owner=canvasOwner,resume=a.resume===true;
  if(resume)await canvasCommand('suspend',{},owner);else await stopCanvas();
  let failure;
  try{
   if(!currentOutput(operation))return state();
   const result=await studio.saveLayout(a.layout,{resume});
   if(currentOutput(operation)){
    if(result.running&&result.current?.effect?.startsWith('canvas:')&&owner&&canvasOwner===owner)remember({kind:'canvas',args:owner.source,game:games.state()});
    else if(result.running)remember({kind:'studio',config:result.current,game:games.state()});
    else{if(owner&&canvasOwner===owner)await stopCanvas();if(currentOutput(operation))remember({kind:'stopped',game:games.state()});}
   }
   return result;
  }catch(error){
   failure=error;
   if(currentOutput(operation)&&!studio.running){
    try{if(owner&&canvasOwner===owner)await stopCanvas();if(currentOutput(operation))remember({kind:'stopped',game:games.state()});}catch{}
   }
   throw error;
  }finally{if(resume&&currentOutput(operation))try{await resumeCanvas(owner);}catch(error){if(!failure)throw error;}}
 }
 if(m==='play'){
  if(!ready||(!a.canvasHost&&restoring))throw Error('Ядро ещё запускается');
  if(a.canvasHost){const owner=socket.canvasOwner;if(!owner||canvasOwner!==owner||socket!==owner.socket||!currentOutput(owner.operation))throw Error('Запуск HTML отменён другой командой');const request=studio.play(a.config);owner.studioGeneration=studio.generation;const result=await request;if(canvasOwner!==owner||!currentOutput(owner.operation))return {running:false,canvasSession:null};owner.session=result.canvasSession;return {...result,generation:studio.generation};}
  const operation=++outputEpoch;await stopCanvas();if(!currentOutput(operation))return state();const result=await studio.play(a.config);if(currentOutput(operation))remember({kind:result.running?'studio':'stopped',config:result.current,game:games.state()});return {...result,generation:studio.generation};
 }
 if(m==='stop'){
  if(a.canvasHost){const owner=socket.canvasOwner;if(!owner||socket!==owner.socket)throw Error('Неверный HTML-движок');if((owner.session&&studio.canvasSession===owner.session)||owner.studioGeneration===studio.generation)await studio.stop();return state();}
  const operation=++outputEpoch,stopping=studio.stop();await Promise.all([stopCanvas(),stopping]);if(!currentOutput(operation))return state();remember({kind:'stopped',game:games.state()});return state();
 }
 if(m==='identify'){const component=(a.layout??studio.getLayout()).components.find(c=>c.id===a.component);if(!component)throw Error('Устройство не найдено');const operation=++outputEpoch,owner=canvasOwner;await canvasCommand('suspend',{},owner);try{if(!currentOutput(operation))return false;return await studio.identify(component,a.led,a);}finally{await resumeCanvas(owner);}}
 if(m==='calibration.begin'){
  if(pendingCalibration||studio.calibration)throw Error('Сначала завершите текущую проверку подсветки.');const operation=++outputEpoch,owner=canvasOwner,intent={operation};pendingCalibration=intent;
  try{await canvasCommand('suspend',{},owner);if(!currentOutput(operation)){await resumeCanvas(owner);return null;}const activeStudio=studio,result=await activeStudio.beginCalibration(a);if(!currentOutput(operation)){if(result)await activeStudio.cancelCalibration({session:result.session,resume:true});await resumeCanvas(owner);return null;}if(owner&&canvasOwner===owner)owner.calibration=result?.session??null;return result;}
  catch(e){await resumeCanvas(owner);throw e;}
  finally{if(pendingCalibration===intent)pendingCalibration=null;}
 }
 if(m==='calibration.answer'||m==='calibration.step')return studio.answerCalibration(a);
 if(m==='calibration.apply')return studio.applyCalibration(a);
 if(m==='calibration.cancel'){if(pendingCalibration&&!a.session)outputEpoch++;return studio.cancelCalibration(a);}
 if(m==='calibration.state')return studio.calibrationState(true);
 if(m==='device.enabled'){const operation=++outputEpoch,owner=canvasOwner;await canvasCommand('suspend',{},owner);try{if(!currentOutput(operation))return state();const result=await studio.setDeviceEnabled(a);if(currentOutput(operation)){if(result.running&&result.current?.effect!=='canvas:editor')remember({kind:'studio',config:result.current,game:games.state()});else if(!result.running)remember({kind:'stopped',game:games.state()});}return result;}finally{await resumeCanvas(owner);}}
 if(m==='rescan'){const operation=++outputEpoch;await stopCanvas();if(!currentOutput(operation))return state();await studio.stop();return core.call('devices.rescan');}
 if(m==='diagnostics')return ready?core.call('diagnostics'):[];
 if(m==='hardware.status')return ready?core.call('hardware.status'):{starting:true};
 if(m==='plugins.reload'){studio.loadPlugins();return state();}
 if(m==='game.start'){if(!ready||restoring)throw Error('Ядро ещё запускается');const result=await games.start(a.port??19421);remember({...read('playback-'+mode,{}),game:result});return result;}
 if(m==='game.stop'){const result=await games.stop();remember({...read('playback-'+mode,{}),game:result});return result;}
 if(m==='game.demo')return games.accept(a.event);
 if(m==='game.config')return games.config();
 if(m==='mode'){
  if(!['hardware','virtual'].includes(a.mode)||changing)throw Error('Нельзя сменить режим');changing=true;outputEpoch++;coreEpoch++;ready=false;restoring=true;try{await stopCanvas();await studio.stop();await games.stop();await core.stop();mode=a.mode;settings.mode=mode;write('app-settings',settings);attachStudio();void startCore();return {mode};}finally{changing=false;}
 }
 throw Error('Неизвестная команда студии');
}
const connections=new Set();let unauthenticated=0;
const server=net.createServer(socket=>{
 if(!isLoopbackAddress(socket.remoteAddress)||connections.size>=64||unauthenticated>=16){socket.destroy();return;}
 connections.add(socket);unauthenticated++;socket.setNoDelay(true);let authorized=false,inflight=0,allowance=512,lastRefill=Date.now();
 const authenticationDeadline=setTimeout(()=>socket.destroy(),2500);authenticationDeadline.unref();
 socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(authenticationDeadline);connections.delete(socket);if(!authorized)unauthenticated--;clients.delete(socket);const owner=socket.canvasOwner;if(owner?.socket===socket){owner.socket=null;for(const p of owner.waiters.values()){clearTimeout(p.timer);p.reject(Error('HTML-движок отключился'));}owner.waiters.clear();}});
 const reply=value=>{if(!socket.destroyed){if(socket.writableLength>2*1024*1024)socket.destroy();else socket.write(JSON.stringify(value)+'\n');}};
 receiveLines(socket,message=>{
  if(!message||!Number.isSafeInteger(message.id)||message.id<1||typeof message.method!=='string'||message.method.length>80||!authenticated(message.token,descriptor.token)){socket.destroy();return;}
  if(!authorized){if(message.method!=='hello'){socket.destroy();return;}authorized=true;unauthenticated--;clearTimeout(authenticationDeadline);clients.add(socket);}
  const now=Date.now();allowance=Math.min(512,allowance+(now-lastRefill)*.512);lastRefill=now;
  if(inflight>=64||allowance<1){socket.destroy();return;}allowance--;inflight++;
  void handle(socket,message.method,message.args).then(result=>reply({id:message.id,result}),e=>reply({id:message.id,error:String(e.message).slice(0,1500)})).finally(()=>inflight--);
 },{maxBytes:()=>authorized?2*1024*1024:4096});
});
// The deterministic named pipe is only an instance lock. TCP RPC on loopback
// lets an ordinary editor reach its elevated owner without changing pipe ACLs.
const instanceLock=net.createServer(socket=>socket.destroy());
const legacyInstanceLock=net.createServer(socket=>socket.destroy());
instanceLock.on('error',e=>{if(['EADDRINUSE','EACCES','EPERM'].includes(e.code))process.exit(0);console.error(e);process.exit(1);});
legacyInstanceLock.on('error',e=>{if(['EADDRINUSE','EACCES','EPERM'].includes(e.code))process.exit(0);console.error(e);process.exit(1);});
server.on('error',e=>{console.error(e);instanceLock.close();process.exit(1);});
legacyInstanceLock.listen(pipePath('lumen-runtime-'+instanceSuffix),()=>instanceLock.listen(pipePath(descriptor.pipe),()=>server.listen({host:'127.0.0.1',port:0,exclusive:true},()=>{descriptor.port=server.address().port;write('runtime',descriptor);attachStudio();void startCore();})));
const telemetryTimer=setInterval(()=>{if(studio&&clients.size)emit('telemetry',{...studio.telemetry(),generation:studio.generation});},200);
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
