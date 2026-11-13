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
const fixture=()=>({version:1,components:[{id:'port',name:'Front fans',device:{name:'Board'},deviceKey:'board',zone:0,source:'test',enabled:true,points:[{led:0,x:0,y:0,z:0}],pose:{x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1},calibration:{channelOrder:'RGB',brightness:100}}],groups:[{id:'all',name:'All',members:[]}],scenes:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

// Runs the actual hook handlers with deferred IPC. Effects are not mounted:
// these tests cover draft/response ordering, not React DOM or Electron behavior.
function controller(){
 const slots=[];let cursor=0;const requests=[],pending=new Map();
 const remote={mode:'hardware',layout:fixture(),current:scenes.normalizeSceneConfig({effect:'prism'}),running:false};
 const react={useRef:initial=>{const index=cursor++;return slots[index]??(slots[index]={current:initial});},useState:initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];},useEffect:()=>{}};
 const types={};vm.runInNewContext(typeSource,{exports:types});
 const modules={'react':react,'../studio-types':types,'../../shared/spatial.mjs':spatial,'../../shared/device-visibility.mjs':visibility,'../../shared/scene-config.mjs':scenes,'../../shared/studio-hydration.mjs':hydration,'../../shared/device-layouts.mjs':deviceLayouts};
 const exports={};
 const studio=async(method,args)=>{requests.push({method,args});if(pending.has(method))return pending.get(method).promise;if(method==='state')return structuredClone(remote);if(method==='save')return {};if(method==='play')return {current:args.config};throw Error('Unexpected IPC: '+method);};
 vm.runInNewContext(hookSource,{exports,require:name=>{if(!(name in modules))throw Error('Unexpected import: '+name);return modules[name];},window:{rayloom:{studio,snapshot:async()=>({mode:remote.mode,devices:[],plugins:[],starting:true})}},console,structuredClone,Date,Map,WeakMap,Set});
 const render=()=>{cursor=0;return exports.useStudio();};
 const initial=render();initial.adoptLayout(fixture());render();
 return {render,remote,requests,delay:method=>{const job=deferred();pending.set(method,job);return job;}};
}

test('late scene load preserves a newer layout edit and dirty state',async()=>{
 const h=controller(),base=h.render().layout,load=h.delay('scene.load');
 const result=h.render().loadScene('Saved');
 h.render().update({...base.components[0],name:'New local name'});
 load.resolve({layout:{...base,components:[]},config:scenes.normalizeSceneConfig({effect:'aurora'})});
 assert.equal(await result,false);
 const view=h.render();assert.equal(view.layout.components[0].name,'New local name');assert.equal(view.dirty,true);assert.match(view.notice,/Новые правки/);
});

test('scene load with no intervening edits adopts saved layout and config',async()=>{
 const h=controller(),load=h.delay('scene.load'),saved=fixture();saved.components[0].name='Saved name';
 const result=h.render().loadScene('Saved');load.resolve({layout:saved,config:scenes.normalizeSceneConfig({effect:'aurora'})});
 assert.equal(await result,true);const view=h.render();assert.equal(view.layout.components[0].name,'Saved name');assert.equal(view.config.effect,'aurora');assert.equal(view.dirty,false);
});

test('late scene load after a parameter edit keeps a resavable local layout',async()=>{
 const h=controller(),base=h.render().layout,load=h.delay('scene.load');
 const result=h.render().loadScene('Saved');h.render().setField('brightness',31);
 load.resolve({layout:{...base,components:[]},config:scenes.normalizeSceneConfig({effect:'aurora'})});await result;
 assert.equal(h.render().config.brightness,31);assert.equal(h.render().layout,base);assert.equal(h.render().dirty,true);
 await h.render().play();assert.equal(h.requests.find(r=>r.method==='save').args.layout,base);
});

test('late device toggle cannot replace a newer local pose',async()=>{
 const h=controller(),base=h.render().layout,toggle=h.delay('device.enabled');
 const result=h.render().toggleDevice('board',false);
 h.render().update({...base.components[0],pose:{...base.components[0].pose,x:250}});
 toggle.resolve({layout:{...base,components:base.components.map(c=>({...c,enabled:false}))}});await result;
 assert.equal(h.render().layout.components[0].pose.x,250);assert.equal(h.render().layout.components[0].enabled,false);assert.equal(h.render().dirty,true);assert.match(h.render().notice,/Новые правки/);
});

