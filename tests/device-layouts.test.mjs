import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as library from '../shared/device-layouts.mjs';
import {validateLayout} from '../shared/spatial.mjs';

const points=(ids=[10,30,50])=>ids.map((led,index)=>({led,x:index*7+1,y:index*3+2,z:index+3}));
const component=()=>({id:'board/zone/1/part/front',name:'Front fans',device:{name:'Board',vendor:'Acme',serial:'123',location:'USB'},deviceKey:'Acme|Board|123',zone:1,source:'test',enabled:true,points:points([50,10,30]),pose:{x:11,y:12,z:13,rx:0,ry:0,rz:0,scale:1}});
const layout=()=>({version:1,components:[component()],groups:[{id:'all',name:'All',members:[]}],scenes:[]});

test('legacy point templates map wiring order to exact sparse target IDs without reordering the target',()=>{
  const target=component(),before=structuredClone(target),template={name:'Old custom',points:[{led:23,x:90,y:0},{led:4,x:10,y:0},{led:9,x:50,y:0}]};
  const result=library.remapTemplatePoints(template,target);
  assert.deepEqual(result.map(point=>point.led),[50,10,30]);assert.deepEqual(result.map(point=>point.x),[90,10,50]);
  assert.deepEqual(target,before);assert.equal(template.points[0].z,undefined);assert(result.every(point=>point.z===0));
  assert.doesNotThrow(()=>validateLayout({...layout(),components:[{...target,points:result}]}));
});

test('shape generation changes geometry only, retaining non-contiguous IDs and array order',()=>{
  const target=points([90,10,70,30,50,110]);
  const result=library.generateLayoutPoints('matrix',target,{columns:3,spacing:2,serpentine:true,start:500});
  assert.deepEqual(result.map(point=>point.led),target.map(point=>point.led));
  assert.deepEqual([...result].sort((a,b)=>a.led-b.led).map(({x,y})=>[x,y]),[[0,0],[2,0],[4,0],[4,2],[2,2],[0,2]]);
  const reversed=library.generateLayoutPoints('strip',points([40,12,25]),{spacing:3,reverse:true});
  assert.deepEqual(reversed.map(({led,x})=>[led,x]),[[40,0],[12,6],[25,3]]);
  assert.throws(()=>library.generateLayoutPoints('constructor',target),/линию/);
  assert.throws(()=>library.generateLayoutPoints('line',target,{spacing:100000}),/Координаты/);
});

test('catalog matrix holes retain their positions and omitted LED coordinates stay at the target location',()=>{
  const template={name:'Keyboard',rows:2,columns:3,matrix:[[0,null,2],[3,4,5]],ledCount:5,requiredLedCount:6};
  const target=points([111,50,60,80,91,100]),before=structuredClone(target),result=library.remapTemplatePoints(template,target);
  assert.equal(library.templatePoints(template).length,6,'compatibility uses the full required hardware LED count');
  assert.deepEqual(result.map(point=>point.led),target.map(point=>point.led));
  assert.deepEqual(result.find(point=>point.led===60),target.find(point=>point.led===60),'missing source LED 1 retains target XYZ');
  assert.deepEqual(result.find(point=>point.led===80),{led:80,x:38,y:0,z:0},'the hole does not shift subsequent columns');
  assert.deepEqual(target,before);
});

test('duplicate matrix indices are rejected explicitly instead of collapsing two positions silently',()=>{
  const template={name:'Ambiguous',columns:3,matrix:[[0,1,1]],requiredLedCount:3};
  assert.throws(()=>library.templatePoints(template),/повторяющиеся индексы/);
  assert.throws(()=>library.remapTemplatePoints(template,points()),/повторяющиеся индексы/);
  assert.deepEqual(library.compatibleTemplates([template],points()),[]);
  assert.equal(library.nativeLayoutTemplate({index:1,startIndex:10,ledCount:3,matrix:{width:3,height:1,map:[0,1,1]}},points([10,11,12])),null);
});

