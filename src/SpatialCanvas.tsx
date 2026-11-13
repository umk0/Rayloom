import {useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Button,Input,ScrollShadow,Tabs} from '@heroui/react';
import {RayloomSelect} from './StudioControls';
import {ArrowDownLeft,Box,Focus,HelpCircle,Maximize2,Minimize2,MousePointer2,Save,Scan,Search,Square,Undo2,X,ZoomIn,ZoomOut} from 'lucide-react';
import {transform,deviceKey} from '../shared/spatial.mjs';
import {isComponentAvailable,visibleComponents} from '../shared/device-visibility.mjs';
import {boundsOfPoints,boundsVisible,defaultCamera,edgeIndicator,fitCamera,gridStep,keepPointInView,panCamera,projectPoint,screenBounds,screenDeltaAlongAxis,screenDeltaToWorld,zoomAt} from '../shared/spatial-view.mjs';
import {Component,Layout} from './studio-types';
import {Device,hex} from './types';
import './spatial-canvas.css';

type Camera={cx:number;cy:number;cz:number;zoom:number;yaw:number;pitch:number};
type Viewport={width:number;height:number};
type World={x:number;y:number;z:number;led?:number};
type Projected={x:number;y:number;depth:number};
type Drag={kind:'move'|'axis'|'pan'|'orbit';pointer:number;last:{x:number;y:number};start:{x:number;y:number};camera:Camera;component?:Component;origin?:Component;center?:World;axis?:'x'|'y';axisWorld?:'x'|'y'|'z';changed?:boolean};
type Props={layout:Layout;selected:string;onSelect:(id:string)=>void;onChange:(c:Component)=>void;devices:Device[];inspector?:ReactNode;onSave?:()=>void;dirty?:boolean;busy?:boolean;onExpandedChange?:(expanded:boolean)=>void;feedback?:{text:string;error?:boolean}};
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
const readableDistance=(n:number)=>n>=1000?(n/1000).toLocaleString('ru-RU',{maximumFractionDigits:1})+' м':Math.round(n)+' мм';
const editableTarget=(t:EventTarget|null)=>t instanceof HTMLElement&&!!t.closest('input,textarea,select,[contenteditable=true],[role=tab],[role=combobox],[role=listbox],[role=option],[role=switch],[role=slider]');

