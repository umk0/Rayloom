import {normalizeEffectParameterMap} from './effect-parameters.mjs';
// Shared by the renderer and the host: inputs stay usable while a number is edited.
export const SCENE_LIMITS=Object.freeze({brightness:{min:0,max:100,default:65,label:'Яркость'},speed:{min:0,max:10,default:1,label:'Скорость'},scale:{min:1,max:2000,default:350,label:'Масштаб'},fps:{min:1,max:120,default:60,label:'Частота кадров'}});
export const SCENE_DEFAULTS=Object.freeze({effect:'rainbow',group:'all',brightness:65,speed:1,scale:350,fps:60,color:0x7bf1b4,gameReactive:false,projection:'xy'});
export function normalizeSceneConfig(input={},previous={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Настройки сцены должны быть объектом.');
 const value={...SCENE_DEFAULTS,...previous,...input};
 for(const [key,limit] of Object.entries(SCENE_LIMITS)){
  const raw=input[key];const fallback=Number.isFinite(previous[key])?previous[key]:limit.default;
  const parsed=raw===undefined||raw===null||(typeof raw==='string'&&!raw.trim())?fallback:typeof raw==='number'?raw:typeof raw==='string'?Number(raw.trim().replace(',','.')):NaN;
  if(!Number.isFinite(parsed))throw Error(`Укажите число в поле «${limit.label}».`);
  value[key]=Math.min(limit.max,Math.max(limit.min,key==='fps'?Math.round(parsed):parsed));
 }
 if(typeof value.color==='string'&&/^#[0-9a-f]{6}$/i.test(value.color)){const s=value.color;value.color=parseInt(s.slice(1,3),16)|(parseInt(s.slice(3,5),16)<<8)|(parseInt(s.slice(5,7),16)<<16);}
 if(!Number.isInteger(value.color)||value.color<0||value.color>0xffffff)throw Error('Выберите цвет в формате #RRGGBB.');
 if(typeof value.effect!=='string'||!value.effect.trim()||value.effect.length>200)throw Error('Выберите эффект.');
 if(value.effect==='org.lumenrgb.reactor/reactor'){
  value.effect='org.rayloom.reactor/reactor';
  if(value.effectParameters&&Object.hasOwn(value.effectParameters,'org.lumenrgb.reactor/reactor')){
   const {['org.lumenrgb.reactor/reactor']:legacy,...rest}=value.effectParameters;
   value.effectParameters={...rest,['org.rayloom.reactor/reactor']:rest['org.rayloom.reactor/reactor']??legacy};
  }
 }
 if(typeof value.group!=='string'||!value.group.trim()||value.group.length>300)throw Error('Выберите группу устройств.');
 if(!['xy','xz','yz'].includes(value.projection))value.projection='xy';
 value.gameReactive=value.gameReactive===true;
 if(value.effectParameters!==undefined)value.effectParameters=normalizeEffectParameterMap(value.effectParameters);
 return value;
}
