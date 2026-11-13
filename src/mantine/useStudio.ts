import {useEffect,useRef,useState} from 'react';
import {type Snapshot,type Description,type Device} from '../types';
import {type Component,type Layout,emptyLayout} from '../studio-types';
import {discoverLayout,deviceKey} from '../../shared/spatial.mjs';
import {isComponentAvailable} from '../../shared/device-visibility.mjs';
import {normalizeSceneConfig,SCENE_DEFAULTS} from '../../shared/scene-config.mjs';
import {StudioHydration} from '../../shared/studio-hydration.mjs';
import {validateDeviceLayoutPoints} from '../../shared/device-layouts.mjs';

const pointSignature=(points:Component['points'])=>JSON.stringify(points.map(p=>[p.led,p.x,p.y,p.z]).sort((a,b)=>a[0]-b[0]));
const sameComponentGeometry=(a:Component,b:Component)=>a.deviceKey===b.deviceKey&&a.zone===b.zone&&a.source===b.source&&(a.points===b.points||pointSignature(a.points)===pointSignature(b.points));

export const initialConfig=normalizeSceneConfig({...SCENE_DEFAULTS,brightness:65,color:0x7bf1b4});
export const cleanError=(value:unknown)=>String(value instanceof Error?value.message:value).replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^Error:\s*/,'');

