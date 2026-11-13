import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {RuntimeConnection} from './runtime-wire.mjs';

export function nodeExecutable(root){
 const choices=[process.env.RAYLOOM_NODE??process.env.LUMEN_NODE,path.join(root,'runtime','node','node.exe'),process.platform==='win32'?'C:/Program Files/nodejs/node.exe':process.execPath];
 const file=choices.find(p=>p&&fs.existsSync(p)&&!path.basename(p).toLowerCase().includes('electron'));if(!file)throw Error('Не найден Node runtime для фонового движка. Выполните scripts/build-launcher.ps1.');return file;
}
export async function connectRuntime(root,dataDir,mode,{launch=true}={}){
 const descriptorFile=path.join(dataDir,'runtime.json');
 const attempt=async()=>{try{const d=JSON.parse(fs.readFileSync(descriptorFile,'utf8'));return await new RuntimeConnection().connect(d);}catch{return null;}};
 let client=await attempt();if(client||!launch){if(!client)throw Error('Фоновый движок не запущен');return client;}
 fs.mkdirSync(dataDir,{recursive:true});let settings={};try{settings=JSON.parse(fs.readFileSync(path.join(dataDir,'app-settings.json'),'utf8'));}catch{}
 if(process.platform==='win32'&&mode==='hardware'&&settings.autoStart&&settings.elevatedStartup&&/^(?:Rayloom|LumenRGB)-Agent-[0-9a-f]{24}$/.test(settings.startupTaskName??'')){
  try{await promisify(execFile)('schtasks.exe',['/Run','/TN',settings.startupTaskName],{windowsHide:true,timeout:10000});}
  catch{throw Error('Не удалось запустить настроенную задачу Rayloom. Проверьте автозапуск Windows или запустите фоновый агент с правами администратора.');}
 }else if(process.platform==='win32'){
  // Electron on Windows retains its process while a directly spawned Node
  // child lives. The short-lived bootstrap releases that parent relationship.
  const launcher=path.join(root,'runtime','Rayloom-Agent.exe');
  if(!fs.existsSync(launcher))throw Error('Не найден фоновый launcher. Выполните scripts/build-launcher.ps1.');
  await new Promise((resolve,reject)=>{
   const child=spawn(launcher,['--data',dataDir,'--mode',mode,'--silent'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
   const timer=setTimeout(()=>reject(Error('Фоновый launcher не ответил за 15 секунд.')),15000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Ошибка фонового launcher: '+code));});
  });
 }else{
  const log=fs.openSync(path.join(dataDir,'agent.log'),'a');
  try{const child=spawn(nodeExecutable(root),[path.join(root,'desktop/runtime-agent.mjs'),'--data',dataDir,'--mode',mode],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',log,log],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});child.on('error',()=>{});child.unref();}finally{fs.closeSync(log);}
 }
 const deadline=Date.now()+20000;while(Date.now()<deadline){client=await attempt();if(client)return client;await delay(100);}throw Error('Не удалось запустить фоновый движок. Подробности: '+path.join(dataDir,'agent.log'));
}

// CanvasRuntime needs synchronous ownership checks. Commands update this cache
// before resolving; telemetry refreshes it between commands. Frame delivery has
// exactly one pending request and one replaceable latest frame.
export class RemoteStudio{
 constructor(client,dataDir,mode,{canvasHost=false}={}){this.client=client;this.canvasHost=canvasHost;this.setMode(dataDir,mode);this.cache={running:false,events:{},generation:0};client.on('telemetry',v=>{this.cache={...this.cache,...v};});client.on('preview',v=>this.onFrame?.(v));}
 setMode(dataDir,mode){this.dir=path.join(dataDir,mode,'studio');fs.mkdirSync(this.dir,{recursive:true});}
 get running(){return this.cache.running;}get current(){return this.cache.current;}get events(){return this.cache.events??{};}get generation(){return this.operation??0;}get canvasSession(){return this.cache.canvasSession;}
 state(){return this.cache;}telemetry(){return this.cache;}getLayout(){return this.read('layout',{version:1,components:[],groups:[]});}
 read(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(this.dir,name+'.json'),'utf8'));}catch{return fallback;}}
 write(name,value){const file=path.join(this.dir,name+'.json');fs.writeFileSync(file+'.ui.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.ui.tmp',file);}
 async invoke(method,args={}){const state=await this.client.call('studio',{method,args});if(state?.layout)this.cache={...this.cache,...state};return state;}
 sync(){return this.invoke('state');}saveLayout(layout,{resume=false}={}){return this.invoke('save',{layout,resume:resume===true});}play(config){this.operation=this.generation+1;return this.invoke('play',{config,canvasHost:this.canvasHost});}stop(){this.operation=this.generation+1;return this.invoke('stop',{canvasHost:this.canvasHost});}loadPlugins(){return this.invoke('plugins.reload');}
 submitCanvasFrame(frame){
  if(!this.running||frame.session!==this.canvasSession)return {accepted:false};
  this.latestFrame={...frame,rgba:Buffer.from(frame.rgba).toString('base64')};
  if(!this.sending){this.sending=true;void(async()=>{try{while(this.latestFrame){const value=this.latestFrame;this.latestFrame=null;const result=await this.client.call('canvas.frame',value,5000);if(!result.accepted){this.latestFrame=null;break;}}}catch{this.latestFrame=null;}finally{this.sending=false;}})();}
  return {accepted:true};
 }
}
