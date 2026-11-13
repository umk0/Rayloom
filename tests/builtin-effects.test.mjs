import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILTIN_EFFECTS,sampleBuiltin} from '../shared/builtin-effects.mjs';
import {renderSpatialFrame} from '../desktop/frame-renderer.mjs';

const config={color:0x80ffa0,scale:350,speed:1,brightness:65,gameReactive:false};
const points=Array.from({length:77},(_,index)=>({x:(index%11-5)*61,y:(Math.floor(index/11)-3)*49,z:(index%4-2)*37}));
test('each original effect produces bounded deterministic RGB values across space and time',()=>{
 assert.equal(new Set(BUILTIN_EFFECTS.map(effect=>effect.id)).size,13);
 for(const {id} of BUILTIN_EFFECTS)for(const speed of [0,.1,10])for(const scale of [1,350,2000])for(const t of [0,1.25,1e6])for(const [index,p] of points.entries()){
  const value=sampleBuiltin(id,p,{...config,speed,scale},t,index);
  assert.ok(Number.isInteger(value)&&value>=0&&value<=0xffffff,`${id}: ${value}`);
  assert.equal(value,sampleBuiltin(id,p,{...config,speed,scale},t,index));
 }
});
test('speed zero freezes every builtin; all animated effects vary over time',()=>{
 for(const {id} of BUILTIN_EFFECTS){
  const sample=(time,speed)=>points.map((p,index)=>sampleBuiltin(id,p,{...config,speed},time,index));
  assert.deepEqual(sample(0,0),sample(8,0),id);
  if(id!=='solid')assert.notDeepEqual(sample(0,1),sample(8,1),id);
 }
});
test('new effects are visually distinct and feed the production frame renderer',()=>{
 const outputs=BUILTIN_EFFECTS.map(({id})=>points.map((p,index)=>sampleBuiltin(id,p,config,2,index)));
 assert.equal(new Set(outputs.map(output=>JSON.stringify(output))).size,BUILTIN_EFFECTS.length);
 for(const {id} of BUILTIN_EFFECTS){
  const frame=renderSpatialFrame(points,{...config,effect:id,brightness:100},{},2);
  assert.deepEqual([...frame],points.map((p,index)=>sampleBuiltin(id,p,config,2,index)));
 }
});
