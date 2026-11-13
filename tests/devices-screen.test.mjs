import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as spatial from '../shared/spatial.mjs';
import * as availability from '../shared/device-visibility.mjs';
import * as ports from '../shared/device-port-groups.mjs';

const source=ts.transpileModule(readFileSync(new URL('../src/mantine/DevicesScreen.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const words=tree=>tree==null||typeof tree==='boolean'?'':Array.isArray(tree)?tree.map(words).join(''):typeof tree!=='object'?String(tree):words(tree.props?.children);
const find=(tree,predicate)=>{const value=nodes(tree).find(predicate);assert(value,'Control exists');return value;};
const button=(tree,label)=>find(tree,node=>node.type==='Button'&&(words(node)===label||node.props['aria-label']===label));
const cards=tree=>nodes(tree).filter(node=>node.props?.className==='ray-port-card');
const previews=tree=>nodes(tree).filter(node=>node.type==='DeviceLayoutPreview');
const accordion=tree=>find(tree,node=>node.props?.className==='ray-device-list');

function device(serial='board-1'){
 const sizes=[2,4,3,1,5],names=['Встроенная подсветка','ARGB 1','ARGB 2','RGB Header','ARGB 3'];let start=0;
 const zones=sizes.map((ledCount,index)=>{const zone={index,name:names[index],type:index===0||index===3?0:1,ledCount,startIndex:start};start+=ledCount;return zone;});
 return {index:0,name:'Board',vendor:'Test',serial,location:'USB:'+serial,description:'',version:'',zoneCount:5,ledCount:start,colors:Array.from({length:start},(_,i)=>i*100),zones};
}
const components=hardware=>hardware.zones.map(zone=>({id:spatial.deviceKey(hardware)+'/zone/'+zone.index,name:'Component '+zone.index,device:spatial.identity(hardware),deviceKey:spatial.deviceKey(hardware),zone:zone.index,enabled:true,source:'OpenRGB LED order',pose:{x:zone.index*120,y:0,z:0,rx:0,ry:0,rz:0,scale:1},points:Array.from({length:zone.ledCount},(_,i)=>({led:zone.startIndex+i,x:Math.cos(i)*20,y:Math.sin(i)*20,z:0}))}));

// Expands the actual stateless PortCard function, leaving only Mantine,
// icon and preview boundary stubs. No DOM, Electron or hardware is started.
const expand=tree=>{
 if(!tree||typeof tree!=='object')return tree;
 if(Array.isArray(tree))return tree.map(expand);
 if(typeof tree.type==='function')return expand(tree.type(tree.props));
 return {...tree,props:{...tree.props,children:expand(tree.props?.children)}};
};
function harness({hardware=device(),catalog=async()=>({devices:[],layouts:[]})}={}){
 const calls={inspect:[],layout:[],identify:[],run:[],toggle:[],groups:0,save:0,studio:[]},tasks=[];
 let cursor=0,changed=false,effects=[],unmounted=false,lateWrites=0;const slots=[];
 const s={devices:[hardware],rememberedDevices:[],liveDevices:new Map([[spatial.deviceKey(hardware),hardware]]),layout:{version:1,components:components(hardware),groups:[{id:'all',name:'All',members:[]}],scenes:[]},ready:true,busy:false,dirty:false,state:{mode:'hardware'}};
 s.alias=hardware=>s.layout.deviceAliases?.[spatial.deviceKey(hardware)]??hardware.name;
 s.edit=layout=>{s.layout=layout;s.dirty=true;};
 s.identify=async id=>{calls.identify.push(id);};s.toggleDevice=async(...args)=>{calls.toggle.push(args);};s.save=async()=>{calls.save++;};
 s.run=(fn,message)=>{calls.run.push(message);const task=Promise.resolve().then(fn);tasks.push(task);return task;};
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{if(unmounted)lateWrites++;const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i]))changed=true;slots[i]=next;}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:effect()};});}
 };
 const ui=new Proxy({Accordion:{Item:'Accordion.Item',Control:'Accordion.Control',Panel:'Accordion.Panel'},ScrollArea:{Autosize:'ScrollArea.Autosize'}},{get:(target,key)=>target[key]??String(key)}),jsx=(type,props)=>({type,props});
  const modules={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'@mantine/core':ui,'lucide-react':ui,'../../shared/spatial.mjs':spatial,'../../shared/device-visibility.mjs':availability,'../../shared/device-port-groups.mjs':ports,'./StudioControls':{RayloomDisclosure:'RayloomDisclosure',RayloomSwitch:'RayloomSwitch'},'./DeviceLayoutPreview':{DeviceLayoutPreview:'DeviceLayoutPreview'},'./devices.css':{}};
 const exports={};vm.runInNewContext(source,{exports,require:name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},Set,Map,console,window:{rayloom:{studio:async(method,args)=>{calls.studio.push({method,args});return method==='catalog'?catalog():{};}}}});
 const render=()=>{let tree,count=0;do{cursor=0;changed=false;effects=[];tree=expand(exports.DevicesScreen({s,onGroups:()=>{calls.groups++;},onInspect:id=>calls.inspect.push(id),onLayout:id=>calls.layout.push(id)}));effects.splice(0).forEach(effect=>effect());}while(changed&&++count<10);assert(count<10,'effects converge');return tree;};
 const setDevices=(devices,remembered=[])=>{s.devices=devices;s.rememberedDevices=remembered;s.liveDevices=new Map(devices.map(value=>[spatial.deviceKey(value),value]));};
 return {s,calls,tasks,render,setDevices,lateWrites:()=>lateWrites,unmount:()=>{slots.forEach(slot=>slot?.cleanup?.());unmounted=true;}};
}

