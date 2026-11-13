import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {Accordion,Alert,Badge,Button,Group,Paper,SegmentedControl,Select,SimpleGrid,Stack,Switch,Text} from '@mantine/core';
import {Focus,Lightbulb,RotateCcw,Undo2,ZoomIn,ZoomOut} from 'lucide-react';
import type {Point} from '../studio-types';
import {NumericInput} from './StudioControls';
import {generateLayoutPoints} from '../../shared/device-layouts.mjs';
import './device-layout-editor.css';

type Props={points:Point[];onChange:(points:Point[])=>void;onIdentify?:(led:number)=>Promise<void>;disabled?:boolean};
type View={x:number;y:number;w:number;h:number};
type Drag={led:number;pointer:number;start:Point[];dx:number;dy:number;changed:boolean};
const copy=(points:Point[])=>points.map(point=>({...point}));
const same=(a:Point[],b:Point[])=>a.length===b.length&&a.every((point,index)=>{const other=b[index];return other&&point.led===other.led&&point.x===other.x&&point.y===other.y&&point.z===other.z;});
const coordinate=(value:number)=>Math.round(Math.max(-100000,Math.min(100000,value))*10)/10;
const errorText=(value:unknown)=>value&&typeof value==='object'&&'message' in value?String(value.message):String(value);
const fit=(points:Point[]):View=>{
  points=points.filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));
  if(!points.length)return {x:-50,y:-30,w:100,h:60};
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const point of points){x0=Math.min(x0,point.x);y0=Math.min(y0,point.y);x1=Math.max(x1,point.x);y1=Math.max(y1,point.y);}
  const padding=Math.max(10,Math.max(x1-x0,y1-y0)*.12);
  return {x:x0-padding,y:y0-padding,w:Math.max(20,x1-x0+padding*2),h:Math.max(20,y1-y0+padding*2)};
};
const valid=(points:Point[])=>points.length>0&&points.length<=4096&&new Set(points.map(point=>point.led)).size===points.length&&points.every(point=>Number.isInteger(point.led)&&point.led>=0&&point.led<=65535&&[point.x,point.y,point.z].every(value=>Number.isFinite(value)&&Math.abs(value)<=100000));