test('compatibility accepts exact counts from legacy, SDK and catalog and hides malformed shapes',()=>{
  const templates=[{name:'SDK',kind:'ring',count:3,radius:10},{name:'Legacy',points:points()},{name:'Catalog',columns:3,matrix:[[0,null,2]],requiredLedCount:3},{name:'Wrong',kind:'grid',count:4},{name:'Duplicate',points:[...points(),points()[0]]},{name:'Bad',kind:'constructor',count:3}];
  assert.deepEqual(library.compatibleTemplates(templates,points()).map(template=>template.name),['SDK','Legacy','Catalog']);
  assert.equal(library.compatibleTemplates(templates,points())[0],templates[0],'matching count does not invent device-match metadata');
  assert.throws(()=>library.remapTemplatePoints(templates[3],points()),/4 LED/);
});

test('native geometry is offered only when every selected hardware ID belongs to the matching zone',()=>{
  const zone={index:1,startIndex:10,ledCount:3,matrix:{width:3,height:1,map:[2,-1,0]}};
  const target={...component(),points:points([12,10])},native=library.nativeLayoutTemplate(zone,target);
  assert.deepEqual(native.points.map(point=>point.led),[12,10]);assert.deepEqual(native.points.map(point=>point.x),[0,38]);
  assert.equal(library.nativeLayoutTemplate(zone,{...target,zone:2}),null);
  assert.equal(library.nativeLayoutTemplate(zone,points([10,13])),null);
  assert.equal(library.nativeLayoutTemplate({...zone,startIndex:65535},points([65535])),null);
});

test('editor validation rejects changed bindings, duplicate IDs, non-finite coordinates and malformed metadata',()=>{
  const target=component(),changed=target.points.map(point=>({...point,x:point.x+100}));
  assert.deepEqual(library.validateDeviceLayoutPoints(changed,target),changed);
  for(const invalid of [changed.slice(1),changed.map((point,i)=>i===0?{...point,led:99}:point),changed.map((point,i)=>i===0?{...point,led:10}:point),changed.map((point,i)=>i===0?{...point,x:NaN}:point),changed.map((point,i)=>i===0?{...point,z:null}:point)])assert.throws(()=>library.validateDeviceLayoutPoints(invalid,target));
  assert.throws(()=>library.makeUserTemplate({name:'Bad',points:changed,zone:-1}),/порт/);
  assert.throws(()=>library.makeUserTemplate({name:'Bad',points:changed,device:{name:7}}),/данные/);
  assert.throws(()=>library.validateUserTemplate({schemaVersion:99,name:'Bad',points:changed}),/версия/);
});

test('user templates are independent snapshots with optional device and zone metadata',()=>{
  const target=component(),template=library.makeUserTemplate({name:'  Передние вентиляторы  ',component:target});
  assert.equal(template.name,'Передние вентиляторы');assert.equal(template.count,3);assert.equal(template.schemaVersion,1);assert.equal(template.zone,1);assert.equal(template.device.serial,'123');assert.equal(template.deviceKey,target.deviceKey);
  target.points[0].x=999;target.device.name='Changed';assert.notEqual(template.points[0].x,999);assert.equal(template.device.name,'Board');
  const generic=library.makeUserTemplate({name:'Generic',points:points()});assert.equal(generic.device,undefined);assert.equal(generic.zone,undefined);
  assert.throws(()=>library.validateUserTemplate({...generic,count:4}),/Число/);
});

test('duplicate names preserve existing templates until replacement is explicit',()=>{
  const old={name:'Fans',points:points(),source:'User calibrated'},fresh=library.makeUserTemplate({name:'Fans',points:points().map(point=>({...point,x:500}))});
  assert.throws(()=>library.upsertUserTemplate([old],fresh),/Подтвердите/);assert.equal(old.points[0].x,1);
  assert.equal(library.upsertUserTemplate([old],fresh,{replace:true})[0].points[0].x,500);
});