export function SpatialCanvas({layout,selected,onSelect,onChange,devices,inspector,onSave,dirty=false,busy=false,onExpandedChange,feedback}:Props){
 const [mode,setMode]=useState<'2d'|'3d'>('2d');
 const [camera,setCamera]=useState<Camera>(()=>defaultCamera());
 const [viewport,setViewport]=useState<Viewport>({width:880,height:400});
 const [expanded,setExpanded]=useState(false),[help,setHelp]=useState(false),[panning,setPanning]=useState(false),[dragging,setDragging]=useState(false);
 const [announcement,setAnnouncement]=useState(''),[placeholderHeight,setPlaceholderHeight]=useState(480),[search,setSearch]=useState('');
 const rootRef=useRef<HTMLDivElement>(null),surfaceRef=useRef<HTMLDivElement>(null),svgRef=useRef<SVGSVGElement>(null);
 const actionRef=useRef({onSave,dirty,busy,help});actionRef.current={onSave,dirty,busy,help};
 const drag=useRef<Drag|null>(null),spaceHeld=useRef(false),hasFitted=useRef(false),lastComponentIds=useRef(''),cameraRef=useRef(camera),viewportRef=useRef(viewport);
 const lastEdit=useRef<Component|null>(null),gridId=useId().replace(/:/g,'');
 cameraRef.current=camera;viewportRef.current=viewport;
 const visible=useMemo(()=>visibleComponents(layout,devices) as Component[],[layout,devices]);
 const points=useMemo(()=>visible.map(c=>({c,points:c.points.map(p=>transform(p,c.pose) as World)})),[visible]);
 const pointsRef=useRef(points);pointsRef.current=points;
 const selectedRef=useRef(selected);selectedRef.current=selected;
 const allPoints=useMemo(()=>points.flatMap(v=>v.points),[points]);
 const worldBounds=useMemo(()=>boundsOfPoints(allPoints),[allPoints]);
 const selectedComponent=layout.components.find(c=>c.id===selected);
 const filteredComponents=layout.components.filter(c=>(c.name+' '+c.device.name).toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
 const colorDevices=new Map(devices.map(d=>[deviceKey(d),d]));
 const fit=(id?:string)=>{
  const target=id?pointsRef.current.find(v=>v.c.id===id)?.points??[]:pointsRef.current.flatMap(v=>v.points);
  if(!target.length)return;
  setCamera(fitCamera(target,cameraRef.current,viewportRef.current));
  setAnnouncement(id?'Выбранный компонент показан целиком':'Все компоненты показаны целиком');
 };
 const focusSelected=()=>fit(selectedRef.current||undefined);
 const setView=(next:'2d'|'3d',yaw?:number,pitch?:number)=>{
  const orientation=defaultCamera(next);
  const nextCamera={...cameraRef.current,yaw:yaw??orientation.yaw,pitch:pitch??orientation.pitch};
  setMode(next);setCamera(fitCamera(pointsRef.current.flatMap(v=>v.points),nextCamera,viewportRef.current));
 };
 const changeZoom=(factor:number)=>setCamera(c=>zoomAt(c,c.zoom*factor,{x:viewportRef.current.width/2,y:viewportRef.current.height/2},viewportRef.current));
 const openExpanded=async()=>{try{await window.rayloom.window('fullscreen-enter');setPlaceholderHeight(rootRef.current?.getBoundingClientRect().height??480);setExpanded(true);onExpandedChange?.(true);}catch{setAnnouncement('Не удалось открыть редактор на весь экран. Попробуйте ещё раз.');}};
 const closeExpanded=()=>{setExpanded(false);onExpandedChange?.(false);setHelp(false);drag.current=null;setDragging(false);spaceHeld.current=false;setPanning(false);void window.rayloom.window('fullscreen-exit').catch(()=>setAnnouncement('Не удалось выйти из полноэкранного режима'));};
 const pointAt=(e:{clientX:number;clientY:number})=>{const rect=svgRef.current!.getBoundingClientRect();return {x:(e.clientX-rect.left)*viewportRef.current.width/rect.width,y:(e.clientY-rect.top)*viewportRef.current.height/rect.height};};
 useEffect(()=>{
  const surface=surfaceRef.current;if(!surface)return;
  const resize=()=>{const rect=surface.getBoundingClientRect();if(rect.width&&rect.height)setViewport(old=>Math.abs(old.width-rect.width)<1&&Math.abs(old.height-rect.height)<1?old:{width:rect.width,height:rect.height});};
  const observer=new ResizeObserver(resize);observer.observe(surface);resize();
  svgRef.current?.focus({preventScroll:true});return()=>observer.disconnect();
 },[expanded]);
 useEffect(()=>{
  const ids=visible.map(c=>c.id).join('\n');
  if(allPoints.length&&(!hasFitted.current||lastComponentIds.current!==ids)){
   hasFitted.current=true;lastComponentIds.current=ids;fit();
  }
 },[visible.map(c=>c.id).join('|'),allPoints.length]);
 useEffect(()=>{
  if(!selected)return;
  const p=pointsRef.current.find(v=>v.c.id===selected)?.points??[];
  if(p.length&&!boundsVisible(screenBounds(p,cameraRef.current,viewportRef.current),viewportRef.current,24))fit(selected);
 },[selected]);
 useEffect(()=>{
  const surface=surfaceRef.current;if(!surface)return;
  const wheel=(event:WheelEvent)=>{
   event.preventDefault();event.stopPropagation();
   if(drag.current)return;
   const v=viewportRef.current,c=cameraRef.current,rect=surface.getBoundingClientRect(),anchor={x:(event.clientX-rect.left)*v.width/rect.width,y:(event.clientY-rect.top)*v.height/rect.height};
   const units=event.deltaMode===1?16:event.deltaMode===2?v.height:1;
   const dx=event.deltaX*units,dy=event.deltaY*units;
   if(event.altKey&&mode==='3d'){setCamera({...c,yaw:c.yaw+dy*.003,pitch:clamp(c.pitch+dx*.003,-Math.PI/2,Math.PI/2)});return;}
   if(event.shiftKey){setCamera(panCamera(c,-(Math.abs(dx)>Math.abs(dy)?dx:dy),0));return;}
   if(Math.abs(dx)>Math.abs(dy)&&!event.ctrlKey){setCamera(panCamera(c,-dx,-dy));return;}
   setCamera(zoomAt(c,c.zoom*Math.exp(clamp(-dy*(event.ctrlKey?.0006:.0018),-1,1)),anchor,v));
  };
  surface.addEventListener('wheel',wheel,{passive:false});
  return()=>surface.removeEventListener('wheel',wheel);
 },[expanded,mode]);
 useEffect(()=>{
  if(!expanded)return;
  const previous=document.activeElement;
  const overlayKeys=new WeakSet<KeyboardEvent>();
  const capture=(event:KeyboardEvent)=>{
   // Capture before React Aria dismisses a portal: its dialog can be removed
   // from the DOM before this event reaches our bubbling window listener.
   const targetDialog=event.target instanceof Element?event.target.closest('[role=dialog]'):null;
   if((targetDialog&&targetDialog!==rootRef.current)||document.querySelector('[role=listbox]')||Array.from(document.querySelectorAll('[role=dialog]')).some(node=>node!==rootRef.current&&node.getClientRects().length))overlayKeys.add(event);
  };
  const key=(event:KeyboardEvent)=>{
   if(overlayKeys.has(event)||event.defaultPrevented||document.querySelector('[role=listbox]'))return;
   const activeDialog=event.target instanceof Element?event.target.closest('[role=dialog]'):null;
   // HeroUI popovers and calibration dialogs are portals outside this editor.
   // They own Escape and focus while open.
   if(activeDialog&&activeDialog!==rootRef.current)return;
   if(document.querySelector('[data-overlay-container] [role=dialog]'))return;
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
    event.preventDefault();const action=actionRef.current;if(action.dirty&&!action.busy)action.onSave?.();return;
   }
   if(event.key==='Escape'&&!editableTarget(event.target)&&!drag.current){
    event.preventDefault();if(actionRef.current.help){setHelp(false);return;}closeExpanded();
   }
   if(event.key==='Tab'&&rootRef.current){
    const targets=Array.from(rootRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')).filter(el=>el.tabIndex>=0&&el.getClientRects().length);
    const first=targets[0],last=targets.at(-1),current=document.activeElement;
    if(event.shiftKey&&(current===first||!rootRef.current.contains(current))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(current===last||!rootRef.current.contains(current))){event.preventDefault();first?.focus();}
   }
  };
  window.addEventListener('keydown',capture,true);window.addEventListener('keydown',key);
  return()=>{window.removeEventListener('keydown',capture,true);window.removeEventListener('keydown',key);if(previous instanceof HTMLElement)previous.focus({preventScroll:true});};
 },[expanded]);
 useEffect(()=>()=>{if(expanded)void window.rayloom.window('fullscreen-exit').catch(()=>{});},[expanded]);
 const begin=(e:React.PointerEvent<SVGSVGElement>,component?:Component)=>{
  if(e.button>2)return;
  e.preventDefault();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);
  const pos=pointAt(e),orbit=mode==='3d'&&(e.altKey||e.button===2),pan=e.button===1||e.button===2||spaceHeld.current;
  const axisWorld=(e.target as Element).closest('[data-axis]')?.getAttribute('data-axis') as 'x'|'y'|'z'|undefined;
  const kind=orbit?'orbit':pan||!component?'pan':axisWorld?'axis':'move';
  if(component&&(kind==='move'||kind==='axis'))onSelect(component.id);
  const local=component?boundsOfPoints(component.points):null;
  drag.current={kind,pointer:e.pointerId,last:pos,start:pos,camera:{...cameraRef.current},axisWorld,component:component?structuredClone(component):undefined,origin:component?structuredClone(component):undefined,center:local?{x:(local.minX+local.maxX)/2,y:(local.minY+local.maxY)/2,z:(local.minZ+local.maxZ)/2}:undefined};
  setDragging(true);setPanning(kind==='pan');
 };
 const move=(e:React.PointerEvent<SVGSVGElement>)=>{
  const d=drag.current;if(!d||d.pointer!==e.pointerId)return;
  const pos=pointAt(e),c=cameraRef.current,dx=pos.x-d.last.x,dy=pos.y-d.last.y;d.last=pos;
  if(d.kind==='pan'){setCamera(panCamera(c,dx,dy));return;}
  if(d.kind==='orbit'){setCamera({...c,yaw:c.yaw+dx*.007,pitch:clamp(c.pitch+dy*.007,-Math.PI/2,Math.PI/2)});return;}
  if(!d.component)return;
  let x=dx,y=dy;
  if(e.shiftKey&&d.kind==='move'){d.axis??=Math.abs(pos.x-d.start.x)>=Math.abs(pos.y-d.start.y)?'x':'y';if(d.axis==='x')y=0;else x=0;}else d.axis=undefined;
  const delta=d.kind==='axis'&&d.axisWorld?{x:0,y:0,z:0,[d.axisWorld]:screenDeltaAlongAxis(x,y,d.axisWorld,c)*(e.shiftKey?.1:1)}:screenDeltaToWorld(x,y,c),pose={...d.component.pose};
  if(x||y)d.changed=true;
  for(const key of ['x','y','z'] as const)pose[key]=clamp(pose[key]+delta[key],-100000,100000);
  d.component={...d.component,pose};
  const output={...pose};
  if(e.ctrlKey)for(const key of ['x','y','z'] as const)if(d.kind!=='axis'||key===d.axisWorld)output[key]=Math.round(output[key]/10)*10;
  onChange({...d.component,pose:output});
  const center=transform(d.center??{x:0,y:0,z:0},output);
  setCamera(keepPointInView(c,center,viewportRef.current,48));
 };
 const finish=(e?:React.PointerEvent<SVGSVGElement>)=>{
  const d=drag.current;
  if((d?.kind==='move'||d?.kind==='axis')&&d.origin&&d.changed)lastEdit.current=d.origin;
  if(e&&svgRef.current?.hasPointerCapture(e.pointerId))svgRef.current.releasePointerCapture(e.pointerId);
  drag.current=null;setDragging(false);setPanning(spaceHeld.current);
 };
 const undoMove=()=>{if(lastEdit.current){const original=lastEdit.current,current=layout.components.find(c=>c.id===original.id);lastEdit.current=null;if(!current)return;const restored={...current,pose:{...original.pose}};onChange(restored);setCamera(fitCamera(restored.points.map(p=>transform(p,restored.pose)),cameraRef.current,viewportRef.current));setAnnouncement('Последнее перемещение отменено');}};
 const keyboard=(e:React.KeyboardEvent)=>{
  // Keyboard canvas commands must never affect an inspector control or a
  // nested portal (for example a LED button in the matrix editor).
  if(e.target!==svgRef.current&&!(e.target instanceof Node&&svgRef.current?.contains(e.target)))return;
  if(editableTarget(e.target)||(e.target instanceof Element&&e.target.closest('button,a')))return;
  if(e.code==='Space'){spaceHeld.current=true;setPanning(true);e.preventDefault();return;}
  if(e.key.toLowerCase()==='f'||e.key==='0'){e.preventDefault();fit();return;}
  if(e.key==='Home'){e.preventDefault();focusSelected();return;}
  if(e.key==='+'||e.key==='='){e.preventDefault();changeZoom(1.2);return;}
  if(e.key==='-'){e.preventDefault();changeZoom(1/1.2);return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undoMove();return;}
  if(e.key==='Escape'&&drag.current){e.preventDefault();e.stopPropagation();const d=drag.current;if(d.origin&&(d.kind==='move'||d.kind==='axis'))onChange(d.origin);setCamera(d.camera);finish();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
   e.preventDefault();const amount=e.shiftKey?10:e.altKey?.1:1;
   const delta=screenDeltaToWorld((e.key==='ArrowRight'?amount:e.key==='ArrowLeft'?-amount:0)*cameraRef.current.zoom,(e.key==='ArrowDown'?amount:e.key==='ArrowUp'?-amount:0)*cameraRef.current.zoom,cameraRef.current);
   if(selectedComponent){lastEdit.current=structuredClone(selectedComponent);const next={...selectedComponent,pose:{...selectedComponent.pose,x:clamp(selectedComponent.pose.x+delta.x,-100000,100000),y:clamp(selectedComponent.pose.y+delta.y,-100000,100000),z:clamp(selectedComponent.pose.z+delta.z,-100000,100000)}};onChange(next);setCamera(keepPointInView(cameraRef.current,transform({x:0,y:0,z:0},next.pose),viewportRef.current));}
   else setCamera(panCamera(cameraRef.current,(e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0),(e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0)));
  }
 };
 const projected=points.map(({c,points})=>({c,points,screen:points.map(p=>projectPoint(p,camera,viewport) as Projected),bounds:screenBounds(points,camera,viewport,10)}));
 const outside=projected.filter(v=>v.points.length&&!boundsVisible(v.bounds,viewport,16));
 const step=gridStep(camera.zoom),gridPixels=step*camera.zoom,origin=projectPoint({x:0,y:0,z:0},camera,viewport);
 const axisOrigin={x:38,y:viewport.height-34},axisBase=projectPoint({x:0,y:0,z:0},{...camera,cx:0,cy:0,cz:0,zoom:1},{width:0,height:0});
 const gridLines=useMemo(()=>{
  if(mode==='2d')return [];
  const extent=Math.max(viewport.width,viewport.height)/camera.zoom,range=step*Math.ceil(extent/step);
  const cx=Math.round(camera.cx/step)*step,cy=Math.round(camera.cy/step)*step,result:{a:World;b:World}[]=[];
  for(let i=-12;i<=12;i++){result.push({a:{x:cx+i*step,y:cy-range,z:0},b:{x:cx+i*step,y:cy+range,z:0}});result.push({a:{x:cx-range,y:cy+i*step,z:0},b:{x:cx+range,y:cy+i*step,z:0}});}
  return result;
 },[mode,camera,step,viewport]);
 const editor=<div ref={rootRef} className={'spatial-editor '+(expanded?'is-expanded ':'')+(dragging?'is-dragging':'')} role={expanded?'dialog':undefined} aria-modal={expanded?true:undefined} aria-label={expanded?'Редактор пространства':undefined} onKeyDown={keyboard} onKeyUp={e=>{if(e.code==='Space'){spaceHeld.current=false;setPanning(false);}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)){spaceHeld.current=false;setPanning(false);}}}>
  <div className="spatial-topbar"><div className="spatial-title"><Box size={17}/><div><strong>{expanded?'Редактор пространства':'Расположение устройств'}</strong><small>{mode==='2d'?'Плоская схема · просто перетащите компоненты':'Объём · положение и наклон по трём осям'}</small></div></div>
   <Tabs className="rayloom-tabs spatial-mode-tabs" selectedKey={mode} onSelectionChange={key=>setView(key as '2d'|'3d')}><Tabs.ListContainer><Tabs.List aria-label="Режим пространства"><Tabs.Tab id="2d"><Square size={14}/>2D<Tabs.Indicator/></Tabs.Tab><Tabs.Tab id="3d"><Box size={14}/>3D<Tabs.Indicator/></Tabs.Tab></Tabs.List></Tabs.ListContainer></Tabs>
   <button className="spatial-expand" aria-label={expanded?'Закрыть большой редактор':'Развернуть редактор пространства'} onClick={expanded?closeExpanded:openExpanded}>{expanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}<span>{expanded?'Готово':'На весь экран'}</span></button>
  </div>
  <div className="spatial-editor-body">
   {expanded&&<aside className="spatial-component-browser" aria-label="Компоненты пространства">
    <div className="spatial-inspector-heading"><Box size={16}/><strong>Компоненты</strong><span>{layout.components.length}</span></div>
    <div className="spatial-component-search"><Search size={14}/><Input aria-label="Поиск компонентов" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Найти устройство или порт"/></div>
    <ScrollShadow hideScrollBar size={18} className="spatial-component-list">{filteredComponents.map(c=>{const available=isComponentAvailable(c,colorDevices.get(c.deviceKey));return <button type="button" key={c.id} className={c.id===selected?'selected':''} aria-pressed={c.id===selected} onClick={()=>onSelect(c.id)}><span>{c.name}</span><small>{!available?'Не подключён':!c.enabled?'Исключён из подсветки':c.points.length+' LED'}{!available||!c.enabled?' · настройки сохранены':''}</small><Box size={14}/></button>;})}{!filteredComponents.length&&<p className="spatial-list-empty">{layout.components.length?'Ничего не найдено. Попробуйте другое название.':'Подключите устройство, чтобы добавить его в пространство.'}</p>}</ScrollShadow>
    <p className="spatial-list-hint">Выключенные и отключённые устройства остаются в списке. Их настройки можно изменить здесь.</p>
   </aside>}
   <div className="spatial-stage-column">
   <div className="spatial-tools"><div><button onClick={()=>fit()} title="Показать все компоненты · F"><Scan size={15}/><span>Показать всё</span></button><button disabled={!selectedComponent} onClick={focusSelected} title="Найти выбранный компонент · Home"><Focus size={15}/><span>Найти выбранное</span></button><button aria-label="Отменить последнее перемещение" onClick={undoMove} disabled={!lastEdit.current} title="Отменить последнее перемещение · Ctrl+Z"><Undo2 size={15}/></button></div><div>{mode==='3d'&&<RayloomSelect ariaLabel="Ракурс пространства" value="" placeholder="Ракурс…" onChange={value=>{if(value==='top')setView('3d',0,0);if(value==='front')setView('3d',0,Math.PI/2);if(value==='side')setView('3d',Math.PI/2,Math.PI/2);if(value==='volume')setView('3d');}} options={[{value:'volume',label:'Объём'},{value:'top',label:'Сверху · XY'},{value:'front',label:'Спереди · XZ'},{value:'side',label:'Сбоку · YZ'}]}/>}<button aria-label="Отдалить пространство" onClick={()=>changeZoom(1/1.2)}><ZoomOut size={15}/></button><button aria-label="Сбросить масштаб пространства" className="spatial-zoom" onClick={()=>fit()}>{Math.round(camera.zoom*100)}%</button><button aria-label="Приблизить пространство" onClick={()=>changeZoom(1.2)}><ZoomIn size={15}/></button><button aria-label="Управление пространством" aria-expanded={help} onClick={()=>setHelp(!help)}><HelpCircle size={16}/></button></div></div>
   <div className={'spatial-surface '+(panning?'is-panning':'')} ref={surfaceRef}>
    <svg ref={svgRef} className="spatial-canvas" viewBox={'0 0 '+viewport.width+' '+viewport.height} tabIndex={0} role="application" aria-label={mode==='2d'?'Двумерное расположение светодиодов':'Трёхмерное расположение светодиодов'} aria-describedby={gridId+'-instructions'} onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{const id=(e.target as Element).closest('[data-component]')?.getAttribute('data-component');begin(e,id?layout.components.find(c=>c.id===id):undefined);}} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{const d=drag.current;if(d?.origin&&(d.kind==='move'||d.kind==='axis'))onChange(d.origin);finish();}} onDoubleClick={e=>{const id=(e.target as Element).closest('[data-component]')?.getAttribute('data-component');if(id){onSelect(id);fit(id);}}}>
     <defs><pattern id={gridId} x={origin.x%gridPixels} y={origin.y%gridPixels} width={gridPixels} height={gridPixels} patternUnits="userSpaceOnUse"><path d={'M '+gridPixels+' 0 H 0 V '+gridPixels} fill="none" stroke="#38505d" strokeWidth=".65"/><circle r="1.2" fill="#4f6c78"/></pattern></defs>
     <rect width={viewport.width} height={viewport.height} fill={mode==='2d'?'url(#'+gridId+')':'#14232c'}/>
     {gridLines.map((line,i)=>{const a=projectPoint(line.a,camera,viewport),b=projectPoint(line.b,camera,viewport);return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#35505d" strokeWidth=".7" opacity=".5"/>;})}
     {projected.sort((a,b)=>(a.screen[0]?.depth??0)-(b.screen[0]?.depth??0)).map(({c,points,screen,bounds})=>{
      if(!bounds||!boundsVisible(bounds,viewport,0))return null;
      const active=c.id===selected,d=colorDevices.get(c.deviceKey),left=bounds.left,top=bounds.top,w=Math.max(32,bounds.right-left),h=Math.max(28,bounds.bottom-top);
      return <g key={c.id} data-component={c.id} className={'spatial-component '+(active?'selected':'')}  aria-label={c.name}><rect x={left} y={top} width={w} height={h} rx={7} fill={active?'#aed69917':'#15212bba'} stroke={active?'#d0efaf':'#58707d'} strokeWidth={active?1.5:1} strokeDasharray={active?'':'4 5'}/>
       <text x={left+1} y={Math.max(15,top-9)} fill={active?'#e0f3cb':'#a3bac7'} fontSize={11}>{c.name.length>40?c.name.slice(0,38)+'…':c.name}{!d?' · не подключено':''}{!c.enabled?' · выключено':''}</text>
       {screen.map((p,i)=><circle key={points[i].led??i} cx={p.x} cy={p.y} r={clamp(camera.zoom*3,1.8,4.3)} fill={d&&points[i].led!==undefined&&d.colors[points[i].led!]?hex(d.colors[points[i].led!]):active?'#c6dda8':'#6b8999'}/>)}
      </g>;
     })}
     {mode==='3d'&&selectedComponent&&(()=>{const target=projected.find(p=>p.c.id===selectedComponent.id);if(!target?.points.length)return null;const b=boundsOfPoints(target.points),center={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,z:(b.minZ+b.maxZ)/2},screen=projectPoint(center,camera,viewport);if(screen.x<0||screen.y<0||screen.x>viewport.width||screen.y>viewport.height)return null;return <g className="spatial-transform-handles">{([{axis:'x',color:'#ec9ca7'},{axis:'y',color:'#c8e09a'},{axis:'z',color:'#93bff3'}] as const).map(({axis,color})=>{const end=projectPoint({...center,[axis]:center[axis]+64/camera.zoom},camera,viewport);if(Math.hypot(end.x-screen.x,end.y-screen.y)<10)return null;return <g key={axis} data-component={selectedComponent.id} data-axis={axis} className="spatial-axis-handle"><title>Переместить по оси {axis.toUpperCase()} · Shift для точного движения</title><line x1={screen.x} y1={screen.y} x2={end.x} y2={end.y} stroke="transparent" strokeWidth="18"/><line x1={screen.x} y1={screen.y} x2={end.x} y2={end.y} stroke={color} strokeWidth="2.5"/><circle cx={end.x} cy={end.y} r="6" fill={color} stroke="#15232b" strokeWidth="2"/><text x={end.x+8} y={end.y-7} fill={color} fontSize="12" fontWeight="600">{axis.toUpperCase()}</text></g>;})}<circle cx={screen.x} cy={screen.y} r="4" fill="#e4eedb" pointerEvents="none"/></g>;})()}
     {!allPoints.length&&<g fill="#94adbb" textAnchor="middle"><text x={viewport.width/2} y={viewport.height/2-5} fontSize="15">Нет включённых устройств</text><text x={viewport.width/2} y={viewport.height/2+20} fontSize="12">Подключите устройство и включите его на странице «Устройства»</text></g>}
     {mode==='3d'&&[{label:'X',p:{x:32,y:0,z:0},color:'#eba1a9'},{label:'Y',p:{x:0,y:32,z:0},color:'#b6d990'},{label:'Z',p:{x:0,y:0,z:32},color:'#8fbcf3'}].map(a=>{const p=projectPoint(a.p,{...camera,cx:0,cy:0,cz:0,zoom:1},{width:0,height:0});return <g key={a.label} pointerEvents="none"><line x1={axisOrigin.x} y1={axisOrigin.y} x2={axisOrigin.x+p.x-axisBase.x} y2={axisOrigin.y+p.y-axisBase.y} stroke={a.color}/><text x={axisOrigin.x+p.x+4} y={axisOrigin.y+p.y-3} fill={a.color} fontSize="10">{a.label}</text></g>;})}
    </svg>
    {outside.length>0&&<div className="spatial-offscreen-banner"><span>Вне кадра: {outside.length}</span><button onClick={()=>fit()}>Показать всё</button></div>}
    {outside.slice(0,8).map(({c,points})=>{const bounds=boundsOfPoints(points),p=edgeIndicator({x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2,z:(bounds.minZ+bounds.maxZ)/2},camera,viewport);return <button key={c.id} className="spatial-edge-indicator" style={{left:p.x,top:p.y}} onClick={()=>{onSelect(c.id);fit(c.id);}} aria-label={'Найти '+c.name} title={'За пределами кадра: '+c.name}><ArrowDownLeft size={15} style={{transform:'rotate('+(p.angle+135)+'deg)'}}/></button>;})}
    {help&&<ScrollShadow hideScrollBar size={20} className="spatial-help"><button className="spatial-help-close" aria-label="Закрыть подсказки управления" onClick={()=>setHelp(false)}><X size={14}/></button><strong>Управление пространством</strong><dl><dt>Колёсико</dt><dd>Масштаб под курсором</dd><dt>Ctrl + колёсико</dt><dd>Точный масштаб</dd><dt>Фон / средняя кнопка</dt><dd>Перемещение камеры</dd><dt>Пробел + перетаскивание</dt><dd>Перемещение камеры</dd><dt>Shift + колёсико</dt><dd>Камера влево / вправо</dd>{mode==='3d'&&<><dt>Alt + перетаскивание</dt><dd>Вращение камеры</dd><dt>Правая кнопка</dt><dd>Вращение камеры</dd><dt>Alt + колёсико</dt><dd>Поворот камеры</dd></>}<dt>Shift + перетаскивание LED</dt><dd>Двигать по прямой</dd><dt>Ctrl + перетаскивание LED</dt><dd>Привязка к 10 мм</dd><dt>Стрелки / Shift / Alt</dt><dd>Сдвиг на 1 / 10 / 0,1 мм</dd><dt>F / Home</dt><dd>Показать всё / выбранное</dd><dt>Ctrl + Z</dt><dd>Отменить последнее перемещение</dd></dl></ScrollShadow>}
   </div>
   <div className="spatial-status" id={gridId+'-instructions'}><span><MousePointer2 size={12}/>Перетащите компонент · колёсико меняет масштаб{mode==='3d'?' · Alt вращает камеру':''}</span><span>Сетка {readableDistance(step)} · область расширяется автоматически</span></div>
   {worldBounds&&<div className="spatial-world-size"><span>Габариты расстановки: {readableDistance(worldBounds.maxX-worldBounds.minX)} × {readableDistance(worldBounds.maxY-worldBounds.minY)}{mode==='3d'?' × '+readableDistance(worldBounds.maxZ-worldBounds.minZ):''}</span><span>{visible.length} компонентов · {allPoints.length} LED</span></div>}
  </div>
  {expanded&&<aside className="spatial-expanded-inspector" aria-label="Настройка выбранного компонента">
   <div className="spatial-inspector-heading"><strong>{selectedComponent?'Настройки компонента':'Выберите компонент'}</strong><span>{selectedComponent?selectedComponent.points.length+' LED':layout.components.length+' в пространстве'}</span></div>
   <div className="spatial-compact-selector"><RayloomSelect label="Компонент" value={selected} onChange={onSelect} options={layout.components.map(c=>({value:c.id,label:c.name,description:!isComponentAvailable(c,colorDevices.get(c.deviceKey))?'Не подключён':!c.enabled?'Исключён из подсветки':c.points.length+' LED'}))}/></div>
   <ScrollShadow hideScrollBar size={24} className="spatial-inspector-scroll">
    {selectedComponent&&inspector?inspector:<div className="spatial-select-hint"><Box size={28}/><strong>Настройте каждый источник света</strong><p>Выберите компонент на схеме или в списке. Здесь можно изменить имя, подсветить порт, настроить цвета, группы и матрицу.</p></div>}
   </ScrollShadow>
   <div className="spatial-expanded-footer">
    {feedback?.text&&<p className={'spatial-feedback '+(feedback.error?'is-error':'')} role={feedback.error?'alert':'status'}>{feedback.text}</p>}
    <div className="spatial-save-state" role="status"><span className={dirty?'is-dirty':''}>{busy?'Выполняем действие…':dirty?'Есть несохранённые изменения':'Изменения сохранены'}</span><kbd>Ctrl + S</kbd></div>
    <Button onPress={onSave} isDisabled={busy||!dirty||!onSave}><Save size={15}/>Сохранить расположение</Button>
    <small>Сохраняются названия, группы, матрицы и настройки компонентов.</small>
   </div>
  </aside>}
  </div><span className="spatial-announcement" aria-live="polite">{announcement}</span>
 </div>;
 return expanded?<><div className="spatial-placeholder" style={{height:placeholderHeight}}><Maximize2 size={22}/><strong>Редактор пространства открыт</strong><button onClick={closeExpanded}>Вернуться к подсветке</button></div>{createPortal(editor,document.body)}</>:editor;
}

