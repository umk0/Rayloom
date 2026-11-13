// SPDX-License-Identifier: GPL-2.0-or-later
import {generatePoints, identity, pointsFromZone, validateLayout} from './spatial.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const kinds={line:'line',strip:'line',grid:'grid',matrix:'grid',ring:'ring'};
const targetPoints=target=>Array.isArray(target)?target:target?.points;
const validCount=count=>Number.isInteger(count)&&count>=1&&count<=4096;

/** Validated copies only: coordinates are geometry; led is immutable wiring identity. */
export function validateLayoutPoints(points){
  if(!Array.isArray(points)||!validCount(points.length))throw Error('В макете должно быть от 1 до 4096 светодиодов.');
  const seen=new Set();
  return points.map(point=>{
    if(!object(point)||!Number.isInteger(point.led)||point.led<0||point.led>65535||seen.has(point.led))throw Error('Номера LED должны быть уникальными целыми числами от 0 до 65535.');
    seen.add(point.led);
    const result={led:point.led,x:point.x,y:point.y,z:point.z===undefined?0:point.z};
    if(![result.x,result.y,result.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000))throw Error('Координаты LED должны быть числами от −100000 до 100000.');
    return result;
  });
}

export function validateDeviceLayoutPoints(points,target){
  const geometry=validateLayoutPoints(points),bound=validateLayoutPoints(targetPoints(target)),ids=new Set(bound.map(point=>point.led));
  if(geometry.length!==bound.length||geometry.some(point=>!ids.has(point.led)))throw Error('Макет должен сохранять все номера LED выбранного компонента.');
  return geometry;
}

const geometryOptions=options=>{
  if(!object(options))throw Error('Некорректные настройки формы.');
  const result={columns:options.columns??8,spacing:options.spacing??10,radius:options.radius??50,reverse:options.reverse??false,serpentine:options.serpentine??true};
  if(!Number.isInteger(result.columns)||result.columns<1||result.columns>128)throw Error('Укажите от 1 до 128 столбцов.');
  for(const field of ['spacing','radius'])if(!Number.isFinite(result[field])||result[field]<=0||result[field]>100000)throw Error('Шаг и радиус должны быть положительными числами до 100000.');
  if(typeof result.reverse!=='boolean'||typeof result.serpentine!=='boolean')throw Error('Некорректное направление LED.');
  return result;
};

/** Legacy point templates, SDK shapes and source-derived catalog matrices share one path. */
export function templatePoints(template){
  if(!object(template))throw Error('Макет недоступен.');
  if(Array.isArray(template.points)){
    const points=validateLayoutPoints(template.points);
    if(template.count!==undefined&&template.count!==points.length)throw Error('Число LED не соответствует точкам макета.');
    return points;
  }
  if(Array.isArray(template.matrix)){
    const rows=template.matrix,columns=template.columns??rows[0]?.length;
    if(!Number.isInteger(columns)||columns<1||columns>4096||!rows.length||rows.length*columns>16384||rows.some(row=>!Array.isArray(row)||row.length!==columns))throw Error('Матрица содержит неполные строки.');
    if(template.rows!==undefined&&template.rows!==rows.length)throw Error('Число строк матрицы не совпадает.');
    const map=rows.flat(),indices=map.filter(index=>index!==null&&index!==-1);
    if(!indices.length||indices.some(index=>!Number.isInteger(index)||index<0||index>65535))throw Error('Матрица содержит недопустимые номера LED.');
    if(new Set(indices).size!==indices.length)throw Error('Один номер LED указан в матрице несколько раз. Исправьте повторяющиеся индексы.');
    const count=template.requiredLedCount??Math.max(...indices)+1;
    if(!validCount(count)||indices.some(index=>index>=count))throw Error('Число LED не соответствует матрице.');
    // Some source matrices omit indicators outside the keyboard grid. Preserve
    // their hardware indices and use the same fallback row as native discovery.
    return validateLayoutPoints(pointsFromZone({ledCount:count,startIndex:0,matrix:{width:columns,height:rows.length,map:map.map(index=>index===null?-1:index)}}));
  }
  if(!Object.hasOwn(kinds,template.kind)||!validCount(template.count))throw Error('Нужен макет с точками или формой и точным числом LED.');
  return validateLayoutPoints(generatePoints(kinds[template.kind],template.count,geometryOptions(template)));
}

/** Keep array order AND the exact target IDs, including split/non-contiguous ports. */
export function remapTemplatePoints(template,target){
  const source=templatePoints(template).sort((a,b)=>a.led-b.led),points=validateLayoutPoints(targetPoints(target));
  if(source.length!==points.length)throw Error(`Макет содержит ${source.length} LED, а выбранный компонент — ${points.length}.`);
  const described=Array.isArray(template.matrix)?new Set(template.matrix.flat().filter(index=>Number.isInteger(index)&&index>=0)):null;
  const ordered=[...points].sort((a,b)=>a.led-b.led),coordinates=new Map(ordered.map((point,index)=>[point.led,described&&!described.has(source[index].led)?point:source[index]]));
  return points.map(point=>{const source=coordinates.get(point.led);return {led:point.led,x:source.x,y:source.y,z:source.z};});
}

