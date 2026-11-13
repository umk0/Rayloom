import {BUILTIN_EFFECTS} from './builtin-effects.mjs';

// A control describes a value that the renderer actually consumes. Quality and
// whole-scene brightness are deliberately outside this per-effect contract.
const common={
 color:{key:'color',label:'Цвет эффекта',type:'color',binding:'config',default:0x7bf1b4},
 speed:{key:'speed',label:'Скорость',type:'number',binding:'config',min:0,max:10,step:.1,default:1,help:'0 — неподвижно · 10 — быстро'},
 scale:{key:'scale',label:'Размер рисунка',type:'number',binding:'config',min:1,max:2000,step:1,default:350,suffix:' мм',help:'Размер волн и деталей в пространстве устройств'},
};
const safeKey=key=>typeof key==='string'&&/^[a-z][a-z0-9_-]{0,47}$/i.test(key)&&!['constructor','prototype','__proto__'].includes(key);
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const color=value=>Number.isInteger(value)&&value>=0&&value<=0xffffff;
const copy=value=>value===undefined?undefined:structuredClone(value);

export function validateParameterDefinitions(definitions=[]){
 if(!Array.isArray(definitions)||definitions.length>32)throw Error('An effect may declare at most 32 parameters');
 const seen=new Set();
 for(const d of definitions){
  if(!record(d)||!safeKey(d.key)||seen.has(d.key)||typeof d.label!=='string'||!d.label.trim()||d.label.length>100)throw Error('Invalid effect parameter');
  seen.add(d.key);
  if(d.help!==undefined&&(typeof d.help!=='string'||d.help.length>500))throw Error('Invalid parameter help');
  if(d.type==='number'){
   if(![d.min,d.max,d.default,d.step??1].every(Number.isFinite)||Math.abs(d.min)>1e6||Math.abs(d.max)>1e6||d.max<=d.min||d.default<d.min||d.default>d.max||(d.step??1)<=0||(d.step??1)>d.max-d.min)throw Error('Invalid numeric parameter range');
  }else if(d.type==='color'){if(!color(d.default))throw Error('Invalid color parameter');}
  else if(d.type==='boolean'){if(typeof d.default!=='boolean')throw Error('Invalid boolean parameter');}
  else if(d.type==='select'){
   if(!Array.isArray(d.options)||!d.options.length||d.options.length>32||d.options.some(o=>!record(o)||typeof o.label!=='string'||!o.label.trim()||o.label.length>100||!Number.isFinite(o.value)||Math.abs(o.value)>1e6)||new Set(d.options.map(o=>o.value)).size!==d.options.length||!d.options.some(o=>o.value===d.default))throw Error('Invalid select parameter');
  }else throw Error('Unsupported parameter type');
 }
 return definitions;
}

export function normalizeParameterValue(control,value){
 if(value===undefined)return copy(control.default);
 if(control.type==='number'){
  if(typeof value!=='number'||!Number.isFinite(value))throw Error(`Укажите число в поле «${control.label}».`);
  const next=Math.max(control.min,Math.min(control.max,value));
  const step=control.step??1;
  return Math.max(control.min,Math.min(control.max,Number((control.min+Math.round((next-control.min)/step)*step).toFixed(8))));
 }
 if(control.type==='color'){if(!color(value))throw Error(`Выберите цвет в поле «${control.label}».`);return value;}
 if(control.type==='boolean'){if(typeof value!=='boolean')throw Error(`Неверное значение «${control.label}».`);return value;}
 if(control.type==='select'){if(!control.options.some(o=>o.value===value))throw Error(`Выберите значение «${control.label}».`);return value;}
 if(control.type==='palette'){
  if(!Array.isArray(value)||value.length<(control.minItems??1)||value.length>(control.maxItems??256)||!value.every(color))throw Error(`Проверьте палитру «${control.label}».`);
  return [...value];
 }
 throw Error('Unsupported effect parameter');
}

export function normalizeEffectParameterValues(definitions=[],values={}){
 if(!record(values))throw Error('Настройки эффекта должны быть объектом.');
 const out={};
 for(const d of definitions)out[d.key]=normalizeParameterValue(d,values[d.key]);
 return out;
}

