// SPDX-License-Identifier: GPL-2.0-or-later
import {deviceKey} from './spatial.mjs';

const validZone=value=>Number.isInteger(value)&&value>=0&&value<=1024;
const nativeCount=value=>Number.isSafeInteger(value)&&value>=0;
const zoneKind=zone=>{
  const matrix=zone?.matrix;
  if(matrix&&Number.isInteger(matrix.width)&&matrix.width>0&&Number.isInteger(matrix.height)&&matrix.height>0&&Array.isArray(matrix.map)&&matrix.map.length)return 'matrix';
  // These are native zone geometry types, never a physical connector/fan model.
  if(zone?.type===0)return 'single';
  if(zone?.type===1||zone?.type===3)return 'linear';
  if(zone?.type===2||zone?.type===4||zone?.type===5)return 'matrix';
  return 'unknown';
};

/**
 * Group one controller's live and remembered lighting zones without creating
 * components or changing LED identities. Split components share their zone.
 * ledCount=null means neither native nor saved point data establishes a count.
 * @returns {{zone:number,label:string,components:any[],ledCount:number|null,configured:boolean,kind:'single'|'linear'|'matrix'|'unknown'}[]}
 */
export function groupDevicePorts(device,components){
  if(!device||typeof device!=='object')return [];
  const groups=new Map(),key=deviceKey(device),nativeZones=Array.isArray(device.zones)?device.zones:[];
  const ensure=zone=>{
    if(!groups.has(zone))groups.set(zone,{zone,label:`Зона ${zone+1}`,components:[],ledCount:null,configured:false,kind:'unknown'});
    return groups.get(zone);
  };
  for(const native of nativeZones){
    if(!native||!validZone(native.index))continue;
    const group=ensure(native.index);
    if(typeof native.name==='string'&&native.name.trim())group.label=native.name.trim();
    if(nativeCount(native.ledCount))group.ledCount=native.ledCount;
    group.kind=zoneKind(native);
  }
  // A non-empty zone list may use sparse indices. zoneCount is a count, not
  // permission to invent every intervening index in that authoritative list.
  if(!nativeZones.length&&Number.isInteger(device.zoneCount)&&device.zoneCount>=0&&device.zoneCount<=1025){
    for(let zone=0;zone<device.zoneCount;zone++)ensure(zone);
  }
  for(const component of Array.isArray(components)?components:[]){
    if(!component||component.deviceKey!==key||!validZone(component.zone))continue;
    const group=ensure(component.zone);group.components.push(component);group.configured=true;
  }
  for(const group of groups.values()){
    if(group.ledCount!==null)continue;
    const data=group.components.filter(component=>Array.isArray(component.points));
    if(!data.length)continue;
    const ids=new Set();
    for(const component of data)for(const point of component.points)if(Number.isInteger(point?.led)&&point.led>=0&&point.led<=65535)ids.add(point.led);
    group.ledCount=ids.size;
  }
  return [...groups.values()].sort((a,b)=>a.zone-b.zone);
}
