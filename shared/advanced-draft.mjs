const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const color=value=>Number.isInteger(value)&&value>=0&&value<=0xffffff;
export const LEGACY_ADVANCED_DRAFT_KEY='rayloom.advanced-scene-draft';
export function advancedDraftKey(mode){if(!['hardware','virtual'].includes(mode))throw Error('Unknown studio mode');return `${LEGACY_ADVANCED_DRAFT_KEY}.${mode}`;}
function mergeDefaults(defaults,value){
 if(value===undefined||value===null)return clone(defaults);
 if(!object(defaults)||!object(value))return clone(value);
 const result=clone(value);
 for(const [key,fallback] of Object.entries(defaults)){
  if(['__proto__','prototype','constructor'].includes(key))continue;
  result[key]=mergeDefaults(fallback,value[key]);
 }
 return result;
}
function validateFields(fields,value){
 for(const f of fields??[]){
  const v=value[f.key];
  const fail=()=>{throw Error(`Не удалось восстановить параметр «${f.label??f.key}».`);};
  if(f.type==='number'&&(!Number.isFinite(v)))fail();
  else if(f.type==='boolean'&&typeof v!=='boolean')fail();
  else if(f.type==='color'&&!color(v))fail();
  else if(f.type==='colors'&&(!Array.isArray(v)||!v.every(color)))fail();
  else if(['array','layers'].includes(f.type)&&!Array.isArray(v))fail();
  else if(['string','file','code'].includes(f.type)&&typeof v!=='string')fail();
  else if(f.type==='object'){if(!object(v))fail();validateFields(f.fields,v);}
 }
}
export function normalizeAdvancedScene(profile,catalog){
 if(profile?.version!==2||!Array.isArray(profile.Effects)||profile.Effects.length>64)throw Error('Нужен профиль Effects Plugin версии 2, до 64 эффектов.');
 const normalize=(input,depth=0)=>{
  if(depth>5||!object(input)||typeof input.EffectClassName!=='string')throw Error('Некорректный эффект в черновике.');
  const description=catalog.find(d=>d.id===input.EffectClassName);
  if(!description)throw Error('Эффект «'+input.EffectClassName+'» сейчас недоступен.');
  const result=mergeDefaults(description.defaults,input);
  for(const key of ['FPS','Speed','Slider2Val','Brightness','Temperature','Tint'])if(!Number.isFinite(result[key]))throw Error('Некорректный числовой параметр: '+key);
  if(typeof result.CustomName!=='string'||!object(result.CustomSettings)||!Array.isArray(result.ControllerZones)||result.ControllerZones.some(z=>!object(z)))throw Error('Некорректная структура эффекта.');
  result.ControllerZones=result.ControllerZones.map(z=>({...z,reverse:z.reverse===true,self_brightness:Number.isFinite(z.self_brightness)?z.self_brightness:100}));
  if(input.UserColors!==undefined&&(!Array.isArray(input.UserColors)||!input.UserColors.every(color)))throw Error('Некорректная палитра эффекта.');
  result.UserColors=Array.from({length:description.colorCount},(_,i)=>input.UserColors?.[i]??description.defaults.UserColors?.[i]??0xffffff);
  validateFields(description.fields,result.CustomSettings);
  if(result.EffectClassName==='Layers'){
   const groups=result.CustomSettings.groups??[];
   if(!Array.isArray(groups)||groups.length>16)throw Error('Некорректные группы слоёв.');
   for(const group of groups){
    if(!object(group)||!Number.isInteger(group.composer_fn)||!Array.isArray(group.layers)||group.layers.length>32)throw Error('Некорректная группа слоёв.');
    for(const layer of group.layers){if(!object(layer)||!Number.isInteger(layer.composer_fn))throw Error('Некорректный слой.');layer.effect_settings=normalize(layer.effect_settings,depth+1);}
   }
  }
  if(result.EffectClassName==='Shaders'){
   const program=result.CustomSettings.shader_program;
   if(!object(program)||!object(program.main_pass)||!Array.isArray(program.passes)||program.passes.some(p=>!object(p)))throw Error('Некорректная программа шейдера.');
  }
  return result;
 };
 return {version:2,Effects:profile.Effects.map(e=>normalize(e))};
}

export function readAdvancedDraft(storage,mode,catalog){
 const key=advancedDraftKey(mode),scoped=storage.getItem(key),legacy=scoped===null?storage.getItem(LEGACY_ADVANCED_DRAFT_KEY):null,raw=scoped??legacy;
 if(raw===null)return {key,scene:null,recovery:null};
 if(legacy!==null)return {key,scene:null,recovery:{raw,sourceKey:LEGACY_ADVANCED_DRAFT_KEY,error:'Найден черновик прежней версии без указания режима. Его можно импортировать в текущий режим.',legacy:true}};
 try{return {key,scene:normalizeAdvancedScene(JSON.parse(raw),catalog),recovery:null};}
 catch(error){return {key,scene:null,recovery:{raw,sourceKey:key,error:String(error),legacy:false}};}
}

// Copy before replacement. If storage is full, the original remains untouched
// and the caller can offer Export instead of silently discarding user work.
export function backupAdvancedDraft(storage,recovery){
 const backupKey=recovery.sourceKey+'.recovery';
 storage.setItem(backupKey,recovery.raw);
 return backupKey;
}
