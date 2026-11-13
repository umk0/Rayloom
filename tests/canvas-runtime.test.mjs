import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {CanvasRuntime} from '../desktop/canvas-runtime.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const source='<canvas id="effect" width="128" height="128"></canvas>';
const image={getSize:()=>({width:128,height:128}),toDataURL:()=> 'data:image/png;base64,AA==',toBitmap:()=>Buffer.alloc(128*128*4,127)};
function fixture(t,{loads=[]}={}){
 const windows=[],ipcMain=new EventEmitter();
 const studio={events:{health:1},generation:0,running:false,canvasSession:null,frames:[],stops:0,
  playGate:null,stopGate:null,rejectPlay:false,
  async play(){
   if(this.rejectPlay)throw Error('Rejected config');
   const generation=++this.generation;this.running=false;this.canvasSession=null;
   if(this.playGate)await this.playGate.promise;
   if(generation!==this.generation)return {running:this.running,canvasSession:this.canvasSession};
   this.running=true;this.canvasSession='session-'+generation;return {running:true,canvasSession:this.canvasSession};
  },
  async stop(){this.stops++;this.generation++;this.running=false;this.canvasSession=null;if(this.stopGate)await this.stopGate.promise;},
  submitCanvasFrame(frame){if(!this.running||frame.session!==this.canvasSession)return {accepted:false};this.frames.push(frame);return {accepted:true};}
 };
 class FakeWindow extends EventEmitter{
  constructor(){super();this.index=windows.length;windows.push(this);this.webContents=new EventEmitter();
   this.webContents.session={setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},on(){}};
   this.webContents.send=()=>{};this.webContents.setWindowOpenHandler=()=>{};this.webContents.setFrameRate=()=>{};this.webContents.forcefullyCrashRenderer=()=>{};
  }
  loadURL(){return loads[this.index]?.promise??Promise.resolve();}
  isDestroyed(){return !!this.destroyed;}
  destroy(){this.destroyed=true;}
 }
 const runtime=new CanvasRuntime({BrowserWindow:FakeWindow,ipcMain,getStudio:()=>studio});
 t.after(async()=>{studio.playGate?.resolve();studio.stopGate?.resolve();for(const load of loads)load?.resolve();await runtime.stop();});
 return {runtime,studio,windows,ipcMain};
}

test('stop cancels pending Studio ownership before a hidden Canvas window can be created',async t=>{
 const {runtime,studio,windows}=fixture(t);studio.playGate=deferred();
 const starting=runtime.start({source,output:true});await turn();assert(runtime.pendingStart);
 await runtime.stop();studio.playGate.resolve();await starting;
 assert.equal(windows.length,0);assert.equal(studio.running,false);assert.equal(runtime.state().running,false);assert.equal(runtime.window,null);
});

test('rejection from a destroyed old page cannot stop or overwrite its replacement',async t=>{
 const old=deferred(),{runtime,windows}=fixture(t,{loads:[old]});
 const first=runtime.start({name:'A',source});await turn();assert.equal(windows.length,1);
 await runtime.start({name:'B',source});assert.equal(runtime.state().running,true);
 old.reject(Error('ERR_ABORTED from destroyed A'));await first;
 assert.equal(runtime.state().name,'B');assert.equal(runtime.state().running,true);assert.equal(runtime.state().error,'');assert.equal(runtime.window,windows[1]);
 assert.equal(windows[0].destroyed,true);assert(!windows[1].destroyed);
});

test('late old renderer events are ignored after a new Canvas starts',async t=>{
 const {runtime,windows,ipcMain}=fixture(t);await runtime.start({name:'A',source});const old=windows[0];await runtime.start({name:'B',source});
 old.webContents.emit('render-process-gone',{}, {reason:'crashed'});old.emit('unresponsive');ipcMain.emit('rayloom:canvas-error',{sender:old.webContents},'Late old error');
 old.webContents.emit('paint',{}, {},image);await turn();
 assert.equal(runtime.state().running,true);assert.equal(runtime.state().error,'');assert.equal(runtime.state().name,'B');assert.equal(runtime.state().frames,0);
});

