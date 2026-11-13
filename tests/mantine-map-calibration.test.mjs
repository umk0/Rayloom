import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const transpile=file=>ts.transpileModule(readFileSync(new URL('../src/mantine/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const sessionModule={};vm.runInNewContext(transpile('visual-map-session.ts'),{exports:sessionModule,Set,Map});
const {VisualMapSession,visualMapSession,normalizeMapGradient}=sessionModule;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));
const fixture=()=>({maps:['Desk','Case'].map(name=>({name,registered:false,map:{grid_settings:{w:32,h:24,grid_size:1,show_grid:true,show_bounds:false,snap_to_grid:true,auto_load:false,auto_register:false,hide_members:false},ctrl_zones:[]}})),saved:['Saved'],gradients:['Warm','Cool'],presets:[]});
const gradient=type=>({type,spread:'Pad',rotate:40,x_offset:100,y_offset:100,colors:[{position:0,color:'#112233'},{position:1,color:'#aabbcc'}]});
async function session(){const value=new VisualMapSession();await value.request('config.get',{},async()=>fixture());return value;}
const rename=(value,index,name)=>value.editMap(index,{...value.getSnapshot().data.maps[index],name});

test('map save preserves newer edits on its own map and another selected map',async()=>{
 const s=await session();rename(s,0,'Saving desk');const job=deferred(),sent=structuredClone(s.getSnapshot().data);
 const saving=s.request('map.set',{index:0,name:sent.maps[0].name,map:sent.maps[0].map},()=>job.promise);
 rename(s,0,'Newer desk');s.select(1);rename(s,1,'Case draft');job.resolve(sent);assert.equal(await saving,true);
 assert.equal(s.getSnapshot().index,1);assert.equal(s.getSnapshot().data.maps[0].name,'Newer desk');assert.equal(s.getSnapshot().data.maps[1].name,'Case draft');assert.deepEqual([...s.getSnapshot().dirty],[0,1]);
 const second=structuredClone(s.getSnapshot().data);await s.request('map.set',{index:1,name:second.maps[1].name,map:second.maps[1].map},async()=>({...second,maps:[sent.maps[0],second.maps[1]]}));
 assert.deepEqual([...s.getSnapshot().dirty],[0]);assert.equal(s.getSnapshot().data.maps[0].name,'Newer desk');
});

test('saving a gradient never clears unrelated map drafts',async()=>{
 const s=await session();rename(s,0,'Unsaved desk');await s.request('gradient.save',{name:'Warm',gradient:gradient('Linear')},async()=>fixture());
 assert.equal(s.getSnapshot().data.maps[0].name,'Unsaved desk');assert(s.getSnapshot().dirty.has(0));
});

test('failed deletion keeps selection and synchronous guard rejects double requests',async()=>{
 const s=await session();s.select(1);const job=deferred();let calls=0;const rpc=()=>{calls++;return job.promise;};const deleting=s.request('delete',{index:1},rpc);
 assert.equal(await s.request('delete',{index:1},rpc),false);assert.equal(calls,1);assert.equal(s.getSnapshot().index,1);
 job.reject(Error('offline'));assert.equal(await deleting,false);assert.equal(s.getSnapshot().index,1);assert.equal(s.getSnapshot().busy,false);assert.match(s.getSnapshot().error,/offline/);
});

test('loading a map is blocked by unsaved maps, then selects the confirmed new map',async()=>{
 const s=await session();rename(s,1,'Draft');let calls=0;const rpc=async()=>{calls++;const data=fixture();data.maps.push({...data.maps[0],name:'Saved'});return data;};
 assert.equal(await s.request('load',{name:'Saved'},rpc),false);assert.equal(calls,0);s.resolve(1,false);
 assert.equal(await s.request('load',{name:'Saved'},rpc),true);assert.equal(s.getSnapshot().index,2);assert.equal(s.getSnapshot().data.maps[2].name,'Saved');
});

test('late gradient loads respect newer loads and manual edits',async()=>{
 const s=await session(),old=deferred(),latest=deferred();const first=s.gradient('Warm',()=>old.promise),second=s.gradient('Cool',()=>latest.promise);
 latest.resolve(gradient('Radial'));await second;old.resolve(gradient('Linear'));await first;assert.equal(s.getSnapshot().background.type,'radial');assert.equal(s.getSnapshot().gradientName,'Cool');
 const next=deferred(),loading=s.gradient('Warm',()=>next.promise);s.editBackground({...s.getSnapshot().background,angle:19});next.resolve(gradient('Conical'));await loading;
 assert.equal(s.getSnapshot().background.type,'radial');assert.equal(s.getSnapshot().background.angle,19);assert.match(s.getSnapshot().message,/Новые правки/);
});

test('late image selection preserves offsets and cannot switch back from a gradient',async()=>{
 const s=await session();s.editBackground({...s.getSnapshot().background,type:'image'});let job=deferred();let picking=s.image(()=>job.promise);
 s.editBackground({...s.getSnapshot().background,brightness:37,x:.4});job.resolve('/texture.png');await picking;
 assert.equal(s.getSnapshot().background.path,'/texture.png');assert.equal(s.getSnapshot().background.brightness,37);assert.equal(s.getSnapshot().background.x,.4);
 job=deferred();picking=s.image(()=>job.promise);s.editBackground({...s.getSnapshot().background,type:'radial'});job.resolve('/obsolete.png');await picking;
 assert.equal(s.getSnapshot().background.type,'radial');assert.equal(s.getSnapshot().background.path,'/texture.png');
});

test('invalid gradient is reported without replacing colors or emitting NaN offsets',async()=>{
 const s=await session(),before=s.getSnapshot().background;await s.gradient('Broken',async()=>({type:'Linear'}));assert.equal(s.getSnapshot().background,before);assert.match(s.getSnapshot().error,/корректный градиент/);
 const normalized=normalizeMapGradient({...gradient('Linear'),x_offset:undefined,y_offset:undefined,spread:'Unknown'});assert.equal(normalized.x,1);assert.equal(normalized.y,1);assert.equal(normalized.spread,0);
});

test('gradient load preserves a newer draft name',async()=>{
 const s=await session(),job=deferred(),loading=s.gradient('Warm',()=>job.promise);s.nameGradient('My new name');job.resolve(gradient('Linear'));await loading;
 assert.equal(s.getSnapshot().gradientName,'My new name');assert.equal(s.getSnapshot().background.angle,40);
});

test('session navigation and mode changes keep drafts separate, including a pending save',async()=>{
 const hardware=visualMapSession('test-hardware'),virtual=visualMapSession('test-virtual');await hardware.request('config.get',{},async()=>fixture());await virtual.request('config.get',{},async()=>fixture());
 rename(hardware,0,'Hardware saving');const saved=structuredClone(hardware.getSnapshot().data),job=deferred(),pending=hardware.request('map.set',{index:0,name:saved.maps[0].name,map:saved.maps[0].map},()=>job.promise);
 const unsubscribe=hardware.subscribe(()=>{});unsubscribe();const restored=visualMapSession('test-hardware');rename(restored,0,'Returned newer draft');rename(virtual,0,'Virtual draft');job.resolve(saved);await pending;
 assert.equal(restored,hardware);assert.equal(restored.getSnapshot().data.maps[0].name,'Returned newer draft');assert(restored.getSnapshot().dirty.has(0));assert.equal(virtual.getSnapshot().data.maps[0].name,'Virtual draft');
});

test('external map edits preserve the draft and require explicit conflict resolution',async()=>{
 const s=await session();rename(s,0,'My draft');const external=fixture();external.maps[0].map.grid_settings.w=40;await s.request('config.get',{},async()=>external);
 assert(s.getSnapshot().conflicts.has(0));assert.equal(s.getSnapshot().data.maps[0].name,'My draft');let writes=0;
 assert.equal(await s.request('map.set',{index:0,name:'My draft'},async()=>{writes++;return external;}),false);assert.equal(writes,0);
 s.resolve(0,false);assert.equal(s.getSnapshot().data.maps[0].map.grid_settings.w,40);assert.equal(s.getSnapshot().dirty.size,0);
});

test('same-count native delete/add cannot authorize a draft overwrite of the replacement map',async()=>{
 const s=await session();rename(s,1,'Case draft');const changed=fixture();changed.maps=[changed.maps[1],{...changed.maps[0],name:'New'}];await s.request('config.get',{},async()=>changed);
 assert(s.getSnapshot().structureConflict);assert.equal(s.getSnapshot().data.maps[1].name,'Case draft');s.resolve(1,true);
 let writes=0;assert.equal(await s.request('map.set',{index:1,name:'Case draft'},async()=>{writes++;return changed;}),false);assert.equal(writes,0);
 s.discardMapDrafts();assert.equal(s.getSnapshot().data.maps[1].name,'New');assert.equal(s.getSnapshot().dirty.size,0);
});

test('external map deletion never retargets a retained draft to a different native index',async()=>{
 const s=await session();rename(s,1,'Case draft');const changed=fixture();changed.maps.shift();await s.request('config.get',{},async()=>changed);
 assert(s.getSnapshot().structureConflict);assert.equal(s.getSnapshot().data.maps[1].name,'Case draft');let writes=0;
 assert.equal(await s.request('map.set',{index:1,name:'Case draft'},async()=>{writes++;return changed;}),false);assert.equal(writes,0);s.resolve(1,true);assert(s.getSnapshot().structureConflict);
 s.discardMapDrafts();assert.equal(s.getSnapshot().structureConflict,false);assert.equal(s.getSnapshot().data.maps.length,1);assert.equal(s.getSnapshot().data.maps[0].name,'Case');
});

test('an unconfirmed save response retains the map and its dirty state',async()=>{
 const s=await session();rename(s,0,'Still a draft');assert.equal(await s.request('map.set',{index:0,name:'Still a draft'},async()=>null),false);
 assert.equal(s.getSnapshot().data.maps[0].name,'Still a draft');assert(s.getSnapshot().dirty.has(0));assert.match(s.getSnapshot().error,/не подтвердил/);
 assert.equal(await s.request('map.set',{index:0,name:'Still a draft'},async()=>fixture()),false);assert(s.getSnapshot().dirty.has(0));
});

// Real TSX handlers, with only React hooks/JSX/IPC replaced. No DOM, window,
// native focus, physical device, screenshot or Electron acceptance is implied.
function harness(name,props,bridge={}){
 const slots=[];let cursor=0,effects=[],changed=false;const cleanups=[],timers=new Set();
 const hooks={
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i]))changed=true;slots[i]=next;}];},
  useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useMemo:(fn,deps)=>{const i=cursor++,previous=slots[i];if(!previous||deps.some((value,j)=>value!==previous.deps[j]))slots[i]={value:fn(),deps};return slots[i].value;},
  useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),
  useEffect:(fn,deps)=>{const i=cursor++,previous=slots[i];if(!previous||!deps||deps.some((value,j)=>value!==previous.deps[j])){slots[i]={deps};effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}
 };
 const jsx=(type,props)=>({type,props}),ui=new Proxy({Tabs:{List:'Tabs.List',Tab:'Tabs.Tab'},Accordion:{Item:'Accordion.Item',Control:'Accordion.Control',Panel:'Accordion.Panel'},ScrollArea:{Autosize:'ScrollArea.Autosize'}},{get:(target,key)=>target[key]??String(key)});
 const modules={'react':hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'@mantine/core':ui,'lucide-react':new Proxy({},{get:(_,key)=>String(key)}),'./StudioControls':new Proxy({},{get:(_,key)=>String(key)}),'./MatrixEditor':{MatrixEditor:'MatrixEditor'},'./CalibrationWizard':{CalibrationWizard:'CalibrationWizard'},'./visual-map-session':sessionModule,'../types':{hex:n=>'#'+n.toString(16).padStart(6,'0'),rgb:value=>parseInt(value.slice(1),16)},'./spatial.css':{}};
 const exports={};vm.runInNewContext(transpile(name+'.tsx'),{exports,require:key=>{if(!(key in modules))throw Error('Unexpected import '+key);return modules[key];},window:{rayloom:bridge},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),document:{activeElement:null},console});
 const render=()=>{let tree,iteration=0;do{cursor=0;effects=[];changed=false;tree=exports[name](props());effects.forEach(effect=>effect());}while(changed&&++iteration<8);assert(iteration<8);return tree;};render.unmount=()=>cleanups.forEach(fn=>fn?.());render.tick=()=>timers.forEach(fn=>fn());return render;
}
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const words=tree=>tree==null||typeof tree==='boolean'?'':Array.isArray(tree)?tree.map(words).join(''):typeof tree!=='object'?String(tree):words(tree.props?.children);
const find=(tree,predicate)=>{const value=nodes(tree).find(predicate);assert(value,'control exists');return value;};
const button=(tree,label)=>find(tree,node=>node.type==='Button'&&(words(node)===label||node.props['aria-label']===label));

