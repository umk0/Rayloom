// Chromium exists only while a user HTML effect requires it. The configuration
// window can exit independently, including during a Canvas effect.
const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
const dataDir=process.env.RAYLOOM_USER_DATA??process.env.LUMEN_USER_DATA,mode=process.env.RAYLOOM_MODE??process.env.LUMEN_MODE;
app.setName('Rayloom Canvas');app.setPath('userData',path.join(dataDir,'canvas-runtime'));
let client,runtime,studio,suspended,timer;
app.whenReady().then(async()=>{
 const {connectRuntime,RemoteStudio}=await import('./runtime-client.mjs');
 const {CanvasRuntime}=await import('./canvas-runtime.mjs');
 client=await connectRuntime(path.resolve(__dirname,'..'),dataDir,mode,{launch:false});
 studio=new RemoteStudio(client,dataDir,mode,{canvasHost:true});
 runtime=new CanvasRuntime({BrowserWindow,ipcMain,getStudio:()=>studio});
 client.on('canvas.command',async({id,method,args})=>{try{let result;
  if(method==='start')result=await runtime.start(args);
  else if(method==='parameters')result=runtime.update(args.parameters);
  else if(method==='suspend'){suspended=runtime.suspendOutput();result=true;}
  else if(method==='resume'){await studio.sync();runtime.resumeOutput(suspended);suspended=null;result=true;}
  else if(method==='quit'){await runtime.stop();result=true;setTimeout(()=>app.exit(0),100);}
  else throw Error('Unknown Canvas command');
  await client.call('canvas.reply',{id,result});
 }catch(e){await client.call('canvas.reply',{id,error:e.message}).catch(()=>{});}});
 client.on('disconnected',()=>app.exit(0));
 // Install the command listener before registering: the owner may send start
 // immediately after accepting this helper, even in the same socket read.
 studio.cache=await client.call('canvas.register',{token:process.env.RAYLOOM_CANVAS_TOKEN??process.env.LUMEN_CANVAS_TOKEN});
 timer=setInterval(()=>void client.call('canvas.telemetry',runtime.state()).catch(()=>{}),300);
}).catch(()=>app.exit(1));
app.on('window-all-closed',()=>{});
app.on('will-quit',()=>{clearInterval(timer);client?.close();});
