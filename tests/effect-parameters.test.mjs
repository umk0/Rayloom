import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BUILTIN_EFFECTS,sampleBuiltin} from '../shared/builtin-effects.mjs';
import {getEffectParameterSchema,readEffectParameter,updateEffectParameter,applyNativeEffectParameters,validateParameterDefinitions,normalizeEffectParameterValues,normalizeEffectParameterMap} from '../shared/effect-parameters.mjs';
import {normalizeSceneConfig} from '../shared/scene-config.mjs';
import {validateManifest,sampleEffect} from '../sdk/runtime.mjs';
import {renderSpatialFrame} from '../desktop/frame-renderer.mjs';

const base={color:0x123456,speed:1,scale:350,brightness:100,effect:'prism',gameReactive:false};
const points=Array.from({length:50},(_,i)=>({x:i*31-450,y:i%7*73-190,z:i%3*52-83}));
test('builtin controls describe only parameters that change its real output',()=>{
 assert.deepEqual(getEffectParameterSchema('solid').controls.map(c=>c.key),['color']);
 assert.deepEqual(getEffectParameterSchema('breathing').controls.map(c=>c.key),['color','speed']);
 assert.deepEqual(getEffectParameterSchema('prism').controls.map(c=>c.key),['speed','scale']);
 for(const effect of BUILTIN_EFFECTS){
  const schema=getEffectParameterSchema(effect.id);
  const frame=config=>points.flatMap((point,i)=>[.3,1.7,8].map(t=>sampleBuiltin(effect.id,point,config,t,i)));
  for(const [key,value] of Object.entries({color:0xefccab,speed:3.4,scale:100})){
   const changes=JSON.stringify(frame(base))!==JSON.stringify(frame({...base,[key]:value}));
   assert.equal(schema.controls.some(c=>c.key===key),changes,effect.id+': '+key);
  }
 }
});

test('removed effects produce an actionable unavailable state instead of endless loading',()=>{
 assert.equal(getEffectParameterSchema('openrgb:Missing').loading,true);
 const missing=getEffectParameterSchema('openrgb:Missing',{catalog:[{id:'Different'}]});
 assert.equal(missing.loading,false);assert.equal(missing.unavailable,true);assert.deepEqual(missing.controls,[]);
 assert.equal(getEffectParameterSchema('com.removed.effect/id').unavailable,true);
});

const native={id:'Fixture',name:'Fixture',speedMin:1,speedMax:30,secondaryMin:1,secondaryMax:12,secondaryName:'Длина хвоста',colorCount:2,random:true,onlyFirst:false,
 defaults:{UserColors:[0xff0000,0x00ff00],Slider2Val:3,RandomColors:false,CustomSettings:{colors:[3,4],density:.5,reverse:false,audio_settings:{audio_device:-1},shader_program:{main_pass:{}}}},
 fields:[{key:'colors',type:'colors',label:'colors'},{key:'density',type:'number',label:'Плотность',min:0,max:1,step:.1},{key:'reverse',type:'boolean',label:'reverse'},{key:'audio_settings',type:'object',fields:[{key:'audio_device',type:'enum',options:[{value:-1,label:'Disabled'},{value:0,label:'Loopback'}]}]},{key:'shader_program',type:'object',fields:[]}]};

test('native metadata drives controls and applies exact whitelist paths without mutating defaults',()=>{
 const schema=getEffectParameterSchema('openrgb:Fixture',{catalog:[native]});
 assert.equal(schema.hasAdvancedOnly,true);
 assert(!schema.controls.some(c=>c.key==='scale'));
 const settings=structuredClone(native.defaults);
 const result=applyNativeEffectParameters(native,settings,{'native.UserColors':[1,2],'native.Slider2Val':99,'native.RandomColors':true,'native.CustomSettings.density':.77,'native.CustomSettings.reverse':true,'native.CustomSettings.audio_settings.audio_device':0,'native.CustomSettings.shader_program.main_pass':'bad','native.ControllerZones':[]});
 assert.deepEqual(result.UserColors,[1,2]);assert.equal(result.Slider2Val,12);assert.equal(result.RandomColors,true);assert.equal(result.CustomSettings.density,.8);assert.equal(result.CustomSettings.reverse,true);assert.equal(result.CustomSettings.audio_settings.audio_device,0);assert.deepEqual(result.CustomSettings.shader_program,{main_pass:{}});
 assert.deepEqual(native.defaults.UserColors,[0xff0000,0x00ff00]);
 assert.throws(()=>applyNativeEffectParameters(native,settings,{'native.UserColors':[1]}),/палитру/);
 assert.throws(()=>applyNativeEffectParameters(native,settings,{'native.CustomSettings.audio_settings.audio_device':999}),/Выберите/);
});

test('native fixed-palette effects expose no fake generic color; saved palettes keep previous first color',()=>{
 const rainbow={id:'Rainbow',name:'Rainbow',speedMin:1,speedMax:2,colorCount:0,defaults:{UserColors:[],CustomSettings:{}},fields:[]};
 assert.equal(getEffectParameterSchema('openrgb:Rainbow',{catalog:[rainbow]}).fixedPalette,true);
 const schema=getEffectParameterSchema('openrgb:Fixture',{catalog:[native]});
 const palette=schema.controls.find(c=>c.key==='native.UserColors');
 assert.deepEqual(readEffectParameter(palette,base,'openrgb:Fixture'),[base.color,0x00ff00]);
 assert.deepEqual(readEffectParameter(palette,{...base,effectParameters:{'openrgb:Fixture':{'native.UserColors':[9,10]}}},'openrgb:Fixture'),[9,10]);
 const audio=schema.controls.find(c=>c.key.endsWith('audio_device'));
 assert.equal(readEffectParameter(audio,{effectParameters:{'openrgb:Fixture':{[audio.key]:987}}},'openrgb:Fixture'),-1,'old disconnected audio option must not crash the editor');
});

