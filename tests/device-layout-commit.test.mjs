import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as spatial from '../shared/spatial.mjs';
import * as visibility from '../shared/device-visibility.mjs';
import * as scenes from '../shared/scene-config.mjs';
import * as hydration from '../shared/studio-hydration.mjs';
import * as deviceLayouts from '../shared/device-layouts.mjs';

const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const hookSource=transpile('../src/mantine/useStudio.ts'),typeSource=transpile('../src/studio-types.ts');
const points=()=>[{led:12,x:0,y:0,z:0},{led:15,x:19,y:0,z:0}],replacement=()=>[{led:12,x:0,y:0,z:2},{led:15,x:0,y:24,z:3}];
const fixture=()=>({version:1,components:[{id:'port',name:'Front fans',device:{name:'Board',serial:'board'},deviceKey:'board',zone:1,source:'native',enabled:true,points:points(),pose:{x:140,y:30,z:2,rx:0,ry:45,rz:10,scale:1.2},calibration:{channelOrder:'GRB',brightness:80}}],groups:[{id:'all',name:'All',members:[]},{id:'fans',name:'Fans',members:['port']}],deviceAliases:{board:'My motherboard'},scenes:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const plain=value=>JSON.parse(JSON.stringify(value));

// Execute the real useStudio handlers against deferred IPC. No React DOM,
// Electron window, core process or hardware is started by these tests.
function controller(){
 const slots=[];let cursor=0;const requests=[],saves=[];
 const remote={mode:'hardware',layout:fixture(),current:scenes.normalizeSceneConfig({effect:'prism'}),running:false};
 const react={useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useEffect:()=>{}};
 const types={};vm.runInNewContext(typeSource,{exports:types});
 const modules={'react':react,'../studio-types':types,'../../shared/spatial.mjs':spatial,'../../shared/device-visibility.mjs':visibility,'../../shared/scene-config.mjs':scenes,'../../shared/studio-hydration.mjs':hydration,'../../shared/device-layouts.mjs':deviceLayouts};
 const studio=async(method,args)=>{
  requests.push({method,args});
  if(method==='state')return structuredClone(remote);
  if(method==='save'){const pending=deferred();saves.push({args,...pending});return pending.promise;}
  throw Error('Unexpected IPC '+method);
 };
 const exports={};vm.runInNewContext(hookSource,{exports,require:name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},window:{rayloom:{studio,snapshot:async()=>({mode:remote.mode,devices:[],plugins:[],starting:true})}},console,structuredClone,Date,Map,WeakMap,Set});
 const render=()=>{cursor=0;return exports.useStudio();};render().adoptLayout(fixture());render();
 const confirm=(index=0)=>saves[index].resolve({mode:remote.mode,layout:structuredClone(saves[index].args.layout)});
 return {render,remote,requests,saves,confirm};
}

test('device layout becomes visible only after saving the complete layout succeeds',async()=>{
 const h=controller(),base=h.render().layout,newPoints=replacement(),pending=h.render().applyDeviceLayout('port',newPoints,points(),'My form');
 assert.equal(h.render().layout,base);assert.equal(h.render().dirty,false);assert.equal(h.render().busy,true);assert.equal(h.saves[0].args.resume,true);
 assert.deepEqual(plain(h.saves[0].args.layout.components[0].points),newPoints);newPoints[0].x=999;
 h.confirm();await pending;const result=h.render();assert.equal(result.busy,false);assert.equal(result.dirty,false);
 assert.deepEqual(plain(result.layout.components[0].points),replacement());
 assert.deepEqual(plain({...result.layout.components[0],points:base.components[0].points,source:'native'}),base.components[0]);
 assert.deepEqual(plain(result.layout.groups),base.groups);assert.deepEqual(plain(result.layout.deviceAliases),base.deviceAliases);
});

test('failed device layout save leaves the original component and dirty state untouched, then permits retry',async()=>{
 const h=controller();h.render().update({...h.render().layout.components[0],name:'Unsaved name'});const base=h.render().layout,pending=h.render().applyDeviceLayout('port',replacement(),points(),'Draft form');
 h.saves[0].reject(Error('disk unavailable'));await assert.rejects(pending,/disk unavailable/);assert.equal(h.render().layout,base);assert.equal(h.render().dirty,true);assert.equal(h.render().busy,false);
 const retry=h.render().applyDeviceLayout('port',replacement(),points(),'Draft form');h.confirm(1);await retry;assert.equal(h.render().dirty,false);assert.equal(h.render().layout.components[0].name,'Unsaved name');
});

test('new name, pose, calibration, membership and hotplug survive a pending form save',async()=>{
 const h=controller(),base=h.render().layout,pending=h.render().applyDeviceLayout('port',replacement(),points(),'Applied form');
 const current={...base,components:[{...base.components[0],name:'New name',enabled:false,pose:{...base.components[0].pose,x:500},calibration:{channelOrder:'BGR',brightness:45}},{...base.components[0],id:'hotplug',deviceKey:'new-device',name:'New device'}],groups:[base.groups[0],{...base.groups[1],name:'New group name',members:['port','hotplug']}]};
 h.render().edit(current);h.confirm();await pending;const result=h.render();assert.equal(result.dirty,true);assert.equal(result.layout.components.length,2);
 assert.deepEqual(plain(result.layout.components[0]),{...current.components[0],points:replacement(),source:'Applied form'});assert.deepEqual(plain(result.layout.groups),current.groups);
});

for(const change of ['points','deviceKey','zone','source','removed','roundtrip'])test(`pending form save refuses to replace newer component ${change}`,async()=>{
 const h=controller(),base=h.render().layout,pending=h.render().applyDeviceLayout('port',replacement(),points(),'Old submitted form');
 const component=base.components[0];
 if(change==='removed')h.render().edit({...base,components:[],groups:[base.groups[0]]});
 else if(change==='roundtrip'){h.render().update({...component,points:component.points.map(p=>({...p,x:p.x+1}))});h.render().update(component);}
 else h.render().update({...component,[change]:change==='points'?component.points.map(p=>({...p,x:p.x+1})):change==='zone'?2:'Changed'});
 const newer=h.render().layout;h.confirm();await assert.rejects(pending,/Новые локальные правки сохранены/);
 assert.equal(h.render().layout,newer);assert.equal(h.render().dirty,true);assert.equal(h.render().busy,false);
});

test('a component removed and recreated with the same id is not overwritten by the old save',async()=>{
 const h=controller(),base=h.render().layout,pending=h.render().applyDeviceLayout('port',replacement(),points(),'Old form');
 h.render().edit({...base,components:[],groups:[base.groups[0]]});h.render().edit(base);h.confirm();await assert.rejects(pending,/Новые локальные правки сохранены/);
 assert.equal(h.render().layout,base);assert.equal(h.render().layout.components[0].source,'native');
});

test('invalid LED sets and a stale editor geometry are rejected before persistence',async()=>{
 const h=controller(),base=h.render().layout;
 await assert.rejects(h.render().applyDeviceLayout('port',[{led:12,x:0,y:0,z:0},{led:13,x:1,y:1,z:0}],points(),'Wrong binding'));
 await assert.rejects(h.render().applyDeviceLayout('port',replacement(),points().map(p=>({...p,x:999})),'Old editor'),/изменилась после открытия/);
 await assert.rejects(h.render().applyDeviceLayout('missing',replacement(),points(),'Missing'),/больше не существует/);
 assert.equal(h.saves.length,0);assert.equal(h.render().layout,base);assert.equal(h.render().dirty,false);assert.equal(h.render().busy,false);
});

test('point array ordering may change but its exact LED-to-position mapping remains the expected baseline',async()=>{
 const h=controller(),pending=h.render().applyDeviceLayout('port',replacement().reverse(),points().reverse(),'Reordered array');h.confirm();await pending;
 assert.deepEqual([...h.render().layout.components[0].points].sort((a,b)=>a.led-b.led),replacement());
});

test('busy lock rejects a second form commit and prevents mode/hardware commands from overlapping',async()=>{
 const h=controller(),pending=h.render().applyDeviceLayout('port',replacement(),points(),'Form');
 await assert.rejects(h.render().applyDeviceLayout('port',replacement(),points(),'Duplicate'),/Дождитесь/);
 await h.render().changeMode('virtual');await h.render().play();assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'save');assert.equal(h.render().busy,true);
 h.confirm();await pending;assert.equal(h.render().busy,false);
});