test('map component handlers keep the target draft while selection changes during save',async()=>{
 const scope='component-map',job=deferred(),requests=[];const render=harness('VisualMapPanel',()=>({devices:[],notify:()=>{},draftScope:scope}),{plugin:async(_plugin,method,args)=>{requests.push({method,args});return method==='map.set'?job.promise:fixture();}});
 render();await settle();find(render(),n=>n.props?.['aria-label']==='Название карты').props.onChange({currentTarget:{value:'Desk draft'}});
 button(render(),'Применить и сохранить').props.onClick();const response=structuredClone(visualMapSession(scope).getSnapshot().data);
 find(render(),n=>n.props?.className==='map-tabs').props.onChange('1');find(render(),n=>n.props?.['aria-label']==='Название карты').props.onChange({currentTarget:{value:'Case draft'}});
 job.resolve(response);await settle();assert.equal(find(render(),n=>n.props?.['aria-label']==='Название карты').props.value,'Case draft');assert.equal(requests.at(-1).args.index,0);
 assert.equal(find(render(),n=>n.props?.ariaLabel==='Загрузить карту').props.disabled,true);render.unmount();
});

test('initial map load failure exposes a working retry instead of trapping the editor',async()=>{
 let calls=0;const render=harness('VisualMapPanel',()=>({devices:[],notify:()=>{},draftScope:'retry-map'}),{plugin:async()=>{if(!calls++)throw Error('offline');return fixture();}});
 render();await settle();button(render(),'Повторить загрузку').props.onClick();await settle();assert.equal(calls,2);assert.equal(find(render(),n=>n.props?.['aria-label']==='Название карты').props.value,'Desk');render.unmount();
});