test('a five-zone controller renders five independent cards and forwards exact per-component preview data',()=>{
 const hardware=device(),h=harness({hardware}),before=plain(h.s.layout),tree=h.render(),groups=cards(tree);
 assert.equal(groups.length,5);assert.deepEqual(groups.map(card=>card.props['data-port-zone']),[0,1,2,3,4]);
 for(let i=0;i<groups.length;i++){
  const preview=previews(groups[i]);assert.equal(preview.length,1);assert.equal(preview[0].props.component,h.s.layout.components[i]);assert.equal(preview[0].props.device,hardware);assert.equal(preview[0].props.available,true);
  assert.equal(groups[i].props['aria-label'],'Зона подсветки '+hardware.zones[i].name);
 }
 assert.deepEqual(plain(h.s.layout),before);assert.match(words(tree),/5 зон подсветки/);assert.doesNotMatch(words(tree),/OpenRGB/);
});

test('split components share one zone card while retaining separate layouts and original component order',()=>{
 const h=harness(),original=h.s.layout.components[1],lower={...original,id:'lower-fan',name:'Lower fan',points:original.points.slice(2)},upper={...original,id:'upper-fan',name:'Upper fan',points:original.points.slice(0,2)};
 h.s.layout={...h.s.layout,components:[...h.s.layout.components.filter(component=>component.id!==original.id),lower,upper]};
 const tree=h.render(),group=cards(tree).find(card=>card.props['data-port-zone']===1);
 assert.equal(cards(tree).length,5);assert.equal(previews(tree).length,6);assert.deepEqual(previews(group).map(preview=>preview.props.component.id),['lower-fan','upper-fan']);
 assert.equal(previews(group)[0].props.component,lower);assert.equal(previews(group)[1].props.component,upper);assert.match(words(group),/2 компонента/);
});

test('each zone action targets its selected component id, never its controller or a neighbour',async()=>{
 const h=harness(),tree=h.render();for(const component of h.s.layout.components){
  button(tree,'Макет порта '+component.name).props.onClick();button(tree,'Настроить порт '+component.name).props.onClick();button(tree,'Подсветить порт '+component.name).props.onClick();
 }
 await Promise.all(h.tasks);const ids=h.s.layout.components.map(component=>component.id);
 assert.deepEqual(h.calls.layout,ids);assert.deepEqual(h.calls.inspect,ids);assert.deepEqual(h.calls.identify,ids);assert.equal(h.calls.toggle.length,0);assert.equal(h.calls.studio.length,0);
});

test('offline-only controllers keep their remembered zone layouts and never show no devices found',()=>{
 const h=harness(),hardware=h.s.devices[0],remembered={...spatial.identity(hardware),index:-1,ledCount:0,colors:[],zoneCount:0};h.setDevices([],[remembered]);
 const tree=h.render();assert.equal(cards(tree).length,5);assert.equal(previews(tree).length,5);assert.doesNotMatch(words(tree),/Устройства пока не найдены|Ищем оборудование/);
 for(const preview of previews(tree)){assert.equal(preview.props.device,undefined);assert.equal(preview.props.available,false);assert.equal(button(tree,'Подсветить порт '+preview.props.component.name).props.disabled,true);assert.equal(button(tree,'Макет порта '+preview.props.component.name).props.disabled,false);}
 assert.match(words(tree),/Не подключено/);assert.match(words(tree),/макеты и настройки сохранены/);
});

test('disabled components retain their geometry and pass enabled=false to the preview',()=>{
 const h=harness();h.s.layout.components[2]={...h.s.layout.components[2],enabled:false};const tree=h.render(),part=h.s.layout.components[2],preview=previews(tree).find(value=>value.props.component.id===part.id);
 assert.equal(preview.props.component,part);assert.equal(preview.props.component.enabled,false);assert.equal(preview.props.available,true);assert.match(words(cards(tree)[2]),/Исключён из сцены/);
 assert.equal(button(tree,'Макет порта '+part.name).props.disabled,false);
});

