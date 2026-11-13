import {useEffect,useRef,useState} from 'react';
import {sampleBuiltin} from '../shared/builtin-effects.mjs';
import {sampleEffect} from '../sdk/runtime.mjs';
import {EffectPreviewQueue} from '../shared/effect-preview-queue.mjs';
import {normalizeEffectParameterValues} from '../shared/effect-parameters.mjs';

export type PreviewSpec={id:string;source:'rayloom'|'lumen'|'openrgb'|'community';nativeId?:string;definition?:any;inputKind?:string};
type PreviewInput={kind:string;status:'idle'|'listening'|'silent'|'unavailable';deviceName?:string;peak?:number};
type Frame={status:'ready'|'needs-input';width:number;height:number;colors:number[];reason?:string;frame?:number;input?:PreviewInput};
export const nativePreviewQueue=new EffectPreviewQueue((method:string,args?:any)=>window.rayloom.effectPreview(method,args));
const inputReasons:Record<string,string>={audio:'Нужен аудиосигнал','audio-hover':'Аудио · наведите для просмотра','audio-device':'Аудиоустройство недоступно',screen:'Нужен источник захвата экрана',image:'Выберите GIF-изображение',shader:'Выберите шейдер',layers:'Добавьте эффекты в слои',sequence:'Задайте последовательность',palette:'Задайте палитру'};

export function EffectPreview({effect,active,config,reducedMotion,onInactive}:{effect:PreviewSpec;active:boolean;config:any;reducedMotion:boolean;onInactive?:()=>void}){
 const {color,speed,scale=350,fps=60}=config,parametersKey=JSON.stringify(config.effectParameters?.[effect.id]??{});
 const definitionKey=JSON.stringify(effect.definition??null);
 const inactive=useRef(onInactive);inactive.current=onInactive;
 const canvas=useRef<HTMLCanvasElement>(null),[visible,setVisible]=useState(false),[state,setState]=useState<'loading'|'ready'|'needs-input'|'error'>('loading'),[reason,setReason]=useState('');
 const raster=useRef<{canvas:HTMLCanvasElement;context:CanvasRenderingContext2D;pixels:ImageData}|null>(null);
 const [input,setInput]=useState<PreviewInput|null>(null);
 useEffect(()=>{
  const node=canvas.current;if(!node)return;
  const observer=new IntersectionObserver(entries=>{const shown=entries[0]?.isIntersecting??false;setVisible(shown);if(!shown)inactive.current?.();},{rootMargin:'40px'});observer.observe(node);return()=>{observer.disconnect();inactive.current?.();};
 },[]);
 useEffect(()=>{
  const ctx=canvas.current?.getContext('2d');if(!ctx||!visible)return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,raf=0,last=0;const start=performance.now();
  const drawPacked=(colors:number[],width:number,height:number)=>{
   if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||colors.length!==width*height)throw Error('Invalid preview frame');
   if(!raster.current){const buffer=document.createElement('canvas'),context=buffer.getContext('2d');if(!context)throw Error('Preview canvas unavailable');raster.current={canvas:buffer,context,pixels:context.createImageData(width,height)};}
   const buffer=raster.current;
   if(buffer.canvas.width!==width||buffer.canvas.height!==height){buffer.canvas.width=width;buffer.canvas.height=height;buffer.pixels=buffer.context.createImageData(width,height);}
   for(let index=0;index<colors.length;index++){const color=colors[index],offset=index*4;buffer.pixels.data[offset]=color&255;buffer.pixels.data[offset+1]=(color>>8)&255;buffer.pixels.data[offset+2]=(color>>16)&255;buffer.pixels.data[offset+3]=255;}
   buffer.context.putImageData(buffer.pixels,0,0);
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
   ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.drawImage(buffer.canvas,0,0,ctx.canvas.width,ctx.canvas.height);
  };
  if(effect.source==='openrgb'){
   setState(previous=>previous==='ready'?'ready':'loading');
   const animate=active&&!reducedMotion;
   const request=async()=>{
    try{
     const frame=await nativePreviewQueue.frame({effectId:effect.nativeId,color,speed,fps,effectParameters:{[effect.id]:JSON.parse(parametersKey)},animate},controller.signal) as Frame;
     if(controller.signal.aborted)return;
     setState(frame.status);setReason(frame.reason??'');setInput(frame.input??null);
     if(frame.status==='ready'){drawPacked(frame.colors,frame.width,frame.height);if(animate)timer=setTimeout(()=>void request(),50);}
    }catch(error){if(controller.signal.aborted)return;setState('error');setReason('Предпросмотр недоступен. Наведите снова, чтобы повторить.');}
   };void request();
  }else{
   setState('ready');
   let parameters:Record<string,unknown>={};
   try{if(effect.source==='community')parameters=normalizeEffectParameterValues(effect.definition.parameters??[],JSON.parse(parametersKey));}
   catch{setState('error');setReason('Проверьте настройки этого эффекта');return;}
   const draw=(now:number)=>{
    try{
    if(now-last>=1000/24||!last){
     last=now;const t=active&&!reducedMotion?(now-start)/1000+2:2,colors:number[]=[];
     // Native and SDK samples retain their original grids. Built-ins can sample
     // more points directly; resizing only interpolates these actual colors.
     const width=effect.source==='community'?36:72,height=effect.source==='community'?18:36;
     for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const point={x:(x/width-.5)*620,y:(y/height-.5)*310,z:0},index=y*width+x;
      colors.push(effect.source==='community'?sampleEffect(effect.definition,{...point,t,index,health:1,ammo:1,speed,scale,brightness:1,parameters}):sampleBuiltin(effect.id,point,{color,speed,scale},t,index));
     }drawPacked(colors,width,height);
    }
    if(active&&!reducedMotion)raf=requestAnimationFrame(draw);
    }catch{setState('error');setReason('Ошибка в формуле эффекта');}
   };draw(performance.now());
  }
  return()=>{controller.abort();clearTimeout(timer);cancelAnimationFrame(raf);};
 },[effect.id,effect.source,effect.nativeId,definitionKey,parametersKey,visible,active,color,speed,scale,fps,reducedMotion]);
 const audio=effect.inputKind==='audio'||input?.kind==='audio';
 const status=audio&&reducedMotion?'Аудио · анимация отключена':state==='error'?(effect.source==='community'?reason:'Не загрузилось · наведите снова'):state==='needs-input'?(inputReasons[reason]??reason)||'Нужен источник данных':audio?(reducedMotion?'Аудио · анимация отключена':!active?'Аудио · наведите для просмотра':input?.status==='listening'?'Системный звук · играет':input?.status==='silent'?'Системный звук · тишина':input?.status==='unavailable'?'Аудиоустройство недоступно':'Подключаем системный звук…'):state==='loading'?'Загружаем предпросмотр…':reducedMotion?'Неподвижный предпросмотр':active?'Предпросмотр · воспроизведение':'Наведите для анимации';
 return <><canvas ref={canvas} width={288} height={144} className="effect-card-preview" aria-hidden="true" data-preview-status={state} data-preview-source={effect.source} data-audio-status={input?.status}/><span className={'effect-preview-status is-'+state+(active?' is-active':'')} title={status+(input?.deviceName?' · '+input.deviceName:'')}><i/>{status}</span></>;
}
