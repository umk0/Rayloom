// SPDX-License-Identifier: GPL-2.0-or-later
export const deviceKey=d=>`${d.vendor}|${d.name}|${d.serial||d.location}`;
export const identity=d=>({name:d.name,vendor:d.vendor,serial:d.serial,location:d.location});
import {normalizeCalibration} from './color-calibration.mjs';
export function transform(p,pose){
 const s=pose.scale??1;let x=p.x*s,y=p.y*s,z=(p.z??0)*s;
 for(const [axis,degrees] of [['x',pose.rx],['y',pose.ry],['z',pose.rz]]){
  const a=(degrees??0)*Math.PI/180,c=Math.cos(a),n=Math.sin(a);
  if(axis==='x')[y,z]=[y*c-z*n,y*n+z*c];
  if(axis==='y')[x,z]=[x*c+z*n,-x*n+z*c];
  if(axis==='z')[x,y]=[x*c-y*n,x*n+y*c];
 }
 return {...p,x:x+(pose.x??0),y:y+(pose.y??0),z:z+(pose.z??0)};
}
export function generatePoints(kind,count,{columns=8,spacing=10,radius=50,start=0,reverse=false,serpentine=true}={}){
 if(!Number.isInteger(count)||count<1||count>4096)throw Error('LED count must be 1..4096');
 columns=Math.max(1,Math.min(128,Math.round(columns)));
 return Array.from({length:count},(_,i)=>{const n=reverse?count-1-i:i;let x=n*spacing,y=0,z=0;
  if(kind==='ring'){const a=n/count*Math.PI*2-Math.PI/2;x=Math.cos(a)*radius;y=Math.sin(a)*radius;}
  if(kind==='grid'){const row=Math.floor(n/columns);x=(serpentine&&row%2?columns-1-n%columns:n%columns)*spacing;y=row*spacing;}
  return {led:start+i,x,y,z};
 });
}
export function pointsFromZone(zone){
 const m=zone.matrix,points=[];const seen=new Set();
 if(m?.width&&m.map?.length)for(let i=0;i<m.map.length;i++){
  const n=m.map[i];if(n>=0&&n<zone.ledCount&&!seen.has(n)){seen.add(n);points.push({led:(zone.startIndex??0)+n,x:(i%m.width)*19,y:Math.floor(i/m.width)*19,z:0});}
 }
 for(let i=0;i<zone.ledCount;i++)if(!seen.has(i))points.push({led:(zone.startIndex??0)+i,x:m?.width?i*10:i*10,y:m?.height?m.height*19+19:0,z:0});
 return points.sort((a,b)=>a.led-b.led);
}
export function discoverLayout(devices,old={version:1,components:[],groups:[{id:'all',name:'Всё пространство',members:[]}],scenes:[]}){
 const layout=structuredClone(old);let added=0;
 for(const d of devices.filter(d=>d.serial!=='VISUAL_MAP_VISUAL_CONTROLLER_SERIAL'))for(const z of d.zones??[]){
  const id=deviceKey(d)+'/zone/'+z.index;
  if(layout.components.some(c=>c.id===id))continue;
  layout.components.push({id,device:identity(d),deviceKey:deviceKey(d),zone:z.index,name:d.name+(d.zones.length>1?' · '+z.name:''),source:z.matrix?.width?'OpenRGB native matrix':'OpenRGB LED order',points:pointsFromZone(z),pose:{x:(layout.components.length%3)*900,y:Math.floor(layout.components.length/3)*220,z:0,rx:0,ry:0,rz:0,scale:1},enabled:true});added++;
 }
 return {layout,added};
}
export function worldPoints(layout,groupId='all'){
 const group=layout.groups.find(g=>g.id===groupId);const members=groupId==='all'?null:new Set(group?.members??[]);
 return layout.components.filter(c=>c.enabled&&(!members||members.has(c.id))).flatMap(c=>c.points.map(p=>({...transform(p,c.pose),component:c.id,componentName:c.name,deviceKey:c.deviceKey,device:c.device,calibration:normalizeCalibration(c.calibration)})));
}
export function validateLayout(v){
 if(v?.version!==1||!Array.isArray(v.components)||v.components.length>128||!Array.isArray(v.groups)||v.groups.length>64)throw Error('Invalid layout');
 const ids=new Set();let leds=0;
 if(v.deviceAliases!==undefined){if(!v.deviceAliases||typeof v.deviceAliases!=='object'||Array.isArray(v.deviceAliases)||Object.keys(v.deviceAliases).length>128||Object.entries(v.deviceAliases).some(([key,name])=>key.length>1000||typeof name!=='string'||name.length>120))throw Error('Недопустимое имя устройства');}
 for(const c of v.components){
  normalizeCalibration(c.calibration);
  if(typeof c.id!=='string'||ids.has(c.id)||typeof c.name!=='string'||c.name.length>120||!c.device||typeof c.deviceKey!=='string')throw Error('Invalid component identity');ids.add(c.id);
  if(!Number.isInteger(c.zone)||c.zone<0||c.zone>1024||typeof c.enabled!=='boolean')throw Error('Invalid component zone');
  if(!Array.isArray(c.points)||c.points.length>4096)throw Error('Invalid LED matrix');leds+=c.points.length;
  for(const k of ['x','y','z','rx','ry','rz','scale'])if(!Number.isFinite(c.pose?.[k])||Math.abs(c.pose[k])>100000)throw Error('Invalid transform');
  if(c.pose.scale<=0)throw Error('Scale must be positive');
  const indices=new Set();for(const p of c.points){if(!Number.isInteger(p.led)||p.led<0||p.led>65535||indices.has(p.led)||![p.x,p.y,p.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=100000))throw Error('Invalid LED position');indices.add(p.led);}
 }
 if(leds>16384)throw Error('Layout exceeds 16384 LEDs');
 const groups=new Set();for(const g of v.groups){if(typeof g.id!=='string'||typeof g.name!=='string'||g.name.length>120||groups.has(g.id)||!Array.isArray(g.members)||g.members.some(id=>!ids.has(id)))throw Error('Invalid group');groups.add(g.id);}
 if(!groups.has('all'))throw Error('Missing all group');
 return v;
}
export function hsv(h,s=1,v=1){h=((h%1)+1)%1;const i=Math.floor(h*6),f=h*6-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);const [r,g,b]=[[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i%6];return Math.round(r*255)|(Math.round(g*255)<<8)|(Math.round(b*255)<<16);}
export function scaleColor(c,b){return Math.round((c&255)*b)|(Math.round(((c>>8)&255)*b)<<8)|(Math.round(((c>>16)&255)*b)<<16);}