export function generateLayoutPoints(kind,target,options={}){
  const points=validateLayoutPoints(targetPoints(target));
  if(!Object.hasOwn(kinds,kind))throw Error('Выберите линию, кольцо или матрицу.');
  return remapTemplatePoints({kind:kinds[kind],count:points.length,...geometryOptions(options)},points);
}

/** Count compatibility permits user selection; it never claims a verified device match. */
export function compatibleTemplates(templates,target){
  const points=validateLayoutPoints(targetPoints(target));
  return (Array.isArray(templates)?templates:[]).filter(template=>{try{return templatePoints(template).length===points.length;}catch{return false;}});
}

export function nativeLayoutTemplate(zone,target){
  try{
    const points=validateLayoutPoints(targetPoints(target));
    if(!object(zone)||!validCount(zone.ledCount)||!Number.isInteger(zone.startIndex??0)||(zone.startIndex??0)<0)return null;
    if(!Array.isArray(target)&&target.zone!==undefined&&zone.index!==target.zone)return null;
    if(zone.matrix?.map){
      if(!Array.isArray(zone.matrix.map))return null;
      const indices=zone.matrix.map.filter(index=>index!==null&&index>=0&&index<zone.ledCount);
      if(new Set(indices).size!==indices.length)return null;
    }
    const native=validateLayoutPoints(pointsFromZone(zone)),byId=new Map(native.map(point=>[point.led,point]));
    if(points.some(point=>!byId.has(point.led)))return null;
    return {schemaVersion:1,name:zone.matrix?.width?'Матрица устройства':'Порядок LED устройства',count:points.length,points:points.map(point=>({...byId.get(point.led)})),source:'native',...(Number.isInteger(zone.index)?{zone:zone.index}:{})};
  }catch{return null;}
}

function templateName(value){
  if(typeof value!=='string'||!value.trim()||value.trim().length>120||/[\x00-\x1f]/.test(value))throw Error('Назовите макет: от 1 до 120 символов.');
  return value.trim();
}
const metadata=(input={})=>{
  const result={};
  if(input.device!==undefined){
    if(!object(input.device))throw Error('Некорректная модель устройства.');
    const device={};for(const key of ['name','vendor','serial','location'])if(input.device[key]!==undefined){if(typeof input.device[key]!=='string'||input.device[key].length>1000)throw Error('Некорректные данные устройства.');device[key]=input.device[key];}
    result.device=device;
  }
  if(input.deviceKey!==undefined){if(typeof input.deviceKey!=='string'||input.deviceKey.length>3000)throw Error('Некорректная привязка устройства.');result.deviceKey=input.deviceKey;}
  if(input.zone!==undefined){if(!Number.isInteger(input.zone)||input.zone<0||input.zone>1024)throw Error('Некорректный порт устройства.');result.zone=input.zone;}
  return result;
};

export function makeUserTemplate({name,points,component,...details}){
  const input=points===undefined?component?.points:points;
  const geometry=component?validateDeviceLayoutPoints(input,component):validateLayoutPoints(input);
  if(component){
    details={device:identity(component.device??{}),deviceKey:component.deviceKey,zone:component.zone};
  }
  return {schemaVersion:1,name:templateName(name),count:geometry.length,points:geometry,source:'user',...metadata(details)};
}

export function validateUserTemplate(template){
  if(!object(template)||(template.schemaVersion!==undefined&&template.schemaVersion!==1))throw Error('Неподдерживаемая версия макета.');
  const result=makeUserTemplate(template);
  if(template.count!==undefined&&template.count!==result.count)throw Error('Число LED не соответствует точкам макета.');
  return result;
}

export function upsertUserTemplate(templates,template,{replace=false}={}){
  if(!Array.isArray(templates)||typeof replace!=='boolean')throw Error('Некорректный список макетов.');
  const item=validateUserTemplate(template),existing=templates.some(entry=>entry?.name===item.name);
  if(existing&&!replace)throw Error('Макет с таким названием уже есть. Подтвердите замену или выберите другое название.');
  return [...templates.filter(entry=>entry?.name!==item.name),item];
}

/** Library-only mutation: never saves an active layout or sends frames to hardware. */
export async function saveDeviceTemplate(studio,args={}){
  if(!object(args)||typeof args.component!=='string')throw Error('Выберите компонент для макета.');
  if(args.replace!==undefined&&typeof args.replace!=='boolean')throw Error('Подтвердите замену макета.');
  const layout=validateLayout(args.layout===undefined?studio.getLayout():args.layout),component=layout.components.find(item=>item.id===args.component);
  if(!component)throw Error('Выбранный компонент больше не найден.');
  const template=makeUserTemplate({name:args.name,component,points:args.points===undefined?component.points:args.points});
  // Preserve the old two-field signature; new draft/point callers must opt in.
  const legacy=args.layout===undefined&&args.points===undefined;
  const list=upsertUserTemplate(studio.read('templates',[]),template,{replace:args.replace??legacy});
  studio.write('templates',list);
  return studio.sync();
}
