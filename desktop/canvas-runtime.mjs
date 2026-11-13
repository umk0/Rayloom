import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {canvasControls,normalizeCanvasParameters,secureCanvasDocument} from './canvas-source.mjs';

export class CanvasRuntime {
 constructor({BrowserWindow,ipcMain,getStudio}){
  this.BrowserWindow=BrowserWindow;this.getStudio=getStudio;this.generation=0;this.result={running:false,output:false,frames:0,fps:0,preview:null,error:'',name:'',controls:[]};
  ipcMain.on('rayloom:canvas-heartbeat',e=>{if(e.sender===this.window?.webContents)this.heartbeat=Date.now();});
  ipcMain.on('rayloom:canvas-error',(e,message)=>{if(e.sender===this.window?.webContents)void this.fail(String(message).slice(0,600),this.generation,this.window);});
 }
 state(){
  // A static page may never paint again after another effect takes ownership.
  if(this.result.output&&!this.suspended&&(!this.session||this.outputStudio?.canvasSession!==this.session)){this.result.output=false;this.session=null;this.outputStudio=null;}
  return {...this.result,parameters:this.parameters};
 }
 suspendOutput(){const token={generation:this.generation,window:this.window,output:this.state().output};this.suspended=token;return token;}
 resumeOutput(token){
  if(!token||this.suspended!==token||token.generation!==this.generation||token.window!==this.window)return;
  this.suspended=null;const studio=this.getStudio();
  if(token.output&&this.window&&studio.running&&studio.canvasSession){
   this.outputStudio=studio;this.session=studio.canvasSession;this.result.output=true;
   // Static HTML has no next animation frame; restore its last sampled image too.
   if(this.lastFrame)this.submitFrame(this.lastFrame,this.generation,this.window);
  }else if(token.output){this.result.output=false;this.session=null;this.outputStudio=null;}
 }
 async cleanup(){
  clearInterval(this.watchdog);clearInterval(this.contextTimer);
  const win=this.window,session=this.session,studio=this.outputStudio,pending=this.pendingStart;
  // Nothing below an await may clear fields belonging to a newer start.
  this.window=null;this.session=null;this.outputStudio=null;this.pendingStart=null;this.lastFrame=null;this.suspended=null;
  this.result.running=false;this.result.output=false;this.result.fps=0;this.watchdog=null;this.contextTimer=null;
  if(win&&!win.isDestroyed())win.destroy();
  if(session&&studio?.canvasSession===session)await studio.stop();
  // Studio.play changes its generation synchronously, before its queued work.
  // Cancel an unfinished request only while that exact request still owns it.
  else if(pending&&Number.isInteger(pending.studioGeneration)&&pending.studio.generation===pending.studioGeneration)await pending.studio.stop();
 }
 async stop(){this.generation++;await this.cleanup();return this.state();}
 async fail(message,generation=this.generation,win=this.window){
  if(generation!==this.generation||win!==this.window)return this.state();
  this.result.error=message;const stoppedGeneration=this.generation+1;
  try{await this.stop();}catch(error){if(this.generation===stoppedGeneration)this.result.error=message+' Не удалось завершить вывод: '+String(error.message).slice(0,300);}
  return this.state();
 }
 submitFrame(frame,generation,win){
  if(generation!==this.generation||win!==this.window||!this.result.output||this.suspended)return;
  try{
   const accepted=this.outputStudio.submitCanvasFrame({...frame,session:this.session,sequence:++this.sequence});
   if(!accepted.accepted){this.result.output=false;this.session=null;this.outputStudio=null;}
  }catch(error){void this.fail(error.message,generation,win);}
 }
 update(parameters){this.parameters=normalizeCanvasParameters(this.result.controls,parameters);this.sendContext();return this.state();}
 sendContext(){const win=this.window;if(win&&!win.isDestroyed())win.webContents.send('rayloom:canvas-context',{parameters:this.parameters,events:{...this.getStudio().events}});}
 async start({name='Canvas',source,config={},parameters={},output=false}){
  const html=secureCanvasDocument(source),controls=canvasControls(source),normalized=normalizeCanvasParameters(controls,parameters);
  const generation=++this.generation;await this.cleanup();if(generation!==this.generation)return this.state();
  this.result={running:true,output:false,frames:0,fps:0,preview:null,error:'',name:String(name).slice(0,100),controls};
  this.parameters=normalized;this.heartbeat=Date.now();this.sequence=0;this.started=performance.now();this.times=[];this.previewAt=0;
  const fps=Math.max(1,Math.min(120,Number(config.fps)||60));
  try{
   if(output){
    const studio=this.getStudio(),before=studio.generation,request=studio.play({...config,effect:'canvas:editor'});
    this.pendingStart=Number.isInteger(studio.generation)&&studio.generation!==before?{studio,studioGeneration:studio.generation}:null;
    const state=await request;if(generation!==this.generation)return this.state();
    this.pendingStart=null;
    if(!state.canvasSession||state.running===false)throw Error('Запуск Canvas отменён другой командой.');
    this.outputStudio=studio;this.session=state.canvasSession;this.result.output=true;
   }
   const win=new this.BrowserWindow({width:128,height:128,useContentSize:true,show:false,frame:false,skipTaskbar:true,backgroundColor:'#000000',webPreferences:{preload:path.join(import.meta.dirname,'canvas-preload.cjs'),additionalArguments:['--rayloom-canvas-context='+encodeURIComponent(JSON.stringify({parameters:this.parameters,events:{...this.getStudio().events}}))],partition:'rayloom-canvas-'+randomUUID(),offscreen:true,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false,webSecurity:true,devTools:false,spellcheck:false}});
   this.window=win;const wc=win.webContents,s=wc.session,owns=()=>generation===this.generation&&this.window===win;
   s.setPermissionRequestHandler((_w,_p,done)=>done(false));s.setPermissionCheckHandler(()=>false);
   s.webRequest.onBeforeRequest({urls:['*://*/*','file://*/*']},(_d,done)=>done({cancel:true}));
   s.on('will-download',e=>e.preventDefault());wc.setWindowOpenHandler(()=>({action:'deny'}));
   wc.on('will-navigate',e=>e.preventDefault());wc.on('will-redirect',e=>e.preventDefault());wc.on('will-attach-webview',e=>e.preventDefault());
   wc.on('render-process-gone',(_e,details)=>{if(owns())void this.fail('Вычислитель эффекта завершён: '+details.reason,generation,win);});
   win.on('unresponsive',()=>{if(owns()){wc.forcefullyCrashRenderer();void this.fail('Эффект завис и был остановлен. Исправьте цикл в HTML.',generation,win);}});
   wc.on('dom-ready',()=>{if(owns())this.sendContext();});
   wc.on('paint',(_e,_dirty,image)=>{
    if(!owns()||!this.result.running)return;
    try{
    const now=performance.now();this.result.frames++;this.times.push(now);while(this.times.length&&this.times[0]<now-1500)this.times.shift();
    this.result.fps=this.times.length>1?(this.times.length-1)*1000/(now-this.times[0]):0;
    if(!this.previewAt||now-this.previewAt>200){this.previewAt=now;this.result.preview=image.toDataURL();}
    // Retain even the first static paint during a diagnostic pause. Sending is
    // gated in submitFrame; resumeOutput needs this image if HTML never repaints.
    if(!this.result.output)return;
    const size=image.getSize();if(size.width!==128||size.height!==128)image=image.resize({width:128,height:128});
    const bitmap=image.toBitmap(),rgba=new Uint8Array(128*128*4);
    // Electron on Windows supplies premultiplied BGRA; the page has an opaque black backing.
    for(let i=0;i<rgba.length;i+=4){rgba[i]=bitmap[i+2];rgba[i+1]=bitmap[i+1];rgba[i+2]=bitmap[i];rgba[i+3]=255;}
    this.lastFrame={width:128,height:128,rgba};this.submitFrame(this.lastFrame,generation,win);
    }catch(error){void this.fail(error.message,generation,win);}
   });
   wc.setFrameRate(fps);
   this.watchdog=setInterval(()=>{if(owns()&&Date.now()-this.heartbeat>3500){wc.forcefullyCrashRenderer();void this.fail('HTML не отвечает более 3 секунд. Эффект остановлен; редактор продолжает работать.',generation,win);}},500);
   this.contextTimer=setInterval(()=>{if(owns())this.sendContext();},200);
   await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
   if(!owns())return this.state();
   return this.state();
  }catch(error){
   if(generation!==this.generation)return this.state();
   const message=this.result.error||String(error.message).replace(/loading 'data:[\s\S]*/,'при запуске HTML эффекта').slice(0,600);
   await this.fail(message,generation,this.window);throw Error(message);
  }
 }
}
