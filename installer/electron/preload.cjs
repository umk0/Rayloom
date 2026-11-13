const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('setup',{
 initial:()=>ipcRenderer.invoke('setup:initial'),
 folder:current=>ipcRenderer.invoke('setup:folder',current),
 install:options=>ipcRenderer.invoke('setup:install',options),
 window:action=>ipcRenderer.invoke('setup:window',action),
 launch:installDir=>ipcRenderer.invoke('setup:launch',installDir)
});
