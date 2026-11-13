// Declarative plugins are data: no eval, filesystem, network or arbitrary JS.
import {validateParameterDefinitions,normalizeEffectParameterValues} from '../shared/effect-parameters.mjs';
const operations={add:(a,b)=>a+b,sub:(a,b)=>a-b,mul:(a,b)=>a*b,div:(a,b)=>b?a/b:0,sin:a=>Math.sin(a),cos:a=>Math.cos(a),abs:Math.abs,min:Math.min,max:Math.max,fract:a=>a-Math.floor(a),clamp:a=>Math.max(0,Math.min(1,a)),sqrt:a=>Math.sqrt(Math.max(0,a))};
const arity={add:2,sub:2,mul:2,div:2,sin:1,cos:1,abs:1,min:2,max:2,fract:1,clamp:1,sqrt:1};
const variables=new Set(['x','y','z','t','index','health','ammo','speed','scale','brightness']);
export function validateExpression(e,depth=0,budget={n:0},parameters=[]){
 if(++budget.n>512||depth>16)throw Error('Effect expression is too complex');
 if(typeof e==='number'){if(!Number.isFinite(e)||Math.abs(e)>1e6)throw Error('Invalid constant');return;}
 if(e?.var){if(!variables.has(e.var)||Object.keys(e).length!==1)throw Error('Unknown variable');return;}
 if(e?.param){
  const definition=parameters.find(d=>d.key===e.param);
  if(!definition)throw Error('Unknown effect parameter');
  if(definition.type==='color'){
   if(!['r','g','b'].includes(e.channel)||Object.keys(e).length!==2)throw Error('Color parameters require an r, g or b channel');
  }else if(Object.keys(e).length!==1)throw Error('Invalid parameter expression');
  return;
 }
 if(!e||!Object.hasOwn(operations,e.op)||!Array.isArray(e.args)||e.args.length!==arity[e.op])throw Error('Unknown expression');
 e.args.forEach(v=>validateExpression(v,depth+1,budget,parameters));
}
export function evaluate(e,vars){if(typeof e==='number')return e;if(e.var)return vars[e.var]??0;if(e.param){const value=vars.parameters?.[e.param]??0;return e.channel?((value>>(['r','g','b'].indexOf(e.channel)*8))&255)/255:Number(value);}const v=operations[e.op](...e.args.map(a=>evaluate(a,vars)));return Number.isFinite(v)?v:0;}
function usedParameters(expression,used=new Set()){
 if(!expression||typeof expression!=='object')return used;
 if(expression.param)used.add(expression.param);
 for(const child of expression.args??[])usedParameters(child,used);
 return used;
}
export function validateManifest(m){
 if(m?.schemaVersion!==1||!/^([a-z][a-z0-9-]*\.)+[a-z][a-z0-9-]*$/.test(m.id)||!/^\d+\.\d+\.\d+$/.test(m.version)||typeof m.name!=='string'||m.name.length>100||typeof m.id!=='string'||m.id.length>160)throw Error('Invalid plugin manifest');
 for(const key of ['author','license','description'])if(m[key]!==undefined&&(typeof m[key]!=='string'||m[key].length>2000))throw Error('Invalid metadata');
 if(!Array.isArray(m.effects)||m.effects.length>32)throw Error('At most 32 effects per pack');
 const ids=new Set();for(const e of m.effects){if(!/^[a-z][a-z0-9-]*$/.test(e.id)||ids.has(e.id)||typeof e.name!=='string'||e.name.length>100)throw Error('Invalid effect ID');ids.add(e.id);if(!Array.isArray(e.rgb)||e.rgb.length!==3)throw Error('Effect needs three RGB expressions');const parameters=validateParameterDefinitions(e.parameters??[]);e.rgb.forEach(v=>validateExpression(v,0,{n:0},parameters));const used=new Set();e.rgb.forEach(v=>usedParameters(v,used));if(parameters.some(d=>!used.has(d.key)))throw Error('Every parameter must be used by an RGB expression');}
 if(m.templates){if(!Array.isArray(m.templates)||m.templates.length>64)throw Error('Invalid templates');for(const t of m.templates){if(!['ring','grid','line'].includes(t.kind)||!Number.isInteger(t.count)||t.count<1||t.count>4096||typeof t.name!=='string'||t.name.length>120)throw Error('Invalid device template');for(const key of ['columns','spacing','radius'])if(t[key]!==undefined&&(!Number.isFinite(t[key])||t[key]<=0||t[key]>100000))throw Error('Invalid template geometry');}}
 return m;
}
const parameterDefaults=new WeakMap();
export function sampleEffect(effect,vars){
 let defaults=parameterDefaults.get(effect);
 if(!defaults){defaults=normalizeEffectParameterValues(effect.parameters??[]);parameterDefaults.set(effect,defaults);}
 const context=vars.parameters?vars:{...vars,parameters:defaults};
 const channels=effect.rgb.map(e=>Math.round(Math.max(0,Math.min(1,evaluate(e,context)))*255));return channels[0]|(channels[1]<<8)|(channels[2]<<16);
}
