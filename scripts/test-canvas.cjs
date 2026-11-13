const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
// GUI executables may outlive the invoking Windows console. Keep the JSON report
// authoritative and avoid an Electron uncaught-exception dialog for a closed pipe.
for(const stream of [process.stdout,process.stderr])stream.on('error',error=>{if(error.code!=='EPIPE')throw error;});
const root=path.resolve(__dirname,'..'),runtimeDir=path.join(root,'artifacts','canvas-test-'+Date.now());fs.mkdirSync(runtimeDir,{recursive:true});app.setPath('userData',runtimeDir);
app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms));const report={physicalHardwareTested:false,checks:[]};let runtime;
const studio={events:{health:.15,ammo:.6},canvasSession:null,frames:[],async play(){this.canvasSession='test-'+Date.now();return {canvasSession:this.canvasSession};},async stop(){this.canvasSession=null;},submitCanvasFrame(frame){if(frame.session!==this.canvasSession)return {accepted:false};this.frames.push(frame);if(this.frames.length>3)this.frames.shift();return {accepted:true};}};
const wait=async check=>{for(let i=0;i<60;i++){if(check())return;await delay(100);}throw Error('Canvas check timed out: '+JSON.stringify(runtime.state()));};
const check=name=>{report.checks.push(name);console.log('PASS',name);};
app.whenReady().then(async()=>{
 try{
  const {CanvasRuntime}=await import('../desktop/canvas-runtime.mjs');const {canvasTemplates}=await import('../shared/canvas-templates.mjs');runtime=new CanvasRuntime({BrowserWindow,ipcMain,getStudio:()=>studio});
  for(const t of canvasTemplates){await runtime.start({...t,config:{fps:60},output:true});await wait(()=>runtime.state().frames>8);assert(runtime.state().preview.startsWith('data:image/png'));assert(studio.frames.length);assert(studio.frames.at(-1).rgba.some(v=>v>0));check('Template '+t.id+' renders frames, preview and output');}
  const source='<canvas width="128" height="128" id="c"></canvas><script>const ctx=c.getContext("2d");ctx.fillStyle="#123456";ctx.fillRect(0,0,128,128);</script>';
  studio.frames=[];await runtime.start({name:'Channel test',source,output:true});await wait(()=>studio.frames.some(f=>f.rgba[0]===18));assert.deepEqual(Array.from(studio.frames.at(-1).rgba.slice(0,4)),[18,52,86,255]);check('Windows BGRA converts to exact RGB bytes');
  await runtime.start({name:'Isolation',source:'<canvas width="128" height="128" id="c"></canvas><script>const ctx=c.getContext("2d");fetch("https://example.com/").then(()=>{ctx.fillStyle="red";ctx.fillRect(0,0,128,128)}).catch(()=>{ctx.fillStyle=typeof require==="undefined"&&typeof window.rayloom==="undefined"?"#00ff00":"red";ctx.fillRect(0,0,128,128)});</script>',output:true});await wait(()=>studio.frames.some(f=>f.rgba[0]===0&&f.rgba[1]===255));check('Network blocked; no Node or application IPC exposed');
  const before=Date.now();await runtime.start({name:'Infinite loop',source:'<script>while(true){}</script>',output:true}).catch(()=>{});await wait(()=>!runtime.state().running);assert(Date.now()-before<9000);assert(runtime.state().error);assert.equal(studio.canvasSession,null);check('Hung HTML terminated without blocking main process');
  await runtime.start({...canvasTemplates[0],output:false});await wait(()=>runtime.state().frames>3);assert.equal(studio.canvasSession,null);check('Editor renderer recovers after hung effect; preview does not own hardware');
 }catch(error){report.error=error.stack;console.error(error);process.exitCode=1;}
 finally{await runtime?.stop();fs.writeFileSync(path.join(root,'artifacts/canvas-integration.json'),JSON.stringify(report,null,2));app.exit(process.exitCode||0);}
});