test('a cancelled engine save returning unchanged state is not reported as a committed form',async()=>{
 const h=controller(),base=h.render().layout,pending=h.render().applyDeviceLayout('port',replacement(),points(),'Not saved');h.saves[0].resolve({layout:base});
 await assert.rejects(pending,/не подтвердил сохранение/);assert.equal(h.render().layout,base);assert.equal(h.render().dirty,false);assert.equal(h.render().busy,false);
});

test('confirmation covers unrelated unsaved fields, even if the requested points were already equal',async()=>{
 const h=controller(),original=h.render().layout;h.render().update({...original.components[0],name:'Unsaved name'});const current=h.render().layout;
 const pending=h.render().applyDeviceLayout('port',points(),points(),'native');h.saves[0].resolve({layout:original});await assert.rejects(pending,/не подтвердил сохранение/);
 assert.equal(h.render().layout,current);assert.equal(h.render().dirty,true);
});

test('external mode epoch change prevents a completed old-mode save from touching the new layout',async()=>{
 const h=controller();await h.render().refresh();const pending=h.render().applyDeviceLayout('port',replacement(),points(),'Hardware form');
 h.remote.mode='virtual';h.remote.layout={...fixture(),components:[{...fixture().components[0],name:'Virtual port'}]};await h.render().refresh();const virtual=h.render().layout;
 h.confirm();await assert.rejects(pending,/прежнего режима/);assert.equal(h.render().layout,virtual);assert.equal(h.render().layout.components[0].name,'Virtual port');assert.equal(h.render().dirty,false);
});