// The view owns drafts; the background agent owns playback. Polls hydrate once,
// and never replace a local edit or an in-flight action's newer revision.
export function useStudio(){
 const [snapshot,setSnapshot]=useState<Snapshot>({devices:[],plugins:[],starting:true});
 const [state,setState]=useState<any>(null),[layout,setLayout]=useState<Layout>(emptyLayout);
 const [config,setConfigState]=useState<any>(initialConfig),[catalog,setCatalog]=useState<Description[]>([]);
 const configRef=useRef(config);
 const setConfig=(next:any)=>{const value=typeof next==='function'?next(configRef.current):next;configRef.current=value;setConfigState(value);};
 const [selected,setSelected]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [nativeRunning,setNativeRunning]=useState(false);
 const layoutRef=useRef(layout),hydration=useRef(new StudioHydration()),refreshing=useRef(false),busyRef=useRef(false),catalogLoaded=useRef(false),lastNativePoll=useRef(0),alive=useRef(true);
 const layoutEpochs=useRef(new WeakMap<Layout,number>());layoutEpochs.current.set(layoutRef.current,hydration.current.epoch);
 const enabledRevisions=useRef(new Map<string,number>());
 const geometryRevisions=useRef(new Map<string,number>());
 const previewRef=useRef<{at:number;devices:{deviceKey:string;pixels:[number,number][]}[]}|null>(null);
 const edit=(next:Layout)=>{
  const before=new Map(layoutRef.current.components.map(c=>[c.id,c])),nextIds=new Set(next.components.map(c=>c.id));
  for(const c of next.components){const previous=before.get(c.id);if(previous&&previous.enabled!==c.enabled)enabledRevisions.current.set(c.id,(enabledRevisions.current.get(c.id)??0)+1);if(!previous||!sameComponentGeometry(previous,c))geometryRevisions.current.set(c.id,(geometryRevisions.current.get(c.id)??0)+1);}
  for(const id of before.keys())if(!nextIds.has(id))geometryRevisions.current.set(id,(geometryRevisions.current.get(id)??0)+1);
  hydration.current.ownLayout();layoutRef.current=next;setLayout(next);setDirty(true);
 };
 const editConfig=(next:any)=>{hydration.current.editConfig();setConfig(next);};
 const setField=(key:string,value:any)=>editConfig((current:any)=>({...current,[key]:value}));
 const update=(component:Component)=>edit({...layoutRef.current,components:layoutRef.current.components.map(c=>c.id===component.id?component:c)});
 const adoptLayout=(next:Layout,calibrationBase?:Layout)=>{
  if(calibrationBase&&layoutEpochs.current.get(calibrationBase)!==hydration.current.epoch)return false;
  if(calibrationBase&&layoutRef.current!==calibrationBase){
   // A modal blocks pointer edits, but discovery can still add a device while
   // calibration runs. Merge only its correction into the newer local draft.
   const current=layoutRef.current;
   const components=current.components.map(component=>{
    const base=calibrationBase.components.find(c=>c.id===component.id),saved=next.components.find(c=>c.id===component.id);
    if(!base||!saved)return component;
    const before=base.calibration??{channelOrder:'RGB' as const,brightness:100},after=saved.calibration??before,local=component.calibration??before;
    const channelOrder=local.channelOrder===before.channelOrder?after.channelOrder:local.channelOrder;
    const brightness=local.brightness===before.brightness?after.brightness:local.brightness;
    return channelOrder===local.channelOrder&&brightness===local.brightness?component:{...component,calibration:{...local,channelOrder,brightness}};
   });
   edit({...current,components});return false;
  }
  hydration.current.ownLayout();layoutRef.current=next;setLayout(next);setDirty(false);return true;
 };
 async function refresh(){
  if(refreshing.current)return;refreshing.current=true;const poll=hydration.current.token();
  try{
   const [snap,s]=await Promise.all([window.rayloom.snapshot(),window.rayloom.studio('state')]);
   if(!alive.current||(snap.mode&&s.mode&&snap.mode!==s.mode))return;
   const next=hydration.current.observe({...s,mode:s.mode??snap.mode},poll);if(next.stale)return;const epoch=hydration.current.epoch;
   if(next.modeChanged){catalogLoaded.current=false;setCatalog([]);setSelected('');setConfig(initialConfig);setDirty(false);setNativeRunning(false);previewRef.current=null;}
   if(next.configError)setNotice(cleanError(next.configError));
   const preview=previewRef.current;
   if(s.running&&preview&&Date.now()-preview.at<1500){const byDevice=new Map(preview.devices.map(d=>[d.deviceKey,d.pixels]));snap.devices=snap.devices.map(d=>{const pixels=byDevice.get(deviceKey(d));if(!pixels)return d;const colors=[...d.colors];for(const [index,color] of pixels)if(index>=0&&index<colors.length)colors[index]=color;return {...d,colors};});}
   setSnapshot(snap);setState(s);if(next.layout){layoutRef.current=next.layout;setLayout(next.layout);}if(next.config)setConfig(next.config);
   if(s.running)setNativeRunning(false);
   if(!snap.starting&&!snap.error&&snap.status?.pluginsReady&&(snap.status.detectionPercent??100)>=100&&!busyRef.current){
    const found=discoverLayout(snap.devices,layoutRef.current);if(found.added)edit(found.layout);
    if(!catalogLoaded.current){catalogLoaded.current=true;try{const list=await window.rayloom.effects('catalog');if(alive.current&&hydration.current.epoch===epoch)setCatalog(list);}catch{if(hydration.current.epoch===epoch)catalogLoaded.current=false;}}
    if(!s.running&&Date.now()-lastNativePoll.current>1500){lastNativePoll.current=Date.now();try{const native=await window.rayloom.effects('scene.get');if(alive.current&&hydration.current.epoch===epoch)setNativeRunning(native.Effects?.some((e:any)=>e.AutoStart)??false);}catch{/* A native plugin failure must not break basic navigation. */}}
   }
  }finally{refreshing.current=false;}
 }
 useEffect(()=>{
  alive.current=true;let stopped=false,frame=0,pending:{devices:{deviceKey:string;pixels:[number,number][]}[]}|null=null;
  const unsubscribe=window.rayloom.onPreview?.(payload=>{pending=payload;previewRef.current={...payload,at:Date.now()};if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const current=pending;if(!current||stopped)return;const byDevice=new Map(current.devices.map(d=>[d.deviceKey,d.pixels]));setSnapshot(previous=>({...previous,devices:previous.devices.map(device=>{const pixels=byDevice.get(deviceKey(device));if(!pixels)return device;const colors=[...device.colors];for(const [index,color] of pixels)if(index>=0&&index<colors.length)colors[index]=color;return {...device,colors};})}));});});
  const tick=async()=>{try{if(!stopped)await refresh();}catch(e){if(!stopped)setNotice(cleanError(e));}};void tick();const timer=setInterval(()=>void tick(),500);
  return()=>{alive.current=false;stopped=true;clearInterval(timer);unsubscribe?.();if(frame)cancelAnimationFrame(frame);};
 },[]);
 async function run(fn:()=>Promise<any>,message?:string){if(busyRef.current)return;busyRef.current=true;setBusy(true);try{const result=await fn();if(message)setNotice(message);await refresh();return result;}catch(e){setNotice(cleanError(e));}finally{busyRef.current=false;setBusy(false);}}
 const save=async()=>{const pending=layoutRef.current;await window.rayloom.studio('save',{layout:pending,resume:true});if(layoutRef.current===pending)setDirty(false);};
 const applyDeviceLayout=async(id:string,points:Component['points'],expectedPoints:Component['points'],source:string):Promise<void>=>{
  if(busyRef.current)throw Error('Дождитесь завершения текущего действия и примените форму ещё раз.');
  busyRef.current=true;setBusy(true);
  try{
   const base=layoutRef.current,epoch=hydration.current.epoch,component=base.components.find(c=>c.id===id),revision=geometryRevisions.current.get(id)??0;
   if(!component)throw Error('Этот компонент больше не существует. Выберите устройство заново.');
   const expected=validateDeviceLayoutPoints(expectedPoints,component.points);
   if(pointSignature(component.points)!==pointSignature(expected))throw Error('Форма компонента изменилась после открытия редактора. Новые локальные правки сохранены; откройте редактор заново.');
   const validated=validateDeviceLayoutPoints(points,component.points);
   const next:Layout={...base,components:base.components.map(c=>c.id===id?{...c,points:validated,source}:c)};
   const result=await window.rayloom.studio('save',{layout:next,resume:true});
   // A cancelled engine save can return a state snapshot without throwing.
   // Confirm the complete saved draft before clearing its dirty marker.
   if(JSON.stringify(result?.layout)!==JSON.stringify(next))throw Error('Движок не подтвердил сохранение формы. Правки в редакторе сохранены; попробуйте ещё раз.');
   if(hydration.current.epoch!==epoch||!alive.current)throw Error('Форма записана для прежнего режима. Новые локальные правки сохранены; текущий режим не изменён.');
   const current=layoutRef.current,local=current.components.find(c=>c.id===id);
   if(!local||(geometryRevisions.current.get(id)??0)!==revision||!sameComponentGeometry(component,local)){
    setDirty(true);
    throw Error('Форма записана, но компонент был изменён во время сохранения. Новые локальные правки сохранены — примените их отдельно.');
   }
   if(current===base){adoptLayout(next);return;}
   // Rename, pose, group, calibration and newly discovered devices stay local.
   edit({...current,components:current.components.map(c=>c.id===id?{...c,points:validated,source}:c)});
  }finally{busyRef.current=false;if(alive.current)setBusy(false);}
 };
 const saveScene=(name:string,replace=false)=>run(async()=>{
  // A named scene is a snapshot, not a command to change live lighting.
  const saved={name,layout:structuredClone(layoutRef.current),config:normalizeSceneConfig(configRef.current)};
  await window.rayloom.studio('scene.save',{...saved,replace});return saved;
 },'Сцена сохранена');
 const removeGroup=async(id:string)=>{
  if(id==='all')throw Error('Группу «Всё пространство» нельзя удалить.');
  const before=layoutRef.current,removed=before.groups.find(group=>group.id===id),epoch=hydration.current.epoch;if(!removed)return;
  edit({...before,groups:before.groups.filter(group=>group.id!==id)});
  try{
   await save();
   if(hydration.current.epoch===epoch&&!layoutRef.current.groups.some(group=>group.id===id)&&configRef.current.group===id)editConfig({...configRef.current,group:'all'});
  }catch(error){
   // The group editor may be gone. The root still owns the freshest layout;
   // restore only the missing group, never an old layout or another mode.
   if(hydration.current.epoch===epoch&&!layoutRef.current.groups.some(group=>group.id===id))edit({...layoutRef.current,groups:[...layoutRef.current.groups,removed]});
   throw error;
  }
 };
 const play=()=>run(async()=>{const next=normalizeSceneConfig(config,state?.current??initialConfig);editConfig(next);const pending=hydration.current.token();if(dirty)await save();const result=await window.rayloom.studio('play',{config:next});if(result?.current&&hydration.current.isCurrent(pending))setConfig(result.current);setNativeRunning(false);},'Подсветка настроена');
 const stop=()=>run(async()=>{if(nativeRunning)await window.rayloom.effects('stop');await window.rayloom.studio('stop');setNativeRunning(false);},'Подсветка приостановлена');
 const identify=async(id:string,led?:number,color?:number)=>{const pending=dirty?layoutRef.current:null;const result=await window.rayloom.studio('identify',{component:id,...(led===undefined?{}:{led}),...(color===undefined?{}:{color}),...(pending?{layout:pending}:{})});if(result!==true)throw Error('Проверка порта прервана. Запустите её ещё раз.');if(pending===layoutRef.current)setDirty(false);};
 const split=(component:Component,part:Component)=>{const current=layoutRef.current,remaining=component.points.filter(p=>!part.points.some(q=>q.led===p.led));edit({...current,components:[...current.components.map(c=>c.id===component.id?{...c,points:remaining}:c),part],groups:current.groups.map(group=>group.id!=='all'&&group.members.includes(component.id)?{...group,members:[...new Set([...group.members,part.id])]}:group)});setSelected(part.id);};
 const changeMode=(mode:string)=>run(async()=>{await window.rayloom.studio('mode',{mode});hydration.current.reset(mode);catalogLoaded.current=false;lastNativePoll.current=0;previewRef.current=null;setCatalog([]);setSelected('');setConfig(initialConfig);layoutRef.current=emptyLayout;setLayout(emptyLayout);setState(null);setDirty(false);setNativeRunning(false);setSnapshot({starting:true,mode,devices:[],plugins:[]});});
 const loadScene=(name:string)=>run(async()=>{hydration.current.editConfig();const token=hydration.current.token(),pending=layoutRef.current;const next=await window.rayloom.studio('scene.load',{name});if(hydration.current.epoch!==token.epoch)return false;if(!hydration.current.isCurrent(token)||layoutRef.current!==pending){setDirty(true);setNotice('Сцена загружена в движок. Новые правки в редакторе сохранены — примените их, когда будете готовы.');return false;}adoptLayout(next.layout);setConfig(normalizeSceneConfig(next.config));setNotice('Сцена загружена. Примените её, когда будете готовы.');return true;});
 const toggleDevice=(key:string,enabled:boolean)=>run(async()=>{
  const pending=layoutRef.current,epoch=hydration.current.epoch,revisions=new Map(enabledRevisions.current);
  const next={...pending,components:pending.components.map(c=>c.deviceKey===key?{...c,enabled}:c)};
  const result=await window.rayloom.studio('device.enabled',{deviceKey:key,enabled,layout:next});if(hydration.current.epoch!==epoch)return;
  if(layoutRef.current!==pending){
   // A rename or move must survive, while the confirmed switch still updates.
   // A later participation edit, including off/on back to its old value, wins.
   const confirmed=new Map<string,Component>(result.layout.components.map((c:Component)=>[c.id,c]));
   const current=layoutRef.current,components=current.components.map(c=>{
    const saved=confirmed.get(c.id);
    return c.deviceKey===key&&saved&&(enabledRevisions.current.get(c.id)??0)===(revisions.get(c.id)??0)?{...c,enabled:saved.enabled}:c;
   });
   edit({...current,components});setNotice('Состояние устройства изменено. Новые правки в редакторе сохранены — примените их, когда будете готовы.');return;
  }
  adoptLayout(result.layout);setNotice(enabled?'Устройство включено':'Устройство скрыто из пространства');
 });
 const devices=snapshot.devices.filter(d=>d.serial!=='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL'),liveDevices=new Map(devices.map(d=>[deviceKey(d),d]));
 const rememberedDevices=Array.from(new Map(layout.components.filter(c=>!liveDevices.has(c.deviceKey)).map(c=>[c.deviceKey,{...c.device,name:c.device.name??c.name,ledCount:0,colors:[],zoneCount:0,index:-1} as Device])).values());
 const ready=!!(!snapshot.starting&&!snapshot.error&&snapshot.status?.pluginsReady&&(snapshot.status?.detectionPercent??0)>=100);
 const selectedGroup=layout.groups.find(g=>g.id===config.group)??layout.groups[0];
 const visible=layout.components.filter(c=>c.enabled&&isComponentAvailable(c,liveDevices.get(c.deviceKey)));
 const groupComponents=config.group==='all'?visible:visible.filter(c=>selectedGroup?.members.includes(c.id));
 const hasChanges=dirty||JSON.stringify(normalizeSceneConfig(config))!==JSON.stringify(state?.current);
 return {snapshot,state,layout,config,catalog,selected,setSelected,dirty,busy,notice,setNotice,ready,devices,liveDevices,rememberedDevices,groupComponents,hasChanges,nativeRunning,running:!!state?.running||nativeRunning,
  edit,editConfig,setField,update,adoptLayout,run,save,applyDeviceLayout,saveScene,removeGroup,play,stop,identify,split,changeMode,loadScene,toggleDevice,refresh,
  alias:(d:Device)=>layout.deviceAliases?.[deviceKey(d)]??d.name,
  templates:[...(state?.templates??[]),...(state?.plugins??[]).flatMap((p:any)=>p.templates??[])]};
}
export type StudioController=ReturnType<typeof useStudio>;