const component={id:'front',name:'Front',device:{name:'Board'},zone:0,enabled:true,points:[{led:0,x:0,y:0,z:0}],pose:{x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1}};
const layout={components:[component],groups:[{id:'all',name:'All',members:[]}],scenes:[]};
const calibration=phase=>({session:'test-session',component:'front',name:'Front',phase,step:phase==='review'?3:0,channelOrder:phase==='review'?'GRB':null,answers:[],expiresAt:9999});

test('changing the selected port closes its wizard; an old close cannot dismiss a new one',()=>{
 let selected=component;const render=harness('PortInspector',()=>({component:selected,layout,device:{zones:[]},onCalibrationApplied:()=>{},onChange:()=>{},onSplit:()=>{},onBack:()=>{},onIdentify:async()=>{},onSaveTemplate:async()=>{},templates:[],run:async()=>{},busy:false}));
 button(render(),'Калибровать цвета').props.onClick();const old=find(render(),n=>n.type==='CalibrationWizard');selected={...component,id:'back',name:'Back'};
 assert(!nodes(render()).some(n=>n.type==='CalibrationWizard'));button(render(),'Калибровать цвета').props.onClick();old.props.onClose();assert.equal(find(render(),n=>n.type==='CalibrationWizard').props.component.id,'back');render.unmount();
});