/** Controlled local draft. Persistence, port ownership and lighting stay with the caller. */
export function DeviceLayoutEditor({points,onChange,onIdentify,disabled=false}:Props){
  const [kind,setKind]=useState('ring'),[radius,setRadius]=useState(50),[spacing,setSpacing]=useState(10),[columns,setColumns]=useState(()=>Math.max(1,Math.min(8,points.length))),[reverse,setReverse]=useState(false),[serpentine,setSerpentine]=useState(true);
  const [selected,setSelected]=useState<number|null>(points[0]?.led??null),[view,setView]=useState<View>(()=>fit(points)),[undo,setUndo]=useState<Point[]|null>(null),[error,setError]=useState(''),[identifying,setIdentifying]=useState(false);
  const svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null),pointsRef=useRef(points),lastProp=useRef(points),emitted=useRef<Point[]|null>(null),undoRef=useRef<Point[]|null>(null),mounted=useRef(true),working=useRef(false),identifyRevision=useRef(0);
  if(lastProp.current!==points){lastProp.current=points;pointsRef.current=points;}
  const inputValid=valid(points),blocked=disabled||identifying||!inputValid;
  const blockedRef=useRef(blocked);blockedRef.current=blocked;
  const active=inputValid?points.find(point=>point.led===selected):undefined;
  const remember=(before:Point[]|null)=>{undoRef.current=before?copy(before):null;setUndo(undoRef.current);};
  const stopDrag=()=>{const current=drag.current;drag.current=null;if(current&&svg.current?.hasPointerCapture?.(current.pointer))svg.current.releasePointerCapture(current.pointer);};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;identifyRevision.current++;drag.current=null;};},[]);
  useEffect(()=>{
    if(!points.some(point=>point.led===selected))setSelected(points[0]?.led??null);
    if(emitted.current&&same(points,emitted.current))return;
    // A different preset/port replaces the controlled draft, so old undo and
    // pointer gestures must never write its coordinates back over that choice.
    emitted.current=null;stopDrag();remember(null);setView(fit(points));setError('');identifyRevision.current++;
  },[points]);
  useEffect(()=>{if(disabled)stopDrag();},[disabled]);
  const emit=(next:Point[],history=true,fitView=false)=>{
    if(blockedRef.current||working.current)return false;
    const before=pointsRef.current,ids=new Set(before.map(point=>point.led));
    if(!valid(next)||next.length!==before.length||next.some(point=>!ids.has(point.led))){setError('Состав светодиодов изменять нельзя. Отредактируйте положение существующих точек.');return false;}
    if(same(before,next))return false;
    try{onChange(copy(next));if(history)remember(before);pointsRef.current=next;emitted.current=next;setError('');if(fitView)setView(fit(next));return true;}
    catch(reason){setError(errorText(reason));return false;}
  };
  const applyShape=()=>{if(blockedRef.current)return;try{const next=generateLayoutPoints(kind,pointsRef.current,{radius,spacing,columns,reverse,serpentine});emit(next,true,true);}catch(reason){setError(errorText(reason));}};
  const move=(axis:'x'|'y'|'z',value:number)=>{if(!Number.isFinite(value)||selected===null)return;const next=pointsRef.current.map(point=>point.led===selected?{...point,[axis]:coordinate(value)}:point);emit(next,true,axis!=='z'&&next.some(point=>point.x<view.x||point.x>view.x+view.w||point.y<view.y||point.y>view.y+view.h));};
  const restore=()=>{const previous=undoRef.current;if(!previous||blockedRef.current)return;if(emit(copy(previous),false,true))remember(null);};
  const position=(event:ReactPointerEvent)=>{
    const box=svg.current?.getBoundingClientRect();if(!box||!box.width||!box.height)return null;
    const scale=Math.min(box.width/view.w,box.height/view.h),left=(box.width-view.w*scale)/2,top=(box.height-view.h*scale)/2;
    return {x:view.x+(event.clientX-box.left-left)/scale,y:view.y+(event.clientY-box.top-top)/scale};
  };
  const pointerDown=(event:ReactPointerEvent<SVGCircleElement>,point:Point)=>{
    if(event.button!==0||blockedRef.current)return;const pos=position(event);if(!pos)return;
    event.preventDefault();event.stopPropagation();setSelected(point.led);event.currentTarget.focus();
    drag.current={led:point.led,pointer:event.pointerId,start:copy(pointsRef.current),dx:pos.x-point.x,dy:pos.y-point.y,changed:false};svg.current?.setPointerCapture(event.pointerId);
  };
  const pointerMove=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const current=drag.current;if(!current||current.pointer!==event.pointerId||blockedRef.current)return;const pos=position(event);if(!pos)return;
    const next=pointsRef.current.map(point=>point.led===current.led?{...point,x:coordinate(pos.x-current.dx),y:coordinate(pos.y-current.dy)}:point);
    if(emit(next,false)&&!current.changed){remember(current.start);current.changed=true;}
  };
  const finishDrag=()=>{if(drag.current?.changed&&pointsRef.current.some(point=>point.x<view.x||point.x>view.x+view.w||point.y<view.y||point.y>view.y+view.h))setView(fit(pointsRef.current));stopDrag();};
  const zoom=(factor:number)=>setView(current=>{const w=Math.max(2,Math.min(400000,current.w*factor)),h=Math.max(2,Math.min(400000,current.h*factor));return {x:current.x+(current.w-w)/2,y:current.y+(current.h-h)/2,w,h};});
  const identify=async()=>{
    if(!onIdentify||selected===null||working.current||blockedRef.current)return;
    const token=++identifyRevision.current;working.current=true;setIdentifying(true);setError('');stopDrag();
    try{await onIdentify(selected);}catch(reason){if(mounted.current&&token===identifyRevision.current)setError(errorText(reason));}
    finally{working.current=false;if(mounted.current)setIdentifying(false);}
  };
  const dot=Math.max(1.2,Math.max(view.w,view.h)/100);
  return <Stack className="rayloom-device-layout-editor" gap="md">
    <Group justify="space-between"><Text size="sm" c="dimmed">Выберите форму или передвиньте отдельные светодиоды.</Text><Badge variant="light" color="gray">{points.length} LED</Badge></Group>
    {!inputValid&&<Alert color="yellow">{points.length?'Не удалось прочитать расположение светодиодов. Выберите другой макет.':'У этого порта пока нет светодиодов для редактирования.'}</Alert>}
    {error&&<Alert color="red" role="alert">{error}</Alert>}
    <Paper withBorder radius="md" p="md"><Stack gap="md"><SegmentedControl aria-label="Стартовая форма LED" value={kind} onChange={value=>{if(!blockedRef.current)setKind(value);}} disabled={blocked} fullWidth data={[{value:'ring',label:'Кольцо'},{value:'grid',label:'Матрица'},{value:'line',label:'Лента'}]}/><fieldset disabled={blocked} className="rayloom-layout-fieldset"><SimpleGrid cols={{base:1,sm:2}}>{kind==='ring'?<NumericInput label="Радиус, мм" value={radius} onChange={setRadius} min={.1} max={1000} step={.1}/>:<NumericInput label="Шаг между LED, мм" value={spacing} onChange={setSpacing} min={.1} max={1000} step={.1}/>} {kind==='grid'&&<NumericInput label="Столбцов" value={columns} onChange={value=>setColumns(Math.max(1,Math.min(128,points.length,Math.round(value))))} min={1} max={Math.max(1,Math.min(128,points.length))}/>}</SimpleGrid><Group mt="md" gap="lg"><Switch label="Обратный порядок" checked={reverse} disabled={blocked} onChange={event=>setReverse(event.currentTarget.checked)}/>{kind==='grid'&&<Switch label="Соединение змейкой" checked={serpentine} disabled={blocked} onChange={event=>setSerpentine(event.currentTarget.checked)}/>}</Group></fieldset><Group justify="space-between"><Text size="xs" c="dimmed">Новая форма заменит ручное расположение. Изменение можно отменить.</Text><Button variant="light" disabled={blocked} onClick={applyShape}>Применить форму</Button></Group></Stack></Paper>
    <Paper withBorder radius="md" className="rayloom-layout-preview"><Group justify="space-between" p="sm" gap="xs"><Text fw={600} size="sm">Расположение светодиодов</Text><Group gap={4}><Button variant="subtle" size="compact-xs" leftSection={<Focus size={14}/>} onClick={()=>setView(fit(pointsRef.current))}>Показать все</Button><Button aria-label="Увеличить макет" variant="subtle" size="compact-xs" onClick={()=>zoom(.75)}><ZoomIn size={15}/></Button><Button aria-label="Уменьшить макет" variant="subtle" size="compact-xs" onClick={()=>zoom(4/3)}><ZoomOut size={15}/></Button><Button aria-label="Сбросить вид макета" variant="subtle" size="compact-xs" onClick={()=>setView(fit(pointsRef.current))}><RotateCcw size={15}/></Button></Group></Group>
      <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet" className="rayloom-layout-svg" aria-label="Редактор расположения LED" onPointerMove={pointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={()=>{drag.current=null;}}>
        <path d={`M ${view.x} 0 H ${view.x+view.w} M 0 ${view.y} V ${view.y+view.h}`} className="rayloom-layout-axes" vectorEffect="non-scaling-stroke"/>
        {inputValid&&points.map(point=><circle key={point.led} cx={point.x} cy={point.y} r={dot} role="button" tabIndex={blocked?-1:0} aria-label={`LED ${point.led}`} aria-pressed={selected===point.led} aria-disabled={blocked} data-selected={selected===point.led||undefined} className="rayloom-layout-led" onFocus={()=>{if(!blockedRef.current)setSelected(point.led);}} onClick={()=>{if(!blockedRef.current)setSelected(point.led);}} onPointerDown={event=>pointerDown(event,point)} onKeyDown={event=>{if(blockedRef.current)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelected(point.led);}const directions:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},delta=directions[event.key];if(delta){event.preventDefault();setSelected(point.led);const step=event.shiftKey?10:1;emit(pointsRef.current.map(current=>current.led===point.led?{...current,x:coordinate(current.x+delta[0]*step),y:coordinate(current.y+delta[1]*step)}:current));}}}><title>LED {point.led}</title></circle>)}
      </svg><Text size="xs" c="dimmed" p="sm">Перетащите LED мышью. С клавиатуры: Tab — выбрать, стрелки — сдвинуть, Shift — шаг 10 мм.</Text>
    </Paper>
    <Group justify="space-between"><Select label="Выбранный светодиод" aria-label="Выбранный светодиод" value={selected===null?null:String(selected)} onChange={value=>{if(value!==null&&!blockedRef.current)setSelected(Number(value));}} disabled={blocked} searchable={points.length>12} data={inputValid?points.map(point=>({value:String(point.led),label:`LED ${point.led}`})):[]}/><Group gap="xs"><Button variant="default" leftSection={<Undo2 size={15}/>} disabled={blocked||!undo} onClick={restore}>Отменить изменение</Button>{onIdentify&&<Button variant="light" leftSection={<Lightbulb size={15}/>} loading={identifying} disabled={blocked||!active} onClick={()=>void identify()}>Подсветить выбранный</Button>}</Group></Group>
    {active&&<fieldset disabled={blocked} className="rayloom-layout-fieldset"><SimpleGrid cols={2}><NumericInput label="X, мм" value={active.x} onChange={value=>move('x',value)} min={-100000} max={100000} step={.1}/><NumericInput label="Y, мм" value={active.y} onChange={value=>move('y',value)} min={-100000} max={100000} step={.1}/></SimpleGrid><Accordion variant="separated" mt="md"><Accordion.Item value="depth"><Accordion.Control>Глубина</Accordion.Control><Accordion.Panel><NumericInput label="Z, мм" hint="Для светодиодов, расположенных на разной глубине" value={active.z} onChange={value=>move('z',value)} min={-100000} max={100000} step={.1}/></Accordion.Panel></Accordion.Item></Accordion></fieldset>}
  </Stack>;
}
