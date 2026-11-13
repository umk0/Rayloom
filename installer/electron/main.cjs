// SPDX-License-Identifier: GPL-2.0-or-later
const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const payload=path.join(root,'payload');
const resultFile=path.join(root,'install-result.ini');
const initial={installDir:path.join(process.env.LOCALAPPDATA||app.getPath('home'),'Programs','Rayloom'),dataDir:path.join(process.env.LOCALAPPDATA||app.getPath('home'),'Rayloom'),sourceProfile:''};
try{const output=execFileSync('reg.exe',['query','HKCU\\Software\\Rayloom\\Install'],{encoding:'utf8',windowsHide:true});for(const [value,key] of [['Path','installDir'],['DataDir','dataDir']]){const match=output.match(new RegExp(`^\\s*${value}\\s+REG_SZ\\s+(.+)$`,'m'));if(match)initial[key]=match[1].trim();}}catch{}
let window,installing=false;
app.setName('Rayloom Setup');
app.whenReady().then(()=>{
 window=new BrowserWindow({width:860,height:600,minWidth:760,minHeight:540,frame:false,resizable:true,backgroundColor:'#101213',show:false,title:'Установка Rayloom',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.loadFile(path.join(__dirname,'index.html'));
 window.once('ready-to-show',()=>window.show());
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',event=>event.preventDefault());
});
const guard=event=>{if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('Invalid sender');};
ipcMain.handle('setup:initial',event=>{guard(event);return {...initial,version:JSON.parse(fs.readFileSync(path.join(payload,'release.json'),'utf8')).version};});
ipcMain.handle('setup:folder',async(event,current)=>{guard(event);const choice=await dialog.showOpenDialog(window,{defaultPath:typeof current==='string'?current:initial.installDir,properties:['openDirectory','createDirectory']});return choice.canceled?null:choice.filePaths[0];});
ipcMain.handle('setup:window',(event,action)=>{guard(event);if(action==='minimize')window.minimize();else if(action==='close'&&!installing)app.quit();else throw Error('Unknown window action');});
ipcMain.handle('setup:install',async(event,options)=>{
 guard(event);if(installing)throw Error('Установка уже выполняется.');
 const allowed=['installDir','dataDir','sourceProfile'];
 if(!options||typeof options!=='object'||allowed.some(key=>typeof options[key]!=='string'||options[key].length>1000))throw Error('Некорректные каталоги.');
 if(/[\r\n\[\]]/.test(options.installDir+options.dataDir))throw Error('Путь содержит недопустимый символ.');
 installing=true;
 try{
  const script=path.join(payload,'app','shared','install-release.mjs');
  const node=path.join(payload,'app','runtime','node','node.exe');
  const args=[script,'--operation','install','--package',payload,'--install',options.installDir,'--data',options.dataDir];
  if(options.sourceProfile)args.push('--source-profile',options.sourceProfile);
  const output=await new Promise((resolve,reject)=>{
   const child=spawn(node,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
   let stdout='',stderr='';
   child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>200000)child.kill();});
   child.stderr.on('data',bytes=>{stderr+=bytes;if(stderr.length>200000)child.kill();});
   child.on('error',reject);
   child.on('close',code=>code===0?resolve(stdout):reject(Error((()=>{try{return JSON.parse(stderr.trim()).error}catch{return stderr.trim()||`Ошибка установки: ${code}`}})())));
  });
  const result=JSON.parse(output.trim());
  // NSIS is only the silent container. It reads these paths to register shortcuts/uninstall.
  fs.writeFileSync(resultFile,`[Rayloom]\r\nInstallDir=${options.installDir}\r\nDataDir=${options.dataDir}\r\n`,{flag:'w'});
  return {version:result.version,operation:result.operation,migrated:result.migrated};
 }finally{installing=false;}
});
ipcMain.handle('setup:launch',async(event,installDir)=>{guard(event);if(typeof installDir!=='string'||!path.isAbsolute(installDir))throw Error('Invalid path');const exe=path.join(installDir,'current','Rayloom.exe');if(!fs.existsSync(exe))throw Error('Rayloom.exe not found');const error=await shell.openPath(exe);if(error)throw Error(error);app.quit();});
