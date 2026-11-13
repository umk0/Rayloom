import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateLegacyLayout,migrateLegacyEffectsProfile} from '../shared/legacy-brand-migration.mjs';

test('legacy virtual layout keeps LED geometry, groups and device aliases',()=>{
 const old='LumenRGB|LumenRGB Virtual Strip|preview-001',current='Rayloom|Rayloom Virtual Strip|preview-001';
 const component={id:old+'/zone/0',deviceKey:old,device:{vendor:'LumenRGB',name:'LumenRGB Virtual Strip',serial:'preview-001',location:'LumenRGB:virtual'},name:'LumenRGB Virtual Strip',points:[{led:7,x:20,y:30,z:0}],pose:{x:9,y:8,z:7,rx:0,ry:0,rz:0,scale:1},zone:0,enabled:true};
 const input={version:1,components:[component],groups:[{id:'all',name:'All',members:[]},{id:'desk',name:'Desk',members:[component.id]}],deviceAliases:{[old]:'My preview'}};
 const result=migrateLegacyLayout(input);
 assert.equal(result.components[0].id,current+'/zone/0');assert.equal(result.components[0].deviceKey,current);
 assert.equal(result.components[0].device.location,'Rayloom:virtual');assert.deepEqual(result.components[0].points,component.points);
 assert.deepEqual(result.groups[1].members,[current+'/zone/0']);assert.equal(result.deviceAliases[current],'My preview');
 assert.equal(input.components[0].deviceKey,old,'saved source is untouched');
 assert.equal(migrateLegacyLayout(result),result,'migration is idempotent');
});
test('legacy native zone identity migrates without changing its settings',()=>{
 const input={version:2,Effects:[{EffectClassName:'RainbowWave',UserColors:[1,2],ControllerZones:[{name:'LumenRGB Virtual Strip',vendor:'LumenRGB',serial:'preview-001',location:'LumenRGB:virtual',zone_idx:0,self_brightness:37}]}]};
 const result=migrateLegacyEffectsProfile(input);
 assert.equal(result.Effects[0].ControllerZones[0].location,'Rayloom:virtual');
 assert.equal(result.Effects[0].ControllerZones[0].self_brightness,37);
 assert.deepEqual(input.Effects[0].ControllerZones[0].location,'LumenRGB:virtual');
 assert.equal(migrateLegacyEffectsProfile(result),result);
});