test('a resized or stale zone cannot borrow neighbouring LED colors or enable identification',()=>{
 const h=harness(),hardware=h.s.devices[0],shifted={...hardware,zones:hardware.zones.map(zone=>zone.index===1?{...zone,startIndex:10}:zone)};h.setDevices([shifted]);
 const tree=h.render(),part=h.s.layout.components[1],preview=previews(tree).find(value=>value.props.component.id===part.id);
 assert.equal(preview.props.device,shifted);assert.equal(preview.props.available,false);assert.equal(button(tree,'Подсветить порт '+part.name).props.disabled,true);assert.match(words(cards(tree)[1]),/Порт изменился/);
 assert.equal(previews(tree).find(value=>value.props.component.zone===0).props.available,true);
});

test('busy state disables identify/layout writes and empty components cannot be lit or given a layout',()=>{
 const h=harness();h.s.busy=true;let tree=h.render();for(const part of h.s.layout.components){assert.equal(button(tree,'Макет порта '+part.name).props.disabled,true);assert.equal(button(tree,'Подсветить порт '+part.name).props.disabled,true);}
 h.s.busy=false;h.s.layout.components[0]={...h.s.layout.components[0],points:[]};tree=h.render();const part=h.s.layout.components[0];
 assert.equal(button(tree,'Макет порта '+part.name).props.disabled,true);assert.equal(button(tree,'Подсветить порт '+part.name).props.disabled,true);
});

test('user collapse persists across device polling; each newly discovered controller opens once',()=>{
 const h=harness(),first=h.s.devices[0],firstKey=spatial.deviceKey(first),second=device('board-2'),secondKey=spatial.deviceKey(second);
 assert.deepEqual(plain(accordion(h.render()).props.value),[firstKey]);accordion(h.render()).props.onChange([]);assert.deepEqual(plain(accordion(h.render()).props.value),[]);
 h.setDevices([{...first,colors:first.colors.map(value=>value+1)}]);assert.deepEqual(plain(accordion(h.render()).props.value),[]);
 h.setDevices([first,second]);assert.deepEqual(plain(accordion(h.render()).props.value),[secondKey]);accordion(h.render()).props.onChange([]);
 h.setDevices([first,{...second}]);assert.deepEqual(plain(accordion(h.render()).props.value),[]);h.setDevices([first]);h.render();h.setDevices([first,second]);assert.deepEqual(plain(accordion(h.render()).props.value),[]);
});

test('online to remembered transition preserves a collapsed controller without hiding its saved zone cards',()=>{
 const h=harness(),first=h.s.devices[0];accordion(h.render()).props.onChange([]);h.render();h.setDevices([],[{...spatial.identity(first),index:-1,ledCount:0,colors:[],zoneCount:0}]);
 const tree=h.render();assert.deepEqual(plain(accordion(tree).props.value),[]);assert.equal(cards(tree).length,5);assert.doesNotMatch(words(tree),/Устройства пока не найдены/);
});

test('sparse native indices and an unconfigured zone remain separate from saved stale components',()=>{
 const hardware=device(),h=harness({hardware});h.s.layout.components=[h.s.layout.components[1]];h.setDevices([{...hardware,zoneCount:2,zones:[{index:3,name:'Logo',startIndex:9,ledCount:1},{index:9,name:'New zone'}]}]);
 const tree=h.render();assert.deepEqual(cards(tree).map(card=>card.props['data-port-zone']),[1,3,9]);assert.equal(previews(tree).length,1);assert.equal(previews(tree)[0].props.available,false);
 const unknown=cards(tree).find(card=>card.props['data-port-zone']===9);assert.match(words(unknown),/Число LED появится после определения устройства/);assert.equal(previews(unknown).length,0);
});

test('actual empty state is displayed only when neither live nor remembered devices exist',()=>{
 const h=harness();h.setDevices([]);h.s.layout.components=[];assert.match(words(h.render()),/Устройства пока не найдены/);h.s.ready=false;assert.match(words(h.render()),/Ищем оборудование/);
});

test('late catalog lookup after unmount does not update the disposed devices screen',async()=>{
 const job=deferred(),h=harness({catalog:()=>job.promise});find(h.render(),node=>node.type==='RayloomDisclosure'&&node.props.title==='Каталог совместимых устройств').props.onExpandedChange(true);
 await tick();h.unmount();job.resolve({devices:[{Name:'Known device'}],layouts:[]});await Promise.all(h.tasks);assert.equal(h.lateWrites(),0);assert.equal(h.calls.studio.length,1);assert.equal(h.calls.studio[0].method,'catalog');
});