test('late device toggle preserves newer off/on participation intent',async()=>{
 const h=controller(),base=h.render().layout,toggle=h.delay('device.enabled');const result=h.render().toggleDevice('board',false);
 h.render().update({...base.components[0],enabled:false});h.render().update({...base.components[0],enabled:true});
 toggle.resolve({layout:{...base,components:base.components.map(c=>({...c,enabled:false}))}});await result;
 assert.equal(h.render().layout.components[0].enabled,true);assert.equal(h.render().dirty,true);
});

test('device toggle without a concurrent edit adopts confirmed state',async()=>{
 const h=controller(),base=h.render().layout,toggle=h.delay('device.enabled');const result=h.render().toggleDevice('board',false);
 toggle.resolve({layout:{...base,components:base.components.map(c=>({...c,enabled:false}))}});await result;
 assert.equal(h.render().layout.components[0].enabled,false);assert.equal(h.render().dirty,false);
});

test('late save acknowledgement does not clear a more recent dirty draft',async()=>{
 const h=controller(),base=h.render().layout,save=h.delay('save');h.render().update({...base.components[0],name:'First'});
 const result=h.render().save();h.render().update({...base.components[0],name:'Second'});save.resolve({});await result;
 assert.equal(h.render().layout.components[0].name,'Second');assert.equal(h.render().dirty,true);
});

test('saving a named scene captures current drafts without applying layout or clearing dirty',async()=>{
 const h=controller();h.render().update({...h.render().layout.components[0],name:'Saved draft'});h.render().setField('brightness',37);
 const request=h.delay('scene.save'),saving=h.render().saveScene('Evening');
 const sent=h.requests.find(r=>r.method==='scene.save');assert.equal(sent.args.layout.components[0].name,'Saved draft');assert.equal(sent.args.config.brightness,37);assert.equal(sent.args.replace,false);
 h.render().update({...h.render().layout.components[0],name:'Newer edit'});h.render().setField('brightness',49);
 request.resolve({});const saved=await saving;assert.equal(saved.layout.components[0].name,'Saved draft');assert.equal(saved.config.brightness,37);
 assert.equal(h.requests.filter(r=>['save','play','stop'].includes(r.method)).length,0);assert.equal(h.render().dirty,true);assert.equal(h.render().layout.components[0].name,'Newer edit');
});

test('cancelled identify cannot report success or clear a dirty workspace',async()=>{
 const h=controller();h.render().update({...h.render().layout.components[0],name:'Draft'});const request=h.delay('identify'),checking=h.render().identify('port');
 request.resolve(false);await assert.rejects(checking,/Проверка порта прервана/);assert.equal(h.render().dirty,true);
});

test('completed identify clears only the exact saved draft',async()=>{
 const h=controller();h.render().update({...h.render().layout.components[0],name:'Draft'});const request=h.delay('identify'),checking=h.render().identify('port');
 h.render().update({...h.render().layout.components[0],name:'Newer draft'});request.resolve(true);await checking;assert.equal(h.render().dirty,true);assert.equal(h.render().layout.components[0].name,'Newer draft');
});

test('calibration merges only its correction while retaining hotplug and local pose',()=>{
 const h=controller(),base=h.render().layout,saved=structuredClone(base);saved.components[0].calibration.channelOrder='GRB';
 h.render().edit({...base,components:[{...base.components[0],pose:{...base.components[0].pose,x:42}}, {...base.components[0],id:'new-port',name:'Hotplug'}]});
 h.render().adoptLayout(saved,base);const view=h.render();
 assert.equal(view.layout.components.length,2);assert.equal(view.layout.components[0].pose.x,42);assert.equal(view.layout.components[0].calibration.channelOrder,'GRB');assert.equal(view.dirty,true);
});

test('calibration preserves a more recent manual correction and brightness',()=>{
 const h=controller(),base=h.render().layout,saved=structuredClone(base);saved.components[0].calibration.channelOrder='GRB';
 h.render().update({...base.components[0],calibration:{channelOrder:'BGR',brightness:64}});h.render().adoptLayout(saved,base);
 assert.equal(h.render().layout.components[0].calibration.channelOrder,'BGR');assert.equal(h.render().layout.components[0].calibration.brightness,64);assert.equal(h.render().dirty,true);
});

test('calibration with unchanged draft adopts its saved correction cleanly',()=>{
 const h=controller(),base=h.render().layout,saved=structuredClone(base);saved.components[0].calibration.channelOrder='GRB';h.render().adoptLayout(saved,base);
 assert.equal(h.render().layout,saved);assert.equal(h.render().dirty,false);
});

