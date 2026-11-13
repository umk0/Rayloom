import {useId,useMemo} from 'react';
import type {Component,Point} from '../studio-types';
import {type Device,hex} from '../types';
import {deviceKey} from '../../shared/spatial.mjs';
import {isComponentAvailable} from '../../shared/device-visibility.mjs';
import './device-layout-preview.css';

type ProjectedPoint={led:number;x:number;y:number};
type Plane='XY'|'XZ'|'YZ'|'3D'|'coincident'|'empty';
type Projection={plane:Plane;points:ProjectedPoint[];viewBox:string;radius:number;caption:string};
type Props={component:Component;device?:Device;available:boolean;className?:string};
const locationKey=(point:ProjectedPoint)=>`${point.x.toFixed(6)},${point.y.toFixed(6)}`;
const extent=(points:ProjectedPoint[])=>{
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const point of points){x0=Math.min(x0,point.x);y0=Math.min(y0,point.y);x1=Math.max(x1,point.x);y1=Math.max(y1,point.y);}
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
};

/** Projection changes display coordinates only; global LED identities are untouched. */
export function projectDeviceLayout(input:Point[]):Projection{
  const points=input.filter(point=>Number.isInteger(point.led)&&point.led>=0&&point.led<=65535&&[point.x,point.y,point.z].every(value=>Number.isFinite(value)&&Math.abs(value)<=100000));
  if(!points.length)return {plane:'empty',points:[],viewBox:'-1 -1 2 2',radius:.15,caption:'Макет LED пока не задан'};
  const candidates:Array<{plane:Plane;points:ProjectedPoint[]}>=([
    ['XY','x','y'],['XZ','x','z'],['YZ','y','z'],
  ] as const).map(([plane,x,y])=>({plane,points:points.map(point=>({led:point.led,x:point[x],y:point[y]}))}));
  const allDistinct=new Set(points.map(point=>`${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`)).size;
  const varies=(axis:'x'|'y'|'z')=>points.some(point=>Math.abs(point[axis]-points[0][axis])>1e-6);
  // A volume (e.g. LEDs on several cube faces) can overlap in every orthogonal
  // plane. An oblique projection makes depth visible without moving any LEDs.
  if(varies('x')&&varies('y')&&varies('z')&&candidates.every(candidate=>new Set(candidate.points.map(locationKey)).size<allDistinct))candidates.push({plane:'3D',points:points.map(point=>({led:point.led,x:point.x-point.z*.5,y:point.y+point.z*.35}))});
  let chosen=candidates[0],bestUnique=0,bestArea=-1,bestSpan=-1;
  for(const candidate of candidates){const bounds=extent(candidate.points),unique=new Set(candidate.points.map(locationKey)).size,area=bounds.w*bounds.h,span=Math.max(bounds.w,bounds.h);if(unique>bestUnique||(unique===bestUnique&&(area>bestArea||(area===bestArea&&span>bestSpan)))){chosen=candidate;bestUnique=unique;bestArea=area;bestSpan=span;}}
  if(allDistinct===1&&points.length>1)chosen={plane:'coincident',points:points.map((point,index)=>({led:point.led,x:index,y:0}))};
  const bounds=extent(chosen.points),span=Math.max(bounds.w,bounds.h);
  let closestStep=Infinity;
  for(let i=1;i<chosen.points.length;i++){const a=chosen.points[i-1],b=chosen.points[i],distance=Math.hypot(a.x-b.x,a.y-b.y);if(distance>1e-6)closestStep=Math.min(closestStep,distance);}
  const radius=span>0?Math.max(span*.00005,Math.min(span*.045,Number.isFinite(closestStep)?closestStep*.32:span*.045)):.15;
  const padding=Math.max(radius*2.4,span*.07),width=Math.max(bounds.w+padding*2,radius*6),height=Math.max(bounds.h+padding*2,radius*6);
  const x=bounds.x+bounds.w/2-width/2,y=bounds.y+bounds.h/2-height/2;
  const caption=chosen.plane==='coincident'?'LED находятся в одной точке — задайте макет':chosen.plane==='3D'?'Проекция объёма':chosen.plane==='XY'?'':`Плоскость ${chosen.plane}`;
  return {plane:chosen.plane,points:chosen.points,viewBox:`${x} ${y} ${width} ${height}`,radius,caption};
}

export function DeviceLayoutPreview({component,device,available,className=''}:Props){
  const title=useId(),geometry=useMemo(()=>projectDeviceLayout(component.points),[component.points]);
  const live=!!(available&&component.enabled&&device&&deviceKey(device)===component.deviceKey&&isComponentAvailable(component,device));
  const state=!component.enabled?'disabled':live?'live':'unavailable';
  const stateLabel=!component.enabled?'Не участвует в подсветке':live?'Подключено':'Нет актуальных данных устройства';
  return <figure className={`rayloom-device-layout-preview ${className}`.trim()} data-state={state} data-plane={geometry.plane}>
    <svg role="img" aria-labelledby={title} viewBox={geometry.viewBox} preserveAspectRatio="xMidYMid meet" className="rayloom-device-layout-preview-svg">
      <title id={title}>{component.name}: {component.points.length} LED. {stateLabel}. {geometry.caption}</title>
      {geometry.points.map(point=>{
        const raw=live&&Array.isArray(device?.colors)?device.colors[point.led]:undefined;
        const color=typeof raw==='number'&&Number.isInteger(raw)&&raw>=0&&raw<=0xffffff?hex(raw):undefined;
        return <circle key={point.led} data-led={point.led} data-color-state={color?'known':'unknown'} cx={point.x} cy={point.y} r={geometry.radius} fill={color??'none'} className="rayloom-device-layout-preview-led"><title>LED {point.led}{color?` · ${color}`:' · цвет сейчас неизвестен'}</title></circle>;
      })}
    </svg>
    {geometry.caption&&<figcaption>{geometry.caption}</figcaption>}
  </figure>;
}