// Keep independently saved choices for each effect, bounded before persistence
// and worker transfer. Schema-specific validation happens when it is selected.
export function normalizeEffectParameterMap(value={}){
 if(!record(value)||Object.keys(value).length>128)throw Error('Слишком много наборов настроек эффектов.');
 const out={};
 for(const [effect,values] of Object.entries(value)){
  if(!effect||effect.length>200||['constructor','prototype','__proto__'].includes(effect)||!record(values)||Object.keys(values).length>128)throw Error('Некорректные настройки эффекта.');
  const normalized={};
  for(const [key,v] of Object.entries(values)){
   if(!/^[a-zA-Z0-9_.-]{1,180}$/.test(key)||key.split('.').some(p=>['constructor','prototype','__proto__'].includes(p)))throw Error('Некорректный параметр эффекта.');
   if(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=0xffffff||typeof v==='string'&&v.length<=256)normalized[key]=v;
   else if(Array.isArray(v)&&v.length<=256&&v.every(color))normalized[key]=[...v];
   else throw Error('Некорректное значение параметра эффекта.');
  }
  out[effect]=normalized;
 }
 return out;
}

const labels={audio_device:'Источник звука',avg_mode:'Сглаживание звука',window_mode:'Анализ частот',gain:'Чувствительность',saturation:'Насыщенность',frequency:'Частота',reverse:'Обратное направление',random_colors:'Случайные цвета',colors:'Палитра',speed:'Скорость',width:'Ширина',height:'Высота',background_color:'Цвет фона'};
function nativeControls(effect){
 const controls=[],defaults=effect.defaults??{};
 if(effect.speedMax>effect.speedMin)controls.push({...common.speed,help:'Темп движения от медленного к быстрому'});
 const count=Number.isInteger(effect.colorCount)?effect.colorCount:(defaults.UserColors?.length??0);
 if(count===1)controls.unshift({...common.color});
 else if(count>1)controls.unshift({key:'native.UserColors',label:'Палитра',type:'palette',binding:'parameter',default:Array.from({length:count},(_,i)=>defaults.UserColors?.[i]??0xffffff),minItems:count,maxItems:count,nativePath:['UserColors'],legacyColorFirst:true});
 if(effect.secondaryMax>effect.secondaryMin)controls.push({key:'native.Slider2Val',label:effect.secondaryName||'Размер рисунка',type:'number',binding:'parameter',min:effect.secondaryMin,max:effect.secondaryMax,step:1,default:defaults.Slider2Val,nativePath:['Slider2Val']});
 if(effect.random)controls.push({key:'native.RandomColors',label:'Случайные цвета',type:'boolean',binding:'parameter',default:!!defaults.RandomColors,nativePath:['RandomColors'],advanced:true});
 if(effect.onlyFirst)controls.push({key:'native.AllowOnlyFirst',label:'Один цвет на устройство',type:'boolean',binding:'parameter',default:!!defaults.AllowOnlyFirst,nativePath:['AllowOnlyFirst'],advanced:true});
 let hasAdvancedOnly=false;
 const visit=(fields,value,path)=>{
  for(const field of fields??[]){
   if(!safeKey(field.key))continue;
   if(['show_rendering','restore_token'].includes(field.key))continue;
   const nativePath=[...path,field.key],key='native.'+nativePath.join('.'),current=value?.[field.key];
   const base={key,label:labels[field.key]??field.label??field.key,help:field.key==='gain'?'Если музыка играет, а эффект почти не реагирует, увеличьте чувствительность.':field.help,binding:'parameter',default:copy(current),nativePath,advanced:path.length>1&&!['audio_device','gain'].includes(field.key)};
   if(field.type==='object'&&field.key!=='shader_program'){visit(field.fields,current,nativePath);continue;}
   if(field.type==='boolean'&&typeof current==='boolean')controls.push({...base,type:'boolean'});
   else if(field.type==='color'&&color(current))controls.push({...base,type:'color'});
   else if(field.type==='colors'&&Array.isArray(current)&&current.length&&current.every(color))controls.push({...base,type:'palette',minItems:1,maxItems:256,legacyColorFirst:field.key==='colors'&&count===0});
   else if(field.type==='enum'&&Array.isArray(field.options)&&field.options.some(o=>o.value===current))controls.push({...base,type:'select',options:field.options.map(o=>({value:o.value,label:field.key==='audio_device'&&o.value===-1?'Системный звук · автоматически':o.label}))});
   else if(field.type==='number'&&Number.isFinite(current)&&Number.isFinite(field.min)&&Number.isFinite(field.max)&&field.max>field.min)controls.push({...base,type:'number',min:field.min,max:field.max,step:field.step??(Number.isInteger(current)?1:.01)});
   else hasAdvancedOnly=true;
  }
 };
 visit(effect.fields,defaults.CustomSettings,['CustomSettings']);
 return {controls,hasAdvancedOnly};
}