test('late calibration begin after unmount cancels its actual returned session',async()=>{
 const job=deferred(),calls=[];const render=harness('CalibrationWizard',()=>({component,layout,onClose:()=>{},onApplied:()=>{}}),{studio:async(method,args)=>{calls.push({method,args});return method==='calibration.begin'?job.promise:{};}});
 button(render(),'Начать проверку').props.onClick();render.unmount();job.resolve(calibration('question'));await settle();
 assert.equal(calls.at(-1).method,'calibration.cancel');assert.equal(calls.at(-1).args.session,'test-session');
});

for(const failure of [false,true])test(`late calibration heartbeat ${failure?'error':'step 0'} cannot replace the completed next question`,async()=>{
 const poll=deferred();const render=harness('CalibrationWizard',()=>({component,layout,onClose:()=>{},onApplied:()=>{}}),{studio:async method=>method==='calibration.begin'?calibration('question'):method==='calibration.state'?poll.promise:method==='calibration.step'?{...calibration('question'),step:1,answers:['R']}:null});
 button(render(),'Начать проверку').props.onClick();await settle();render.tick();button(render(),'Красный').props.onClick();await settle();
 if(failure)poll.reject(Error('obsolete heartbeat error'));else poll.resolve(calibration('question'));await settle();
 assert.match(words(render()),/Вопрос 2 из 3/);assert.doesNotMatch(words(render()),/obsolete heartbeat error/);render.unmount();
});

