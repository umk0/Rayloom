import test from 'node:test';
import assert from 'node:assert/strict';
import {advancedDraftKey,LEGACY_ADVANCED_DRAFT_KEY,normalizeAdvancedScene,readAdvancedDraft,backupAdvancedDraft} from '../shared/advanced-draft.mjs';
const base={EffectClassName:'Wave',CustomName:'',FPS:60,Speed:1,Slider2Val:1,Brightness:100,Temperature:0,Tint:0,RandomColors:false,AllowOnlyFirst:false,AutoStart:true,SelectAll:false,UserColors:[255],CustomSettings:{audio_settings:{audio_device:-1,gain:1}},ControllerZones:[]};
const catalog=[{id:'Wave',colorCount:1,defaults:base,fields:[{key:'audio_settings',type:'object',fields:[{key:'audio_device',type:'enum',options:[{value:-1}]},{key:'gain',type:'number'}]}]}];
class Storage{data=new Map();getItem(key){return this.data.get(key)??null;}setItem(key,value){this.data.set(key,value);}removeItem(key){this.data.delete(key);}}
test('old drafts regain missing colors, zone lists and nested defaults without mutating source',()=>{
 const old={version:2,Effects:[{EffectClassName:'Wave',CustomSettings:{audio_settings:{gain:2}}}]};
 const restored=normalizeAdvancedScene(old,catalog).Effects[0];assert.deepEqual(restored.UserColors,[255]);assert.deepEqual(restored.ControllerZones,[]);assert.deepEqual(restored.CustomSettings.audio_settings,{gain:2,audio_device:-1});assert.equal(old.Effects[0].UserColors,undefined);
 assert.throws(()=>normalizeAdvancedScene({version:2,Effects:[{EffectClassName:'Wave',Speed:'bad'}]},catalog),/числовой/);
});
test('malformed or unavailable drafts remain recoverable instead of being rendered',()=>{
 const storage=new Storage(),key=advancedDraftKey('hardware'),raw='{"version":2,"Effects":[{"EffectClassName":"Removed"}]}';storage.setItem(key,raw);
 const read=readAdvancedDraft(storage,'hardware',catalog);assert.equal(read.scene,null);assert.equal(read.recovery.raw,raw);assert.equal(storage.getItem(key),raw);assert(read.recovery.error.includes('недоступен'));
 const backup=backupAdvancedDraft(storage,read.recovery);assert.equal(storage.getItem(backup),raw);assert.equal(storage.getItem(key),raw);
 storage.setItem(key,'broken JSON');assert.equal(readAdvancedDraft(storage,'hardware',catalog).recovery.raw,'broken JSON');
});
test('hardware and virtual drafts are isolated; old unscoped drafts require explicit import',()=>{
 const storage=new Storage();storage.setItem(advancedDraftKey('virtual'),JSON.stringify({version:2,Effects:[base]}));
 assert.equal(readAdvancedDraft(storage,'hardware',catalog).scene,null);assert.equal(readAdvancedDraft(storage,'virtual',catalog).scene.Effects.length,1);
 storage.setItem(LEGACY_ADVANCED_DRAFT_KEY,JSON.stringify({version:2,Effects:[base]}));
 const read=readAdvancedDraft(storage,'hardware',catalog);assert.equal(read.scene,null);assert.equal(read.recovery.legacy,true);assert.equal(storage.getItem(advancedDraftKey('hardware')),null);
});
test('failed backup cannot erase a damaged draft',()=>{
 const storage=new Storage(),key=advancedDraftKey('hardware');storage.setItem(key,'broken');const read=readAdvancedDraft(storage,'hardware',catalog);storage.setItem=()=>{throw Error('Quota exceeded');};assert.throws(()=>backupAdvancedDraft(storage,read.recovery),/Quota/);assert.equal(storage.getItem(key),'broken');
});
