const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('rayloom',{
  platform:process.platform,
  effectPreview:(method,params={})=>ipcRenderer.invoke('rayloom:effect-preview',method,params),
  studio:(method,params={})=>ipcRenderer.invoke('rayloom:studio',method,params),
  canvas:(method,params={})=>ipcRenderer.invoke('rayloom:canvas',method,params),
  onPreview:callback=>{const listener=(_event,frame)=>callback(frame);ipcRenderer.on('rayloom:preview',listener);return ()=>ipcRenderer.removeListener('rayloom:preview',listener);},
  snapshot:()=>ipcRenderer.invoke('rayloom:snapshot'),
  effects:(method,params={})=>ipcRenderer.invoke('rayloom:effects',method,params),
  plugin:(id,method,params={})=>ipcRenderer.invoke('rayloom:plugin',id,method,params),
  themeFile:mode=>ipcRenderer.invoke('rayloom:theme-file',mode),
  scenes:(method,params={})=>ipcRenderer.invoke('rayloom:scenes',method,params),
  file:kind=>ipcRenderer.invoke('rayloom:file',kind),
  window:action=>ipcRenderer.invoke('rayloom:window',action)
  ,update:action=>ipcRenderer.invoke('rayloom:update',action),
  onUpdateAvailable:callback=>{const listener=(_event,result)=>callback(result);ipcRenderer.on('rayloom:update-available',listener);return ()=>ipcRenderer.removeListener('rayloom:update-available',listener);}
});