test('splitting a port preserves group membership and LED ownership',()=>{
 const h=controller(),base=fixture();base.components[0].points=[0,1,2,3].map(led=>({led,x:led*10,y:0,z:0}));
 base.groups.push({id:'front',name:'Front',members:['port']},{id:'other',name:'Other',members:[]});h.render().adoptLayout(base);
 const component=h.render().layout.components[0],part={...component,id:'port/part/fan',name:'Second fan',points:component.points.slice(2)};
 h.render().split(component,part);const view=h.render();
 assert.deepEqual(Array.from(view.layout.groups.find(g=>g.id==='front').members),['port','port/part/fan']);
 assert.equal(view.layout.groups.find(g=>g.id==='other').members.length,0);assert.equal(view.layout.groups.find(g=>g.id==='all').members.length,0);
 assert.deepEqual(Array.from(view.layout.components).flatMap(c=>Array.from(c.points,p=>p.led)).sort(),[0,1,2,3]);
 assert.equal(view.selected,part.id);assert.equal(view.dirty,true);
});

test('failed group deletion rolls back against the live root layout after the editor has left',async()=>{
 const h=controller(),base=fixture();base.groups.push({id:'front',name:'Front',members:['port']});h.render().adoptLayout(base);h.render().setField('group','front');
 const save=h.delay('save'),request=h.render().removeGroup('front');assert(!h.render().layout.groups.some(g=>g.id==='front'));
 const current=h.render().layout;h.render().edit({...current,components:[...current.components,{...current.components[0],id:'hotplug'}]});
 save.reject(Error('disk unavailable'));await assert.rejects(request,/disk unavailable/);const view=h.render();
 assert(view.layout.groups.some(g=>g.id==='front'));assert(view.layout.components.some(c=>c.id==='hotplug'));assert.equal(view.config.group,'front');assert.equal(view.dirty,true);
});

test('failed group deletion does not overwrite a group recreated while the request was pending',async()=>{
 const h=controller(),base=fixture();base.groups.push({id:'front',name:'Old',members:['port']});h.render().adoptLayout(base);const save=h.delay('save'),request=h.render().removeGroup('front');
 h.render().edit({...h.render().layout,groups:[...h.render().layout.groups,{id:'front',name:'Recreated',members:[]}]});save.reject(Error('disk unavailable'));await assert.rejects(request);
 assert.equal(h.render().layout.groups.find(g=>g.id==='front').name,'Recreated');
});

test('failed group deletion cannot restore a group into another equipment epoch',async()=>{
 const h=controller();await h.render().refresh();const base=fixture();base.groups.push({id:'front',name:'Front',members:['port']});h.render().adoptLayout(base);const save=h.delay('save'),request=h.render().removeGroup('front');
 h.remote.mode='virtual';h.remote.layout={...fixture(),components:[]};await h.render().refresh();const current=h.render().layout;save.reject(Error('disk unavailable'));await assert.rejects(request);
 assert.equal(h.render().layout,current);assert(!h.render().layout.groups.some(g=>g.id==='front'));
});

test('successful active group deletion resets only that selection independently of editor navigation',async()=>{
 const h=controller(),base=fixture();base.groups.push({id:'front',name:'Front',members:['port']});h.render().adoptLayout(base);h.render().setField('group','front');const save=h.delay('save'),request=h.render().removeGroup('front');
 save.resolve({});await request;assert.equal(h.render().config.group,'all');assert.equal(h.render().dirty,false);
});

test('successful group deletion preserves a newer group selection and other parameter edits',async()=>{
 const h=controller(),base=fixture();base.groups.push({id:'front',name:'Front',members:['port']},{id:'other',name:'Other',members:['port']});h.render().adoptLayout(base);h.render().setField('group','front');const save=h.delay('save'),request=h.render().removeGroup('front');
 h.render().setField('group','other');h.render().setField('brightness',29);save.resolve({});await request;assert.equal(h.render().config.group,'other');assert.equal(h.render().config.brightness,29);
});

test('responses from a previous equipment mode cannot replace the current layout',async()=>{
 const h=controller();await h.render().refresh();const base=h.render().layout,toggle=h.delay('device.enabled');const result=h.render().toggleDevice('board',false);
 h.remote.mode='virtual';h.remote.layout={...fixture(),components:[]};await h.render().refresh();h.render();
 toggle.resolve({layout:base});await result;const current=h.render().layout;
 assert.equal(current.components.length,0);assert.equal(h.render().adoptLayout(base,base),false);assert.equal(h.render().layout,current);assert.equal(h.render().dirty,false);
});
