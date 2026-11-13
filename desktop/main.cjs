const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,dialog}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {resolveUserDataPath}=require('./user-data-path.cjs');
let core,studio,runtimeClient,canvasRuntime,nativeEffectPreviews,window,tray,stopping=false,quitEngine=false,startupError=null,coreReady=false,runtimeChanging=false,runtimeInfo=null,updateService,pendingUpdateExe=null;
const root=path.resolve(__dirname,'..');
const effectsId='org.openrgb.openrgbeffectsplugin';
app.setName('Rayloom');
app.setAppUserModelId('org.rayloom.studio');
const portableRelease=fs.existsSync(path.join(root,'portable-release.json'));
app.setPath('userData',resolveUserDataPath({root,override:process.env.RAYLOOM_USER_DATA??process.env.LUMEN_USER_DATA,portable:portableRelease,localAppData:process.env.LOCALAPPDATA,appData:portableRelease?app.getPath('appData'):undefined}));
const dataDir=app.getPath('userData');
fs.mkdirSync(dataDir,{recursive:true});const settingsFile=path.join(dataDir,'app-settings.json');let appSettings={mode:'hardware'};try{appSettings={...appSettings,...JSON.parse(fs.readFileSync(settingsFile,'utf8'))};}catch{}
let modeChanging=false;
let mode=process.env.RAYLOOM_MODE??process.env.LUMEN_MODE??((process.env.RAYLOOM_HARDWARE??process.env.LUMEN_HARDWARE)==='1'?'hardware':appSettings.mode);
if(!['hardware','virtual'].includes(mode))mode='hardware';
const safeName=name=>{if(typeof name!=='string'||!name.trim()||name.length>100||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))throw new Error('Недопустимое имя');return name;};
const show=()=>{if(window){window.show();if(window.isMinimized())window.restore();window.focus();}};
if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(async()=>{
  // Initialize Chromium's first window before launching the persistent owner.
  // On Windows, starting that child first can retain Electron after app.exit.
  window=new BrowserWindow({show:false,width:1480,height:1000,minWidth:1060,minHeight:700,frame:false,backgroundColor:'#101113',title:'Rayloom',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  const {connectRuntime,RemoteStudio}=await import('./runtime-client.mjs');
  const {migrateLegacyEffectsProfile}=await import('../shared/legacy-brand-migration.mjs');
  runtimeClient=await connectRuntime(root,dataDir,mode);
  const greeting=await runtimeClient.call('hello');mode=greeting.mode;
  studio=new RemoteStudio(runtimeClient,dataDir,mode);await studio.sync();
  core={call:(method,params={})=>runtimeClient.call('core',{method,params})};
  const {CanvasRuntime}=await import('./canvas-runtime.mjs');
  canvasRuntime=new CanvasRuntime({BrowserWindow,ipcMain,getStudio:()=>studio});
  const {NativeEffectPreviews}=await import('./effect-previews.mjs');
  nativeEffectPreviews=new NativeEffectPreviews(root);
  const {UpdateService}=await import('./update-service.mjs');
  updateService=new UpdateService({version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,dataDir});
  const connectPreview=()=>{studio.onFrame=frame=>{if(window&&!window.isDestroyed())window.webContents.send('rayloom:preview',frame);};};connectPreview();
  const {changeRuntimeAccess}=await import('./runtime-access.mjs');
  const elevationCommand=async(operation,{noStart=false,restart=false}={})=>{
    const powershell=path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const run=require('node:util').promisify(require('node:child_process').execFile);
    try{const result=await run(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/start-elevated-agent.ps1'),'-DataDir',dataDir,'-Operation',operation,'-Mode','hardware',...(noStart?['-NoStart']:[]),...(restart?['-Restart']:[])],{windowsHide:true,timeout:135000,maxBuffer:500000});return JSON.parse(result.stdout.trim());}
    catch(e){try{return JSON.parse(e.stdout.trim());}catch{return {ok:false,error:e.message};}}
  };
  const runtimeStatus=async()=>{
    if(runtimeChanging)return {...runtimeInfo,changing:true};
    const current=await runtimeClient.call('runtime.state');
    const hardware=current.ready?await studio.invoke('hardware.status'):{starting:true};
    if(runtimeChanging)return {...runtimeInfo,changing:true};
    runtimeInfo={...current,hardware,changing:false};return runtimeInfo;
  };
  const elevateRuntime=async(operation)=>{
    if(process.platform!=='win32')throw Error('Настройка доступа к памяти пока доступна только в Windows.');
    if(runtimeChanging)throw Error('Дождитесь завершения текущего изменения.');
    runtimeChanging=true;
    try{
      const {setTimeout:delay}=await import('node:timers/promises');
      runtimeInfo=await changeRuntimeAccess({operation,
        getRuntime:()=>runtimeClient.call('runtime.state'),getHardware:()=>studio.invoke('hardware.status'),command:elevationCommand,
        onPhase:phase=>{runtimeInfo={...runtimeInfo,changing:true,change:{operation,phase}};},
        reload:()=>runtimeClient.call('runtime.settings.reload'),
        shutdown:async()=>{
          await runtimeClient.call('shutdown');runtimeClient.close();
          const deadline=Date.now()+10000;while(fs.existsSync(path.join(dataDir,'runtime.json'))&&Date.now()<deadline)await delay(100);
          if(fs.existsSync(path.join(dataDir,'runtime.json')))throw Error('Движок ещё завершает работу. Настройки автозапуска сохранены; повторите подключение позже.');
        },
        reconnect:async({launch,wait=false})=>{
          let next;const deadline=Date.now()+(wait?20000:0);
          do{try{next=await connectRuntime(root,dataDir,mode,{launch});}catch(error){if(!wait||Date.now()>=deadline)throw error;await delay(100);}}while(!next);
          runtimeClient.close();runtimeClient=next;studio=new RemoteStudio(runtimeClient,dataDir,mode);await studio.sync();connectPreview();coreReady=false;
        }
      });
      coreReady=runtimeInfo.ready;return {...runtimeInfo,changing:false};
    }finally{runtimeChanging=false;}
  };
  const guard=event=>{if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('Invalid sender');};
  ipcMain.handle('rayloom:update',async(e,action)=>{
    guard(e);
    if(action==='check')return updateService.check();
    if(action==='download')return updateService.download();
    if(action==='install'){
      if(runtimeChanging)throw Error('Дождитесь завершения изменения доступа к устройствам.');
      if(!fs.existsSync(path.join(root,'..','..','rayloom-install.json')))throw Error('Эта копия переносимая. Установите новую версию через Setup.');
      pendingUpdateExe=updateService.installedPath();quitEngine=true;app.quit();return {status:'launching'};
    }
    throw Error('Unknown update action');
  });
  const rpc=(method,params={})=>core.call('plugin.rpc',{plugin:effectsId,request:{...params,method}});
  ipcMain.handle('rayloom:snapshot',async e=>{guard(e);if(runtimeChanging)return {starting:true,mode,devices:[],plugins:[]};const snapshot=await runtimeClient.call('snapshot');coreReady=!snapshot.starting&&!snapshot.error;startupError=snapshot.error;mode=snapshot.mode;return snapshot;});
  const methods=new Set(['catalog','scene.get','scene.apply','start','stop','screen.capture','screens','shaders','shader.read','shader.save','diagnostics','blendModes','globals.get','globals.set']);
  const pluginIds={'scheduler':'org.openrgb.openrgbschedulerplugin','http-hook':'org.openrgb.openrgbhttphookplugin','hardware-sync':'org.openrgb.openrgbhardwaresyncplugin','visual-map':'org.openrgb.openrgbvisualmapplugin','e131':'org.openrgb.openrgbe131receiverplugin','skin':'org.openrgb.openrgbskinplugin'};
  const pluginMethods=new Set(['config.get','config.set','start','stop','run','automap','add','load','delete','map.set','register','background','gradient.read','gradient.save']);
  ipcMain.handle('rayloom:plugin',async(e,id,method,params={})=>{guard(e);if(!pluginIds[id]||!pluginMethods.has(method)||JSON.stringify(params).length>900000)throw new Error('Invalid plugin request');if(id!=='skin'&&!['config.get','gradient.read'].includes(method))await studio.stop();return core.call('plugin.rpc',{plugin:pluginIds[id],request:{...params,method}});});
  ipcMain.handle('rayloom:studio',async(e,method,args={})=>{
    guard(e);if(JSON.stringify(args).length>900000)throw new Error('Request too large');
    if(method==='state')return runtimeChanging?studio.state():studio.sync();
    if(method==='runtime.elevate')return elevateRuntime(args.autoStart?'Register':'StartOnce');
    if(method==='runtime.status')return runtimeStatus();
    if(method==='runtime.state'){if(runtimeChanging)return {...runtimeInfo,changing:true};runtimeInfo=await runtimeClient.call(method,args);return runtimeInfo;}
    if(method==='runtime.settings'){
      if(runtimeChanging)throw Error('Дождитесь завершения текущего изменения.');
      runtimeChanging=true;
      try{
        const current=await runtimeClient.call('runtime.state');
        if(current.settings.elevatedStartup&&args.settings?.autoStart===false){runtimeChanging=false;return await elevateRuntime('Remove');}
        if(current.settings.elevatedStartup&&args.settings?.autoStart===true)return {...current,hardware:await studio.invoke('hardware.status')};
        return await runtimeClient.call(method,args);
      }finally{runtimeChanging=false;}
    }
    if(method==='hardware.status'&&runtimeChanging)return {starting:true};
    if(method.startsWith('calibration.')||method==='hardware.status'||method==='device.enabled')return studio.invoke(method,args);
    if(method==='telemetry')return studio.telemetry();
    if(method==='save')return studio.saveLayout(args.layout,{resume:args.resume===true});
    if(method==='play'){if(!coreReady)throw Error('Ядро ещё запускается');return studio.play(args.config);}
    if(method==='stop'){await canvasRuntime.stop();await studio.stop();return studio.state();}
    if(method==='identify'||method==='rescan'||method==='diagnostics')return studio.invoke(method,args);
    if(method==='mode'){if(modeChanging)throw Error('Дождитесь смены режима');modeChanging=true;try{await canvasRuntime.stop();const result=await studio.invoke('mode',args);mode=result.mode;studio.setMode(dataDir,mode);coreReady=false;return result;}finally{modeChanging=false;}}
    if(method==='catalog')return JSON.parse(fs.readFileSync(path.join(root,'data/device-catalog.json'),'utf8'));
    if(method==='plugins.reload')return studio.loadPlugins();
    if(method==='plugins.install'){const result=await dialog.showOpenDialog(window,{properties:['openDirectory'],title:'Папка расширения Rayloom'});if(result.canceled)return null;const {validateManifest}=await import('../sdk/runtime.mjs');const source=path.join(result.filePaths[0],'manifest.json');if(fs.statSync(source).size>256000)throw Error('Manifest too large');const manifest=validateManifest(JSON.parse(fs.readFileSync(source,'utf8')));const dest=path.join(studio.dir,'extensions',manifest.id);fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2));return studio.loadPlugins();}
    if(method==='template.save'){const {saveDeviceTemplate}=await import('../shared/device-layouts.mjs');return saveDeviceTemplate(studio,args);}
    if(method==='scene.save'){const {createSceneRecord,upsertSceneRecord}=await import('../shared/scene-library.mjs');const item=createSceneRecord({name:args.name,layout:args.layout??studio.getLayout(),config:args.config});const list=studio.read('scenes',[]);studio.write('scenes',upsertSceneRecord(list,item,{replace:args.replace??true}));return studio.sync();}
    if(method==='scene.load'){const item=studio.read('scenes',[]).find(s=>s.name===args.name);if(!item)throw Error('Scene not found');await studio.saveLayout(item.layout);return {...studio.state(),config:item.config};}
    if(['game.start','game.stop','game.demo'].includes(method))return studio.invoke(method,args);
    if(method==='game.export'){const r=await dialog.showSaveDialog(window,{defaultPath:'gamestate_integration_rayloom.cfg',filters:[{name:'Game State Integration',extensions:['cfg']}]});if(!r.canceled)fs.writeFileSync(r.filePath,await studio.invoke('game.config'));return !r.canceled;}
    throw Error('Unknown studio method');
  });
  ipcMain.handle('rayloom:canvas',async(e,method,args={})=>{
    guard(e);if(JSON.stringify(args).length>900000)throw Error('Слишком большой запрос Canvas.');
    const {validateCanvasSource,canvasControls}=await import('./canvas-source.mjs');
    const list=()=>studio.read('canvas-effects',[]);
    if(args.target!==undefined&&!['preview','output'].includes(args.target))throw Error('Неизвестная цель Canvas.');
    const tagged=(state,target)=>({...state,target});
    if(method==='state'){
      if(args.target==='preview')return tagged(canvasRuntime.state(),'preview');
      const remote=await runtimeClient.call('canvas',{method:'state'});
      return args.target==='output'||remote.running?tagged(remote,'output'):tagged(canvasRuntime.state(),'preview');
    }
    if(method==='list')return list();
    if(method==='read')return list().find(item=>item.id===args.id)??null;
    if(method==='save'){const source=validateCanvasSource(args.source),name=safeName(args.name),items=list();const id=items.some(i=>i.id===args.id)?args.id:require('node:crypto').randomUUID();const item={id,name,source,controls:canvasControls(source)};studio.write('canvas-effects',[...items.filter(i=>i.id!==id),item]);return item;}
    if(method==='import'){const r=await dialog.showOpenDialog(window,{title:'HTML Canvas эффект',properties:['openFile'],filters:[{name:'HTML эффект',extensions:['html','htm']}]});if(r.canceled)return null;if(fs.statSync(r.filePaths[0]).size>800000)throw Error('HTML файл слишком большой.');const source=validateCanvasSource(fs.readFileSync(r.filePaths[0],'utf8'));return {name:path.basename(r.filePaths[0],path.extname(r.filePaths[0])),source,controls:canvasControls(source)};}
    if(method==='export'){const source=validateCanvasSource(args.source);const r=await dialog.showSaveDialog(window,{defaultPath:safeName(args.name||'Canvas')+'.html',filters:[{name:'HTML эффект',extensions:['html']}]});if(r.canceled)return false;fs.writeFileSync(r.filePath,source);return true;}
    if(method==='preview')return tagged(await canvasRuntime.start({...args,output:false}),'preview');
    if(method==='play'){await canvasRuntime.stop();return tagged(await runtimeClient.call('canvas',{method:'play',args}),'output');}
    if(method==='stop'){
      if(args.target==='preview')return tagged(await canvasRuntime.stop(),'preview');
      if(args.target!=='output')await canvasRuntime.stop();
      return tagged(await runtimeClient.call('canvas',{method:'stop'}),'output');
    }
    if(method==='parameters'){
      if(args.target==='preview')return tagged(canvasRuntime.update(args.parameters),'preview');
      const remote=await runtimeClient.call('canvas',{method:'state'});
      return args.target==='output'||remote.running?tagged(await runtimeClient.call('canvas',{method:'parameters',args}),'output'):tagged(canvasRuntime.update(args.parameters),'preview');
    }
    throw Error('Неизвестная команда редактора Canvas.');
  });
  ipcMain.handle('rayloom:theme-file',async(e)=>{guard(e);const r=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Rayloom theme / OpenRGB QSS',extensions:['json','qss']}]});if(r.canceled)return null;const file=r.filePaths[0];const text=fs.readFileSync(file,'utf8');if(text.length>200000)throw new Error('Theme too large');if(path.extname(file).toLowerCase()==='.json')return JSON.parse(text);const find=(re,fallback)=>text.match(re)?.[1]??fallback;return {name:path.basename(file),accent:find(/selection-background-color\s*:\s*(#[0-9a-fA-F]{6})/,'#b4f17b'),background:find(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})/,'#101113'),panel:find(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})/,'#191a1e'),text:find(/(?:^|[;{])\s*color\s*:\s*(#[0-9a-fA-F]{6})/,'#e9e9ed'),load_at_startup:true,importNote:'Из QSS перенесена палитра. Геометрия и селекторы Qt не применяются к Electron.'};});
  ipcMain.handle('rayloom:effect-preview',async(e,method,args={})=>{guard(e);if(!['frame','stop'].includes(method)||!args||typeof args!=='object'||JSON.stringify(args).length>64000)throw Error('Invalid preview request');return method==='frame'?nativeEffectPreviews.frame(args):nativeEffectPreviews.stop(args);});
  ipcMain.handle('rayloom:effects',async(e,method,params={})=>{guard(e);if(!methods.has(method)||JSON.stringify(params).length>900000)throw new Error('Invalid Effects request');if(method==='scene.apply')params={...params,profile:await rpc('scene.validate',{profile:migrateLegacyEffectsProfile(params.profile)})};if(['scene.apply','start','stop'].includes(method))await studio.stop();return rpc(method,params);});
  ipcMain.handle('rayloom:scenes',async(e,method,args={})=>{
    guard(e);const dir=path.join(dataDir,args.kind==='preset'?'presets':'scenes');fs.mkdirSync(dir,{recursive:true});
    if(method==='list')return fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5));
    if(method==='legacy') {const p=path.join(dataDir,'scene.json');if(!fs.existsSync(p))return null;const {effectProfile}=await import('./effects.mjs');return migrateLegacyEffectsProfile(effectProfile({...JSON.parse(fs.readFileSync(p,'utf8')),devices:await core.call('devices.list')}));}
    if(method==='import') {const r=await dialog.showOpenDialog(window,{filters:[{name:'Effects profile',extensions:['json']}],properties:['openFile']});if(r.canceled)return null;const text=fs.readFileSync(r.filePaths[0],'utf8');if(text.length>900000)throw new Error('Профиль слишком большой');const v=JSON.parse(text);return migrateLegacyEffectsProfile(v['OpenRGB Effects Plugin']??v.plugins?.['OpenRGB Effects Plugin']??v.Plugins?.['OpenRGB Effects Plugin']??v);}
    if(method==='export'){const r=await dialog.showSaveDialog(window,{defaultPath:safeName(args.name||'Scene')+'.json',filters:[{name:'Effects JSON',extensions:['json']}]});if(!r.canceled){fs.writeFileSync(r.filePath,JSON.stringify(args.profile,null,2));return true;}return false;}
    const file=path.join(dir,safeName(args.name)+'.json');
    if(method==='load')return migrateLegacyEffectsProfile(JSON.parse(fs.readFileSync(file,'utf8')));
    if(method==='delete'){fs.unlinkSync(file);return true;}
    if(method==='save'){const text=JSON.stringify(args.profile,null,2);if(text.length>900000)throw new Error('Профиль слишком большой');fs.writeFileSync(file+'.tmp',text);fs.renameSync(file+'.tmp',file);if(args.kind!=='preset'&&!await core.call('profiles.save-effects',{name:args.name,profile:args.profile}))throw new Error('Сцена сохранена, но профиль для интеграций создать не удалось');return true;}
    throw new Error('Unknown scene operation');
  });
  ipcMain.handle('rayloom:file',async(e,kind)=>{guard(e);if(!['gif','texture'].includes(kind))throw new Error('Invalid file kind');const r=await dialog.showOpenDialog(window,{filters:[{name:kind==='gif'?'GIF':'Texture',extensions:kind==='gif'?['gif']:['png','jpg','jpeg','bmp','webp']}],properties:['openFile']});return r.canceled?null:r.filePaths[0];});
  ipcMain.handle('rayloom:window',(e,action)=>{guard(e);if(runtimeChanging&&['quit','close'].includes(action))throw Error('Дождитесь завершения запроса Windows.');switch(action){case 'minimize':window.minimize();break;case 'maximize':window.isMaximized()?window.unmaximize():window.maximize();break;case 'fullscreen-enter':window.setFullScreen(true);break;case 'fullscreen-exit':window.setFullScreen(false);break;case 'hide':window.hide();break;case 'quit':quitEngine=true;app.quit();break;case 'close':app.quit();break;case 'state':break;default:throw new Error('Invalid window action');}return {maximized:window.isMaximized(),fullscreen:window.isFullScreen(),visible:window.isVisible(),minimized:window.isMinimized()};});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  const brandIcon=nativeImage.createFromPath(path.join(root,'public/brand/rayloom-256.png'));window.setIcon(brandIcon);
  if(process.platform==='darwin')app.dock?.setIcon(brandIcon);
  tray=new Tray(brandIcon.resize({width:32,height:32}));
  tray.setToolTip('Rayloom — управление светом');
  tray.on('click',show);tray.on('double-click',show);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Открыть Rayloom',click:show},{label:'Остановить эффекты',click:()=>canvasRuntime.stop().then(()=>studio.stop()).catch(()=>{})},{type:'separator'},{label:'Закрыть окно · подсветка продолжит работать',click:()=>app.quit()},{label:'Полностью завершить Rayloom',click:()=>{quitEngine=true;app.quit();}}]));
  await window.loadFile(path.join(root,'dist',(process.env.RAYLOOM_UI??process.env.LUMEN_UI)==='legacy'?'legacy.html':'index.html'));show();
  void updateService.check().then(result=>{if(result.status==='available'&&!window.isDestroyed())window.webContents.send('rayloom:update-available',result);}).catch(error=>console.warn('Update check:',error.message));
  const updateTimer=setInterval(()=>{void updateService.check().then(result=>{if(result.status==='available'&&!window?.isDestroyed())window.webContents.send('rayloom:update-available',result);}).catch(error=>console.warn('Update check:',error.message));},6*60*60*1000);updateTimer.unref?.();
  const screenshot=process.env.RAYLOOM_SCREENSHOT??process.env.LUMEN_SCREENSHOT;
  if(screenshot)setTimeout(async()=>{try{fs.writeFileSync(screenshot,(await window.webContents.capturePage()).toPNG());}finally{app.quit();}},5000);
}).catch(e=>{console.error(e);app.quit();});
app.on('second-instance',show);
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{
  if(runtimeChanging){e.preventDefault();return;}
  if(runtimeClient&&!stopping){
    e.preventDefault();stopping=true;
    // Finish preview/calibration restoration before releasing Chromium. A
    // detached background process must not retain Electron's parent handles.
    Promise.resolve().then(async()=>{
      // A preview cache/file cleanup failure must not skip calibration recovery
      // or an explicitly requested shutdown of the lighting agent.
      for(const cleanup of [()=>nativeEffectPreviews?.dispose(),()=>canvasRuntime?.stop(),()=>studio.invoke('calibration.cancel',{resume:true}),()=>quitEngine?runtimeClient.call('shutdown'):null]){
        try{await cleanup();}catch(error){console.error(error);}
      }
    }).finally(()=>{
      runtimeClient.close();tray?.destroy();
      if(pendingUpdateExe){try{const child=require('node:child_process').spawn(pendingUpdateExe,[],{detached:true,stdio:'ignore',windowsHide:true});child.unref();}catch(error){console.error('Could not launch update:',error);}}
      app.exit(0);
    });
  }
});