test('effect settings persist separately and are bounded before crossing the worker boundary',()=>{
 const control={key:'rate',type:'number',binding:'parameter',label:'Rate',min:0,max:10,step:.1,default:1};
 let config=updateEffectParameter(base,'one',control,2);config=updateEffectParameter(config,'two',control,4);
 assert.equal(readEffectParameter(control,config,'one'),2);assert.equal(readEffectParameter(control,config,'two'),4);
 const serialized=JSON.parse(JSON.stringify(normalizeSceneConfig(config)));assert.deepEqual(serialized.effectParameters,{one:{rate:2},two:{rate:4}});
 assert.throws(()=>normalizeEffectParameterMap({one:{rate:Infinity}}));
 assert.throws(()=>normalizeEffectParameterMap(JSON.parse('{"one":{"__proto__":2}}')));
 assert.throws(()=>normalizeEffectParameterMap({one:{value:{nested:1}}}));
 assert.throws(()=>normalizeEffectParameterMap(Object.fromEntries(Array.from({length:129},(_,i)=>['effect'+i,{}]))));
});

test('old bundled Reactor ID and its settings migrate with saved scenes',()=>{
 const legacy='org.lumenrgb.reactor/reactor',current='org.rayloom.reactor/reactor';
 const input={effect:legacy,effectParameters:{[legacy]:{speed:3}}};
 const scene=normalizeSceneConfig(input);
 assert.equal(scene.effect,current);
 assert.deepEqual(scene.effectParameters,{[current]:{speed:3}});
 assert.deepEqual(input.effectParameters,{[legacy]:{speed:3}},'saved input stays intact');
});

test('SDK manifests declare their own working settings and old manifests remain compatible',()=>{
 const example=validateManifest(JSON.parse(fs.readFileSync(new URL('../sdk/examples/parameter-pulse/manifest.json',import.meta.url))));
 const effect=example.effects[0],effectId=example.id+'/'+effect.id;
 const schema=getEffectParameterSchema(effectId,{plugins:[example]});
 assert.deepEqual(schema.controls.map(c=>c.key),['tint','frequency','floor']);
 assert(!schema.controls.some(c=>c.key==='speed'||c.key==='scale'||c.key==='color'));
 const config={...base,effect:effectId};
 const values={tint:255,frequency:2,floor:0};
 const frame=renderSpatialFrame(points,{...config,effectParameters:{[effectId]:values}},{health:1},.5,effect);
 assert.notDeepEqual([...frame],[...renderSpatialFrame(points,config,{health:1},.5,effect)]);
 assert.equal(frame[0],sampleEffect(effect,{x:points[0].x,y:points[0].y,z:points[0].z,t:.5,parameters:values}));
 for(const [key,value] of Object.entries({tint:65280,frequency:1,floor:.6})){
  const frames=p=>[.1,.5,1].map(t=>sampleEffect(effect,{t,parameters:p}));
  assert.notDeepEqual(frames(values),frames({...values,[key]:value}),key+' must affect output');
 }
 const old=validateManifest(JSON.parse(fs.readFileSync(new URL('../sdk/examples/reactor/manifest.json',import.meta.url))));
 assert.deepEqual(getEffectParameterSchema(old.id+'/reactor',{plugins:[old]}).controls.map(c=>c.key),['speed']);
});

test('SDK rejects invalid declarations, unused and unbound parameters before installation',()=>{
 const manifest={schemaVersion:1,id:'com.example.test',version:'1.0.0',name:'Test',effects:[{id:'test',name:'Test',rgb:[0,0,0]}]};
 const number={key:'rate',type:'number',label:'Rate',min:0,max:10,step:1,default:1};
 for(const definition of [{...number,key:'__proto__'},{...number,max:0},{...number,step:0},{...number,default:20},{...number,type:'code'},{key:'tint',type:'color',label:'Tint',default:-1},{key:'flag',type:'boolean',label:'Flag',default:1},{key:'mode',type:'select',label:'Mode',default:0,options:[{value:1,label:'One'}]}])assert.throws(()=>validateParameterDefinitions([definition]));
 assert.throws(()=>validateParameterDefinitions([number,number]));
 assert.throws(()=>validateManifest({...manifest,effects:[{...manifest.effects[0],parameters:[number]}]}),/must be used/);
 assert.throws(()=>validateManifest({...manifest,effects:[{...manifest.effects[0],rgb:[{param:'unknown'},0,0]}]}),/Unknown effect parameter/);
 assert.throws(()=>validateManifest({...manifest,effects:[{...manifest.effects[0],parameters:[{key:'tint',type:'color',label:'Tint',default:0}],rgb:[{param:'tint'},0,0]}]}),/channel/);
 assert.deepEqual(normalizeEffectParameterValues([number],{rate:200}),{rate:10});
 const boolean={key:'enabled',type:'boolean',label:'Enabled',default:true};
 const validated=validateManifest({...manifest,effects:[{...manifest.effects[0],parameters:[boolean],rgb:[{param:'enabled'},0,0]}]});
 assert.equal(sampleEffect(validated.effects[0],{}),255);assert.equal(sampleEffect(validated.effects[0],{parameters:{enabled:false}}),0);
});
