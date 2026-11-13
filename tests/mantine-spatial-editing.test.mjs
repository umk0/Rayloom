import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as spatial from '../shared/spatial.mjs';
import * as visibility from '../shared/device-visibility.mjs';
import * as view from '../shared/spatial-view.mjs';
import * as deviceLayouts from '../shared/device-layouts.mjs';

const source=name=>ts.transpileModule(readFileSync(new URL(`../src/mantine/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const sources={GroupsPanel:source('GroupsPanel'),SpatialCanvas:source('SpatialCanvas'),MatrixEditor:source('MatrixEditor')};
const groupDraft={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/mantine/group-draft.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:groupDraft});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const device={index:0,name:'Board',vendor:'Test',serial:'123',location:'test',ledCount:2,zoneCount:1,colors:[0,0],zones:[{index:0,name:'ARGB',ledCount:2,startIndex:0}]};
const fixture=()=>({version:1,components:[{id:'port',name:'Fans',device,deviceKey:spatial.deviceKey(device),zone:0,enabled:true,points:[{led:0,x:0,y:0,z:0},{led:1,x:10,y:0,z:0}],pose:{x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1}}],groups:[{id:'all',name:'All',members:[]}],scenes:[]});

// Component handlers execute without mounting React, DOM, Electron or a window.
// Element/ref fakes exercise gesture state, not native pointer/focus behavior.
class FakeElement {
 constructor(component=null){this.component=component;this.captured=new Set();}
 closest(selector){return selector==='[data-component]'&&this.component?{getAttribute:()=>this.component}:null;}
 getBoundingClientRect(){return {left:0,top:0,width:880,height:400};}
 focus(){}
 setPointerCapture(id){this.captured.add(id);}
 hasPointerCapture(id){return this.captured.has(id);}
 releasePointerCapture(id){this.captured.delete(id);}
 contains(target){return target===this;}
}
function componentHarness(name,props){
 const slots=[];let cursor=0,uuid=0,changed=false,effects=[];
 const hooks={useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i]))changed=true;slots[i]=next;}];},useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect:(fn,deps)=>{if(name!=='GroupsPanel')return;const i=cursor++,previous=slots[i];if(!previous||!deps||deps.some((d,j)=>d!==previous.deps[j])){slots[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}},useMemo:fn=>fn(),useId:()=>':test:'};
 const jsx=(type,props)=>({type,props}),ui=new Proxy({Tabs:{List:'Tabs.List',Tab:'Tabs.Tab'}},{get:(target,key)=>target[key]??String(key)});
  const modules={'react':hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'react-dom':{createPortal:children=>children},'@mantine/core':ui,'lucide-react':new Proxy({},{get:(_,key)=>String(key)}),'./StudioControls':{RayloomSelect:'RayloomSelect',BoundedNumber:'BoundedNumber',RayloomSwitch:'RayloomSwitch'},'./group-draft':groupDraft,'../../shared/spatial.mjs':spatial,'../../shared/device-layouts.mjs':deviceLayouts,'../../shared/device-visibility.mjs':visibility,'../../shared/spatial-view.mjs':view,'../types':{hex:n=>'#'+n.toString(16).padStart(6,'0')},'./spatial.css':{}};
 const exports={};vm.runInNewContext(sources[name],{exports,require:key=>{if(!(key in modules))throw Error('Unexpected import: '+key);return modules[key];},crypto:{randomUUID:()=>`test-${++uuid}`},Map,Set,WeakSet,Date,structuredClone,Element:FakeElement,HTMLElement:FakeElement,Node:FakeElement,console});
 const render=()=>{let tree,iterations=0;do{cursor=0;changed=false;effects=[];tree=exports[name](props());effects.forEach(fn=>fn());}while(changed&&++iterations<8);assert(iterations<8,'State/effects converge');return tree;};
 render.unmount=()=>slots.forEach(slot=>slot?.cleanup?.());return render;
}
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
function words(tree){if(tree==null||typeof tree==='boolean')return '';if(Array.isArray(tree))return tree.map(words).join('');if(typeof tree!=='object')return String(tree);return words(tree.props?.children);}
const find=(tree,match)=>{const node=nodes(tree).find(match);assert(node,'Requested component control exists');return node;};
const button=(tree,label)=>find(tree,n=>n.type==='Button'&&(n.props['aria-label']===label||words(n)===label));

let groupScope=0;
function groups({existing=false,onSave=async()=>{},onRemove=async()=>{},draftScope='test-'+(++groupScope)}={}){
 let layout=fixture();if(existing)layout.groups.push({id:'front',name:'Front',members:['port']});const activated=[];
 const props=()=>({layout,onChange:next=>{layout=next;},onSave,onRemove,activeGroup:existing?'front':'all',onActivate:id=>activated.push(id),busy:false,draftScope});
 let renderer=componentHarness('GroupsPanel',props);const render=()=>renderer();
 const name=value=>find(render(),n=>n.type==='TextInput').props.onChange({currentTarget:{value}});
 const member=()=>find(render(),n=>n.type==='Checkbox').props.onChange({currentTarget:{checked:true}});
 return {render,name,member,activated,draftScope,layout:()=>layout,setLayout:next=>{layout=next;},unmount:()=>renderer.unmount(),remount:()=>{renderer=componentHarness('GroupsPanel',props);return render();}};
}

test('failed new group save retries the same identity without duplicate groups',async()=>{
 const first=deferred(),second=deferred();let calls=0;const h=groups({onSave:()=>++calls===1?first.promise:second.promise});h.name('Front');h.member();
 button(h.render(),'Сохранить группу').props.onClick();const id=h.layout().groups[1].id;
 first.reject(Error('disk unavailable'));await settle();h.name('Front corrected');button(h.render(),'Сохранить группу').props.onClick();second.resolve();await settle();
 assert.equal(calls,2);assert.equal(h.layout().groups.length,2);assert.equal(h.layout().groups[1].id,id);assert.equal(h.layout().groups[1].name,'Front corrected');
});

test('double submission before a rerender invokes persistence once',async()=>{
 const job=deferred();let calls=0;const h=groups({onSave:()=>{calls++;return job.promise;}});h.name('Front');h.member();const save=button(h.render(),'Сохранить группу').props.onClick;save();save();
 assert.equal(calls,1);assert.equal(h.layout().groups.length,2);assert.equal(find(h.render(),n=>n.type==='TextInput').props.disabled,true);job.resolve();await settle();
});

test('switching away from an edited group offers stay or discard without losing it silently',()=>{
 const h=groups();h.name('Draft');button(h.render(),'Новая группа').props.onClick();assert.equal(find(h.render(),n=>n.type==='Modal').props.opened,true);
 button(h.render(),'Остаться').props.onClick();assert.equal(find(h.render(),n=>n.type==='TextInput').props.value,'Draft');
 button(h.render(),'Новая группа').props.onClick();button(h.render(),'Не сохранять и перейти').props.onClick();assert.equal(find(h.render(),n=>n.type==='TextInput').props.value,'');
});

test('save before leaving waits for confirmation and does not navigate on failure',async()=>{
 const job=deferred();const h=groups({onSave:()=>job.promise});h.name('Draft');h.member();find(h.render(),n=>n.props?.className==='group-tile all-group').props.onClick();
 button(h.render(),'Сохранить и перейти').props.onClick();assert.equal(h.activated.length,0);job.reject(Error('offline'));await settle();
 assert.equal(h.activated.length,0);assert.equal(find(h.render(),n=>n.type==='Modal').props.opened,true);assert.match(words(h.render()),/Не удалось сохранить группу/);
});

test('delete delegates to the root transaction and retains its draft when it fails after unmount',async()=>{
 const job=deferred(),calls=[],h=groups({existing:true,onRemove:id=>{calls.push(id);return job.promise;}});button(h.render(),'Удалить группу').props.onClick();h.unmount();
 job.reject(Error('offline'));await settle();assert.deepEqual(calls,['front']);assert.equal(groupDraft.readGroupDraft(h.draftScope).editing,'front');assert.equal(h.activated.length,0);
});

test('group draft restores after unmount and hardware/virtual drafts remain separate',()=>{
 const hardware=groups({existing:true,draftScope:'restore-hardware'});hardware.name('Hardware draft');hardware.unmount();
 const virtual=groups({existing:true,draftScope:'restore-virtual'});assert.equal(find(virtual.render(),n=>n.type==='TextInput').props.value,'Front');virtual.name('Virtual draft');virtual.unmount();
 assert.equal(find(hardware.remount(),n=>n.type==='TextInput').props.value,'Hardware draft');assert.equal(find(virtual.remount(),n=>n.type==='TextInput').props.value,'Virtual draft');
});

test('external group changes require explicit conflict resolution before saving a restored draft',async()=>{
 let writes=0;const h=groups({existing:true,onSave:async()=>{writes++;}});h.name('My draft');h.unmount();h.setLayout({...h.layout(),groups:h.layout().groups.map(g=>g.id==='front'?{...g,name:'External name'}:g)});
 assert.equal(find(h.remount(),n=>n.type==='Alert').props.title,'Группа изменилась вне редактора');button(h.render(),'Сохранить группу').props.onClick();await settle();assert.equal(writes,0);assert.equal(h.layout().groups[1].name,'External name');
 button(h.render(),'Оставить мой черновик').props.onClick();button(h.render(),'Сохранить группу').props.onClick();await settle();assert.equal(writes,1);assert.equal(h.layout().groups[1].name,'My draft');
});

test('a draft already present in layout is not replayed over later external changes',()=>{
 const h=groups({existing:true});h.name('Applied name');h.unmount();h.setLayout({...h.layout(),groups:h.layout().groups.map(g=>g.id==='front'?{...g,name:'Applied name'}:g)});h.remount();
 assert.equal(groupDraft.readGroupDraft(h.draftScope),null);h.unmount();h.setLayout({...h.layout(),groups:h.layout().groups.map(g=>g.id==='front'?{...g,name:'Later external'}:g)});
 assert.equal(find(h.remount(),n=>n.type==='TextInput').props.value,'Later external');
});

test('save completion after unmount clears only its own draft revision and never navigates',async()=>{
 const job=deferred(),h=groups({existing:true,onSave:()=>job.promise});h.name('Saving draft');button(h.render(),'Назначить эффект').props.onClick();const old=groupDraft.readGroupDraft(h.draftScope);h.unmount();h.remount();h.name('Newer draft');const newer=groupDraft.readGroupDraft(h.draftScope);assert(newer.revision>old.revision);
 job.resolve();await settle();assert.equal(groupDraft.readGroupDraft(h.draftScope).name,'Newer draft');assert.equal(h.activated.length,0);h.unmount();assert.equal(find(h.remount(),n=>n.type==='TextInput').props.value,'Newer draft');
});

test('save completion after unmount clears the exact saved revision when no newer draft exists',async()=>{
 const job=deferred(),h=groups({existing:true,onSave:()=>job.promise});h.name('Saving draft');button(h.render(),'Сохранить группу').props.onClick();h.unmount();assert(groupDraft.readGroupDraft(h.draftScope));job.resolve();await settle();assert.equal(groupDraft.readGroupDraft(h.draftScope),null);
});

for(const x of [100000,99900,-100000])test(`matrix split at X=${x} stays inside valid layout bounds`,async()=>{
 const layout=fixture();layout.components[0].pose.x=x;let part;const tasks=[];
 const render=componentHarness('MatrixEditor',()=>({component:layout.components[0],device,templates:[],onChange:()=>{},onSplit:value=>{part=value;},onIdentify:async()=>{},run:fn=>{const task=fn();tasks.push(task);return task;}}));
 find(render(),n=>n.type==='BoundedNumber'&&n.props.label==='Количество LED').props.onChange(1);button(render(),'Отделить в новый компонент').props.onClick();await Promise.all(tasks);
 assert(part);assert.equal(Math.abs(part.pose.x-x),150);assert(Math.abs(part.pose.x)<=100000);
 const next={...layout,components:[{...layout.components[0],points:layout.components[0].points.filter(p=>!part.points.some(q=>q.led===p.led))},part]};assert.doesNotThrow(()=>spatial.validateLayout(next));
});

test('legacy matrix template selector filters incompatible entries and preserves sparse LED IDs regardless of start input',async()=>{
 let component={...fixture().components[0],points:[6,1,4].map((led,index)=>({led,x:index,y:0,z:0}))};const tasks=[];
 const targetDevice={...device,ledCount:8,zones:[{...device.zones[0],ledCount:8}]};
 const templates=[{name:'Wrong count',kind:'line',count:2},{name:'Custom',points:[{led:0,x:10,y:5,z:0},{led:1,x:20,y:5,z:0},{led:2,x:30,y:5,z:0}]},{name:'Ambiguous',columns:3,matrix:[[0,1,1]],requiredLedCount:3}];
 const render=componentHarness('MatrixEditor',()=>({component,device:targetDevice,templates,onChange:value=>{component=value;},onSplit:()=>{},onIdentify:async()=>{},run:fn=>{const task=fn();tasks.push(task);return task;}}));
 find(render(),n=>n.type==='BoundedNumber'&&n.props.label==='Первый LED').props.onChange(2);
  const selector=find(render(),n=>n.type==='RayloomSelect'&&n.props.ariaLabel==='Шаблон матрицы');assert.deepEqual(Array.from(selector.props.options,item=>item.label),['Custom']);
 selector.props.onChange('');assert.equal(tasks.length,0);selector.props.onChange('0');await Promise.all(tasks);
 assert.deepEqual(Array.from(component.points,point=>[point.led,point.x]),[[6,30],[1,10],[4,20]]);assert.equal(component.source,'Custom');
});

test('legacy native restore retains exact subset order and never drops an out-of-zone LED',()=>{
 const targetDevice={...device,ledCount:8,zones:[{...device.zones[0],ledCount:8,matrix:{width:4,height:2,map:[0,1,2,3,4,5,6,7]}}]};
 let component={...fixture().components[0],points:[4,1].map(led=>({led,x:99,y:99,z:0}))};
 const render=componentHarness('MatrixEditor',()=>({component,device:targetDevice,templates:[],onChange:value=>{component=value;},onSplit:()=>{},onIdentify:async()=>{},run:fn=>fn()}));
 button(render(),'Восстановить форму устройства').props.onClick();assert.deepEqual(Array.from(component.points,point=>[point.led,point.x,point.y]),[[4,0,19],[1,19,0]]);
 component={...component,points:[...component.points,{led:20,x:1,y:2,z:3}]};
 assert.equal(nodes(render()).some(node=>node.type==='Button'&&words(node)==='Восстановить форму устройства'),false);assert.equal(component.points.length,3);
});

function canvas(){
 let layout=fixture();const target=new FakeElement('port'),surface=new FakeElement();let selected='port';
 const render=componentHarness('SpatialCanvas',()=>({layout,selected,onSelect:id=>{selected=id;},onChange:next=>{layout={...layout,components:layout.components.map(c=>c.id===next.id?next:c)};},devices:[device]}));
 const svg=()=>{const node=find(render(),n=>n.type==='svg'&&n.props.className==='spatial-canvas');node.props.ref.current=surface;return node;};
 const event=x=>({clientX:x,clientY:100,pointerId:1,button:0,currentTarget:surface,target,preventDefault(){},stopPropagation(){}});
 const drag=(from,to,finish)=>{svg().props.onPointerDown(event(from));svg().props.onPointerMove(event(to));if(finish)svg().props.onPointerUp(event(to));};
 return {render,svg,drag,surface,layout:()=>layout,rename:()=>{layout={...layout,components:layout.components.map(c=>({...c,name:'Renamed during drag'}))};}};
}
for(const cancel of ['Escape','pointercancel'])test(`${cancel} preserves the previous committed undo and newer component name`,()=>{
 const h=canvas();h.drag(100,110,true);assert.equal(h.layout().components[0].pose.x,10);h.drag(110,130,false);h.rename();
 if(cancel==='pointercancel')h.svg().props.onPointerCancel();else find(h.render(),n=>n.props?.className?.startsWith('spatial-editor ')).props.onKeyDown({target:h.surface,key:'Escape',preventDefault(){},stopPropagation(){}});
 assert.equal(h.layout().components[0].pose.x,10);assert.equal(h.surface.captured.size,0);assert.equal(h.layout().components[0].name,'Renamed during drag');
 find(h.render(),n=>n.props?.['aria-label']==='Отменить последнее перемещение').props.onClick();assert.equal(h.layout().components[0].pose.x,0);assert.equal(h.layout().components[0].name,'Renamed during drag');
});
