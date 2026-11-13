import {scaleColor} from '../shared/spatial.mjs';
import {sampleBuiltin} from '../shared/builtin-effects.mjs';
import {sampleEffect} from '../sdk/runtime.mjs';
import {calibrateColor} from '../shared/color-calibration.mjs';
import {normalizeEffectParameterValues} from '../shared/effect-parameters.mjs';

export function renderSpatialFrame(points,config,events,t,effect){
 const colors=new Uint32Array(points.length);
 const parameters=effect?normalizeEffectParameterValues(effect.parameters??[],config.effectParameters?.[config.effect]??{}):undefined;
 for(let i=0;i<points.length;i++){
  const p=points[i];let color;
  if(effect)color=sampleEffect(effect,{...p,t,index:i,...events,speed:config.speed,scale:config.scale,brightness:config.brightness/100,parameters});
  else color=sampleBuiltin(config.effect,p,config,t,i);
  if(config.gameReactive&&events.health<.3)color=scaleColor(0x0000ff,.5+.5*Math.sin(t*9));
  colors[i]=calibrateColor(scaleColor(color,config.brightness/100),p.calibration);
 }
 return colors;
}

export function projectSampleIndices(points,width,height,projection='xy'){
 const uv=p=>projection==='xz'?[p.x,p.z]:projection==='yz'?[p.y,p.z]:[p.x,p.y];
 const coords=points.map(uv),xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]);
 const x0=Math.min(...xs),y0=Math.min(...ys),span=Math.max(1,Math.max(...xs)-x0,Math.max(...ys)-y0);
 return coords.map(([x,y])=>Math.min(height-1,Math.max(0,Math.round((y-y0)/span*(height-1))))*width+Math.min(width-1,Math.max(0,Math.round((x-x0)/span*(width-1)))));
}

export function sampleCanvasFrame(points,config,frame,indices){
 const colors=new Uint32Array(points.length);
 for(let i=0;i<points.length;i++){const p=indices[i]*4,c=frame.rgba[p]|(frame.rgba[p+1]<<8)|(frame.rgba[p+2]<<16);colors[i]=calibrateColor(scaleColor(c,config.brightness/100*(frame.rgba[p+3]/255)),points[i].calibration);}
 return colors;
}

export function calibratePackedFrame(points,config,input){
 const colors=new Uint32Array(points.length);
 for(let i=0;i<points.length;i++)colors[i]=calibrateColor(scaleColor(input[i],config.brightness/100),points[i].calibration);
 return colors;
}
