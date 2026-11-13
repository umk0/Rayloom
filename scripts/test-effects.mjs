import {CoreClient} from '../desktop/core-client.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'..'),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-all-effects-'));
const core=new CoreClient(root,runtime);const report={runtime,physicalHardwareTested:false,results:[]};
const rpc=(method,params={})=>core.call('plugin.rpc',{plugin:'org.openrgb.openrgbeffectsplugin',request:{method,...params}});
try{
 await core.start();const catalog=await rpc('catalog');assert.equal(catalog.length,58);assert.equal(catalog.find(c=>c.id==='AudioSync').defaults.CustomSettings.hue_shift,0);for(let i=0;i<3;i++)assert.equal((await rpc('catalog')).find(c=>c.id==='AudioSync').defaults.CustomSettings.hue_shift,0,'constructor defaults must not depend on Qt valueChanged signals');
 fs.writeFileSync(path.join(root,'artifacts/effects-catalog.json'),JSON.stringify(catalog,null,2));
 const devices=await core.call('devices.list'),d=devices[0];
 const zones=[{zone_idx:0,reverse:false,self_brightness:100,name:d.name,location:d.location,serial:d.serial,description:d.description,version:d.version,vendor:d.vendor,is_segment:false,segment_idx:-1}];
 for(const c of catalog){
   try{const e=structuredClone(c.defaults);e.AutoStart=false;e.ControllerZones=zones;
    if(e.EffectClassName==='CustomBlink')e.CustomSettings.pattern_list=['Blink 1','Marquee 1'];
    if(e.EffectClassName==='Layers')e.CustomSettings.groups=[{composer_fn:6,layers:[{composer_fn:6,effect_settings:structuredClone(catalog.find(c=>c.id==='RainbowWave').defaults)}]}];
    const p=await rpc('scene.apply',{profile:{version:2,Effects:[e]}});assert.equal(p.Effects.length,1,c.id+' loaded');assert.equal(p.Effects[0].EffectClassName,c.id);
    const roundtrip=await rpc('scene.get');assert(Array.isArray(roundtrip.Effects[0].UserColors),c.id+' serializes an empty generic palette explicitly');
    await rpc('scene.apply',{profile:roundtrip});
    if(c.colorCount===0){const legacy=structuredClone(roundtrip);delete legacy.Effects[0].UserColors;const restored=await rpc('scene.apply',{profile:legacy});assert.deepEqual(restored.Effects[0].UserColors,[]);}
    if(!['Ambient','GIFPlayer'].includes(c.id)){await rpc('start');await delay(100);assert.equal((await rpc('scene.get')).Effects[0].AutoStart,true);await rpc('stop');}
    report.results.push({effect:c.id,loaded:true,started:!['Ambient','GIFPlayer'].includes(c.id)});console.log('PASS',c.id);
   }catch(e){report.results.push({effect:c.id,error:e.message});console.log('FAIL',c.id,e.message);}
 }
 const g=await rpc('globals.get');await rpc('globals.set',{settings:g.value});
 const bad=structuredClone(catalog.find(c=>c.id==='AudioSync').defaults);bad.CustomSettings.audio_settings.equalizer=[];
 await assert.rejects(rpc('scene.apply',{profile:{version:2,Effects:[bad]}}),/equalizer/);
 await assert.rejects(rpc('scene.apply',{profile:{version:2,Effects:[{...catalog[0].defaults,FPS:0}]}}),/FPS/);
 const nested={...structuredClone(catalog.find(c=>c.id==='Layers').defaults),AutoStart:false};
 const child=structuredClone(catalog.find(c=>c.id==='RainbowWave').defaults);delete child.UserColors;delete child.AutoStart;delete child.ControllerZones;delete child.SelectAll;
 nested.CustomSettings.groups=[{composer_fn:6,layers:[{composer_fn:6,effect_settings:child}]}];
 const layerScene=await rpc('scene.apply',{profile:{version:2,Effects:[nested]}});await rpc('scene.apply',{profile:await rpc('scene.get')});assert.deepEqual(layerScene.Effects[0].CustomSettings.groups[0].layers[0].effect_settings.UserColors,[]);
 const beforeInvalid=await rpc('scene.get');
 const normalizedOnly=await rpc('scene.validate',{profile:{version:2,Effects:[{EffectClassName:'RainbowWave'}]}});assert.deepEqual(normalizedOnly.Effects[0].UserColors,[]);assert.equal(normalizedOnly.Effects[0].AutoStart,false);
 assert.deepEqual(await rpc('scene.get'),beforeInvalid,'validation never applies a scene');
 await assert.rejects(rpc('scene.validate',{profile:{version:2,Effects:[{EffectClassName:'AudioSync',CustomSettings:{audio_settings:[]}}]}}),/Effect AudioSync:/);
 await assert.rejects(rpc('scene.apply',{profile:{version:2,Effects:[{...catalog[0].defaults,UserColors:{invalid:true}}]}}),/Effect .*Invalid user color count/);
 assert.deepEqual(await rpc('scene.get'),beforeInvalid,'invalid profile never clears the active tabs');
 await assert.rejects(rpc('scene.apply',{profile:{version:2,Effects:[{EffectClassName:'AudioSync',CustomSettings:{audio_settings:[]}}]}}),/Effect AudioSync:/);
 report.validation=true;
}finally{await core.stop();report.exitCode=core.exitCode;report.forcedKill=!!core.forcedKill;fs.writeFileSync(path.join(root,'artifacts/effects-smoke.json'),JSON.stringify(report,null,2));}
assert.equal(core.exitCode,0);assert(!core.forcedKill);assert.equal(report.results.length,58);
assert(!report.results.some(r=>r.error),'Some effects failed; see artifacts/effects-smoke.json');