function usedVariables(expression,result=new Set()){
 if(!expression||typeof expression!=='object')return result;
 if(expression.var)result.add(expression.var);
 for(const child of expression.args??[])usedVariables(child,result);
 return result;
}

export function getEffectParameterSchema(effectId,{catalog=[],plugins=[]}={}){
 const builtin=BUILTIN_EFFECTS.find(e=>e.id===effectId);
 if(builtin)return {name:builtin.name,source:'builtin',fixedPalette:!builtin.controls.includes('color'),controls:builtin.controls.map(key=>({...common[key]})),hasAdvancedOnly:false};
 if(effectId.startsWith('openrgb:')){
  const effect=catalog.find(e=>e.id===effectId.slice(8));
  if(!effect)return {name:'Эффект',source:'native',controls:[],loading:catalog.length===0,unavailable:catalog.length>0};
  const result=nativeControls(effect);
  return {name:effect.name,source:'native',fixedPalette:!result.controls.some(c=>['color','palette'].includes(c.type)),...result};
 }
 const plugin=plugins.find(p=>effectId.startsWith(p.id+'/')),effect=plugin?.effects?.find(e=>plugin.id+'/'+e.id===effectId);
 if(effect){
  const used=new Set();effect.rgb?.forEach(e=>usedVariables(e,used));
  const controls=['speed','scale'].filter(key=>used.has(key)).map(key=>({...common[key]}));
  controls.push(...(effect.parameters??[]).map(d=>({...d,binding:'parameter'})));
  return {name:effect.name,source:'community',controls,fixedPalette:false,hasAdvancedOnly:false};
 }
 return {name:'Эффект',source:'unknown',controls:[],hasAdvancedOnly:false,unavailable:true};
}

export function readEffectParameter(control,config,effectId){
 if(control.binding==='config')return config[control.key]??copy(control.default);
 const saved=config.effectParameters?.[effectId]?.[control.key];
 if(saved!==undefined){try{return normalizeParameterValue(control,saved);}catch{/* A removed device or revised option list must not break the settings screen. */}}
 const fallback=copy(control.default);
 if(control.legacyColorFirst&&fallback?.length&&color(config.color))fallback[0]=config.color;
 return fallback;
}

export function updateEffectParameter(config,effectId,control,value){
 const normalized=normalizeParameterValue(control,value);
 if(control.binding==='config')return {...config,[control.key]:normalized};
 return {...config,effectParameters:{...config.effectParameters,[effectId]:{...config.effectParameters?.[effectId],[control.key]:normalized}}};
}

export function applyNativeEffectParameters(effect,settings,values={}){
 if(!record(values))throw Error('Настройки эффекта должны быть объектом.');
 // Paths come exclusively from the trusted effect description, never from keys
 // received over IPC. Unknown old keys are ignored when a plugin schema changes.
 for(const control of nativeControls(effect).controls){
  if(!control.nativePath||!Object.hasOwn(values,control.key))continue;
  const value=normalizeParameterValue(control,values[control.key]);
  let target=settings;
  for(const segment of control.nativePath.slice(0,-1))target=target[segment];
  target[control.nativePath.at(-1)]=value;
 }
 return settings;
}