test('an older asynchronous cleanup does not clear a newer window or output session',async t=>{
 const {runtime,studio,windows}=fixture(t);await runtime.start({name:'A',source,output:true});studio.stopGate=deferred();
 const stopped=runtime.stop();await turn();const starting=runtime.start({name:'B',source,output:true});await turn();
 studio.stopGate.resolve();await Promise.all([stopped,starting]);
 assert.equal(runtime.state().name,'B');assert.equal(runtime.state().running,true);assert.equal(runtime.state().output,true);assert.equal(runtime.session,studio.canvasSession);assert.equal(runtime.window,windows[1]);
});

test('identify rebinds Canvas ownership and resubmits even a static last image',async t=>{
 const {runtime,studio,windows}=fixture(t);await runtime.start({source,output:true});windows[0].webContents.emit('paint',{}, {},image);assert.equal(studio.frames.length,1);
 const token=runtime.suspendOutput(),before=studio.frames[0];await studio.stop();windows[0].webContents.emit('paint',{}, {},image);assert.equal(studio.frames.length,1);
 await studio.play();runtime.resumeOutput(token);
 assert.equal(studio.frames.length,2);assert.equal(runtime.state().output,true);assert.equal(studio.frames[1].session,studio.canvasSession);assert.notEqual(studio.frames[1].session,before.session);assert.deepEqual(studio.frames[1].rgba,before.rgba);
});

test('first static paint during calibration is retained for the resumed output session',async t=>{
 const {runtime,studio,windows}=fixture(t);await runtime.start({source,output:true});const token=runtime.suspendOutput();await studio.stop();
 windows[0].webContents.emit('paint',{}, {},image);assert.equal(studio.frames.length,0,'diagnostic isolation must not receive Canvas frames');
 await studio.play();runtime.resumeOutput(token);assert.equal(studio.frames.length,1,'a static first paint must be available when calibration ends');assert.equal(studio.frames[0].session,studio.canvasSession);
});

test('stale identification completion cannot rebind a replacement preview',async t=>{
 const {runtime,studio}=fixture(t);await runtime.start({name:'A',source,output:true});const token=runtime.suspendOutput();
 await runtime.start({name:'B',source,output:false});await studio.play();runtime.resumeOutput(token);
 assert.equal(runtime.state().name,'B');assert.equal(runtime.state().output,false);assert.equal(runtime.session,null);
});

test('static output status notices ownership loss without waiting for another paint',async t=>{
 const {runtime,studio}=fixture(t);await runtime.start({source,output:true});assert.equal(runtime.state().output,true);
 await studio.stop();assert.equal(runtime.state().output,false);assert.equal(runtime.state().running,true,'isolated preview may remain available');
});

test('invalid source preserves the working Canvas and rejected Studio config leaves another effect running',async t=>{
 const {runtime,studio}=fixture(t);await runtime.start({name:'A',source});const window=runtime.window;
 await assert.rejects(runtime.start({source:''}),/HTML/);assert.equal(runtime.window,window);assert.equal(runtime.state().running,true);
 studio.running=true;studio.canvasSession=null;studio.rejectPlay=true;const stops=studio.stops;
 await assert.rejects(runtime.start({source,output:true}),/Rejected config/);assert.equal(studio.running,true);assert.equal(studio.stops,stops);
});

test('renderer failure reports cleanup errors without an unhandled event rejection',async t=>{
 const {runtime,studio}=fixture(t);await runtime.start({source,output:true});
 studio.stop=async()=>{studio.canvasSession=null;throw Error('Device disconnected');};
 await runtime.fail('HTML failed');assert.equal(runtime.state().running,false);assert.match(runtime.state().error,/HTML failed.*Device disconnected/);assert.equal(runtime.window,null);
});
