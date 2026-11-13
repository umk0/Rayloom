import {deviceKey} from './spatial.mjs';

export function isComponentAvailable(component,device){
 if(!device||!Number.isInteger(component.zone)||component.zone<0)return false;
 const zones=Array.isArray(device.zones)?device.zones:[],zone=zones.find(value=>value.index===component.zone);
 // Native indices are authoritative and can be sparse. Legacy snapshots only
 // expose a zone count; keep that fallback when zone details are absent.
 if(zones.length?!zone:!Number.isInteger(device.zoneCount)||component.zone>=device.zoneCount)return false;
 if(!component.points.every(point=>point.led>=0&&point.led<device.ledCount))return false;
 // Resizing an earlier zone shifts every later zone's global LED addresses.
 // A remembered component must not become available over its neighbour's LEDs.
 if(zone?.startIndex!==undefined&&zone.ledCount!==undefined){
  if(!Number.isSafeInteger(zone.startIndex)||zone.startIndex<0||!Number.isSafeInteger(zone.ledCount)||zone.ledCount<0)return false;
  const end=zone.startIndex+zone.ledCount;
  return component.points.every(point=>point.led>=zone.startIndex&&point.led<end);
 }
 return true;
}
export function visibleComponents(layout,devices){
 const connected=new Map(devices.map(device=>[deviceKey(device),device]));
 return layout.components.filter(component=>component.enabled&&isComponentAvailable(component,connected.get(component.deviceKey)));
}