// Execute the actual template.save branch without importing Electron. Only the
// dynamic module import is injected; hardware/active-layout methods throw.
const main=fs.readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
const branch=main.split(/\r?\n/).find(line=>line.includes("if(method==='template.save')"));
function host(){
  const active=layout(),config={effect:'wave',brightness:77},calls=[],store={templates:[]};
  const studio={getLayout:()=>active,read:(name,fallback)=>store[name]??fallback,write:(name,value)=>{assert.equal(name,'templates');calls.push('write');store[name]=value;},sync:async()=>{calls.push('state');return {layout:active,current:config,templates:store.templates};},saveLayout:()=>{throw Error('Hardware layout mutation forbidden');},play:()=>{throw Error('Hardware playback forbidden');},stop:()=>{throw Error('Hardware stop forbidden');}};
  const invoke=vm.runInNewContext('(async (method,args)=>{'+branch.replace("await import('../shared/device-layouts.mjs')",'library')+'})',{studio,library});
  return {active,config,calls,store,invoke:args=>invoke('template.save',args)};
}

test('template.save saves explicit draft geometry without applying its layout or changing the running config',async()=>{
  const h=host(),before=structuredClone(h.active),config=structuredClone(h.config),draft=structuredClone(h.active);draft.components[0].name='Draft name';draft.components[0].pose.x=999;
  const edited=draft.components[0].points.map(point=>({...point,x:point.x+42}));
  const state=await h.invoke({component:draft.components[0].id,layout:draft,points:edited,name:'Custom',replace:false});
  assert.deepEqual(h.active,before);assert.deepEqual(h.config,config);assert.deepEqual(h.calls,['write','state']);assert.equal(state.layout,h.active);
  assert.deepEqual(h.store.templates[0].points,edited);assert.equal(h.store.templates[0].zone,1);assert.equal(h.store.templates[0].device.serial,'123');
});

test('template.save accepts unsaved split components in a validated draft, without requiring prior hardware apply',async()=>{
  const h=host(),draft=structuredClone(h.active),original=draft.components[0],part={...original,id:'new-part',points:original.points.slice(0,1)};
  original.points=original.points.slice(1);draft.components.push(part);
  await h.invoke({component:part.id,layout:draft,points:part.points,name:'Split',replace:false});
  assert.equal(h.active.components.length,1);assert.equal(h.active.components[0].points.length,3);assert.deepEqual(h.store.templates[0].points,part.points);
});

test('invalid explicit geometry and unconfirmed name collisions never write or sync',async()=>{
  const h=host(),id=h.active.components[0].id;
  await assert.rejects(h.invoke({component:id,name:'Bad',points:null}),/макете/);
  await assert.rejects(h.invoke({component:id,name:'Bad',points:points([1,2,3])}),/номера LED/);
  await assert.rejects(h.invoke({component:'missing',name:'Bad'}),/не найден/);assert.deepEqual(h.calls,[]);
  await h.invoke({component:id,name:'Fans',points:h.active.components[0].points,replace:false});const before=structuredClone(h.store.templates);h.calls.length=0;
  await assert.rejects(h.invoke({component:id,name:'Fans',points:h.active.components[0].points}),/Подтвердите/);
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.store.templates,before);
});

test('legacy template.save signature remains usable and new signatures require explicit overwrite',async()=>{
  const h=host(),id=h.active.components[0].id;await h.invoke({component:id,name:'Legacy'});h.active.components[0].points[0].x=123;
  await h.invoke({component:id,name:'Legacy'});assert.equal(h.store.templates.length,1);assert.equal(h.store.templates[0].points[0].x,123);
  await assert.rejects(h.invoke({component:id,name:'Legacy',replace:false}),/Подтвердите/);
  await h.invoke({component:id,name:'Legacy',points:h.active.components[0].points,replace:true});assert.equal(h.store.templates.length,1);
});

test('bundled matrices with ambiguous indices are rejected; all others preserve their full required LED count',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../data/device-catalog.json',import.meta.url),'utf8'));
  assert.equal(catalog.layouts.length,63);const rejected=[];
  for(const template of catalog.layouts){
    const indices=template.matrix.flat().filter(index=>index!==null);
    if(new Set(indices).size!==indices.length){assert.throws(()=>library.templatePoints(template),/повторяющиеся индексы/);rejected.push(template.id);continue;}
    const geometry=library.templatePoints(template);assert.equal(geometry.length,template.requiredLedCount);assert.equal(new Set(geometry.map(point=>point.led)).size,geometry.length);
  }
  assert.deepEqual(rejected,['ca175964e67d1f7f0d45']);
});
