const {contextBridge,ipcRenderer}=require('electron');
let state={parameters:{},events:{health:1,ammo:1}};
try{const initial=process.argv.find(arg=>arg.startsWith('--rayloom-canvas-context='));if(initial)state=JSON.parse(decodeURIComponent(initial.slice('--rayloom-canvas-context='.length)));}catch{}
ipcRenderer.on('rayloom:canvas-context',(_event,next)=>{state=next;});
const effectApi={getState:()=>structuredClone(state)};
contextBridge.exposeInMainWorld('rayloomEffect',effectApi);
contextBridge.exposeInMainWorld('lumenEffect',effectApi); // Saved HTML effects from earlier versions.
setInterval(()=>ipcRenderer.send('rayloom:canvas-heartbeat'),400);
window.addEventListener('error',e=>ipcRenderer.send('rayloom:canvas-error',String(e.message||'Ошибка HTML эффекта').slice(0,600)));
window.addEventListener('unhandledrejection',e=>ipcRenderer.send('rayloom:canvas-error',String(e.reason?.message||e.reason||'Ошибка Promise').slice(0,600)));