test('calibration close finishing after unmount cannot close the new selection',async()=>{
 const cancellation=deferred();let closes=0;const render=harness('CalibrationWizard',()=>({component,layout,onClose:()=>{closes++;},onApplied:()=>{}}),{studio:async method=>method==='calibration.begin'?calibration('question'):cancellation.promise});
 button(render(),'Начать проверку').props.onClick();await settle();button(render(),'Отменить и вернуть подсветку').props.onClick();render.unmount();cancellation.resolve({});await settle();assert.equal(closes,0);
});

test('calibration apply requires a confirmed saved component before publishing success',async()=>{
 let applied=0,closed=0;const render=harness('CalibrationWizard',()=>({component,layout,onClose:()=>{closed++;},onApplied:()=>{applied++;}}),{studio:async method=>method==='calibration.begin'?calibration('review'):{layout:{...layout,components:[]}}});
 button(render(),'Начать проверку').props.onClick();await settle();button(render(),'Да, сохранить').props.onClick();await settle();assert.equal(applied,0);assert.equal(closed,0);assert.match(words(render()),/не подтвердил сохранение/);render.unmount();
});

test('a confirmed calibration save after unmount updates the shared layout without closing another wizard',async()=>{
 const job=deferred(),applied=[];let closed=0;const render=harness('CalibrationWizard',()=>({component,layout,onClose:()=>{closed++;},onApplied:(...args)=>applied.push(args)}),{studio:async method=>method==='calibration.begin'?calibration('review'):method==='calibration.apply'?job.promise:{}});
 button(render(),'Начать проверку').props.onClick();await settle();button(render(),'Да, сохранить').props.onClick();render.unmount();const saved={...layout,components:[{...component,calibration:{channelOrder:'GRB',brightness:100}}]};job.resolve({layout:saved});await settle();assert.equal(applied.length,1);assert.deepEqual(plain(applied[0][0]),saved);assert.equal(applied[0][1],layout);assert.equal(closed,0);
});
