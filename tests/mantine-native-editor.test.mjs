import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from '../shared/advanced-draft.mjs';
import * as editorState from '../shared/advanced-editor-state.mjs';

const compile=name=>ts.transpileModule(readFileSync(new URL(`../src/mantine/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const sources={NativeSceneEditor:compile('NativeSceneEditor'),EffectEditor:compile('EffectEditor')};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Storage {data=new Map();getItem(key){return this.data.get(key)??null;}setItem(key,value){this.data.set(key,value);}removeItem(key){this.data.delete(key);}}
const effect=(name='First')=>({EffectClassName:'Wave',CustomName:name,FPS:60,Speed:2,Slider2Val:0,Brightness:70,Temperature:0,Tint:0,RandomColors:false,AllowOnlyFirst:false,AutoStart:false,SelectAll:false,UserColors:[255],CustomSettings:{},ControllerZones:[]});
const scene=(...names)=>({version:2,Effects:names.map(effect)});
const catalog=[{id:'Wave',name:'Wave',description:'Test',category:'Test',speedMin:0,speedMax:10,secondaryMin:0,secondaryMax:0,colorCount:1,fields:[],defaults:effect()}];
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const text=tree=>tree==null||typeof tree==='boolean'?'':Array.isArray(tree)?tree.map(text).join(''):typeof tree!=='object'?String(tree):text(tree.props?.children);
const find=(tree,match)=>{const found=nodes(tree).find(match);assert(found,'Requested control exists');return found;};
const button=(tree,label)=>find(tree,n=>['Button','ActionIcon'].includes(n.type)&&(n.props['aria-label']===label||text(n)===label));

// Runs the actual component handlers and effect cleanup with deferred fake IPC.
// No React DOM, Electron process, browser, device or computer-use surface runs.
function harness(file,ipc,{storage=new Storage(),props={onBack:()=>{}}}={}){
  const slots=[],timers=new Map();let cursor=0,changed=false,effects=[],afterUnmount=0,unmounted=false,timerId=0;
  const hooks={
    useRef:value=>{const index=cursor++;return slots[index]??(slots[index]={current:value});},
    useState:value=>{const index=cursor++;if(!(index in slots))slots[index]=typeof value==='function'?value():value;return [slots[index],next=>{if(unmounted)afterUnmount++;const result=typeof next==='function'?next(slots[index]):next;if(!Object.is(result,slots[index]))changed=true;slots[index]=result;}];},
    useEffect:(fn,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((d,i)=>d!==previous.deps[i])){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}},
  };
  const jsx=(type,props)=>({type,props}),components=new Proxy({Tabs:{List:'Tabs.List',Tab:'Tabs.Tab'}},{get:(target,key)=>target[key]??key});
  const modules={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'@mantine/core':components,'lucide-react':components,
    '../../shared/advanced-draft.mjs':drafts,'../../shared/advanced-editor-state.mjs':editorState,
    '../types':{clone:structuredClone,hex:value=>'#'+value.toString(16),zone:()=>({})},
    './EffectEditor':{EffectEditor:'EffectEditor',Fields:'Fields',Numeric:'Numeric'},'./EffectLibrary':{EffectLibrary:'EffectLibrary'},
    './StudioControls':{RayloomDisclosure:'RayloomDisclosure',RayloomSelect:'RayloomSelect',RayloomSwitch:'RayloomSwitch',RayloomColorInput:'RayloomColorInput',NumericInput:'NumericInput'},
    './PluginPanels':{PluginPanel:'PluginPanel'},'./VisualMapPanel':{VisualMapPanel:'VisualMapPanel'},'./ScreenRegion':{ScreenRegion:'ScreenRegion'},
  };
  const exports={};
  vm.runInNewContext(sources[file],{exports,require:name=>{assert(name in modules,'Known module '+name);return modules[name];},localStorage:storage,sessionStorage:new Storage(),window:{rayloom:ipc},document:{hidden:false},setInterval:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),console,structuredClone,Map,Set});
  let target=exports[file],targetProps=()=>props;
  const render=()=>{let tree,count=0;do{cursor=0;changed=false;effects=[];tree=target(targetProps());for(const fn of effects)fn();}while(changed&&++count<10);assert(count<10,'Component effects converge');return tree;};
  return {exports,storage,render,setTarget:(fn,getProps)=>{slots.length=0;target=fn;targetProps=getProps;},poll:()=>[...timers.values()][0]?.(),settle:async()=>{for(let i=0;i<4;i++){await tick();if(!unmounted)render();}},unmount:()=>{for(const slot of slots)slot?.cleanup?.();unmounted=true;},updatesAfterUnmount:()=>afterUnmount};
}

async function native(initial=scene('Draft'),{dirty=true}={}){
  const storage=new Storage(),pending=new Map(),calls=[];
  if(dirty)storage.setItem(drafts.advancedDraftKey('hardware'),JSON.stringify(initial));
  let live=structuredClone(initial);
  const globals={fields:[{key:'fps',label:'FPS',type:'number'}],value:{fps:60}};
  const call=async(domain,method,args)=>{
    calls.push({domain,method,args});const key=domain+':'+method;
    if(pending.has(key)){const job=pending.get(key);pending.delete(key);return job.promise;}
    if(domain==='effects'){
      if(method==='catalog')return catalog;if(method==='blendModes')return [];if(method==='globals.get')return structuredClone(globals);
      if(method==='scene.get')return structuredClone(live);if(method==='scene.apply'){live=structuredClone(args.profile);live.Effects.forEach(e=>e.AutoStart=true);return structuredClone(live);}
      if(method==='globals.set')return {...globals,value:args.settings};if(method==='start'||method==='stop')return null;
    }
    if(domain==='scenes'){if(method==='list')return args?.kind==='preset'?['Warm']:['Saved'];if(method==='load')return args?.kind==='preset'?effect('Preset'):scene('Loaded');if(['save','delete','export','import'].includes(method))return null;}
    throw Error('Unexpected fake IPC '+key);
  };
  const h=harness('NativeSceneEditor',{snapshot:async()=>({mode:'hardware',status:{virtual:false},devices:[],plugins:[]}),effects:(m,a)=>call('effects',m,a),scenes:(m,a)=>call('scenes',m,a)}, {storage});
  h.render();await h.settle();h.poll();await h.settle();
  // Mantine Tabs is an object stub; its list's aria-label disambiguates the two controls.
  const tabs=label=>find(h.render(),n=>n.props?.onChange&&nodes(n.props.children).some(child=>child.props?.['aria-label']===label));
  return {...h,calls,delay:(domain,method)=>{const job=deferred();pending.set(domain+':'+method,job);return job;},tab:name=>tabs('Разделы редактора сцены').props.onChange(name),select:value=>tabs('Эффекты текущей сцены').props.onChange(value),editor:()=>find(h.render(),n=>n.type==='EffectEditor'),open:()=>button(h.render(),'Открыть сцену Saved').props.onClick(),confirm:()=>button(h.render(),'Заменить сцену').props.onClick()};
}

test('a poll started before Apply cannot restore the previous live scene afterwards',async()=>{
  const h=await native();const old=h.delay('effects','scene.get');h.poll();await tick();
  button(h.render(),'Применить изменения').props.onClick();await h.settle();
  assert.equal(h.editor().props.value.AutoStart,true);
  old.resolve(scene('Old remote'));await h.settle();
  assert.equal(h.editor().props.value.CustomName,'Draft');assert.equal(h.editor().props.value.AutoStart,true);
});

test('Apply acknowledgement preserves edits made while the native engine was responding',async()=>{
  const h=await native(),apply=h.delay('effects','scene.apply');button(h.render(),'Применить изменения').props.onClick();
  const editor=h.editor();editor.props.onChange({...editor.props.value,Speed:9});apply.resolve({...scene('Draft'),Effects:[{...effect('Draft'),AutoStart:true}]});await h.settle();
  assert.equal(h.editor().props.value.Speed,9);assert.match(text(h.render()),/Новые правки остаются/);
  assert.equal(JSON.parse(h.storage.getItem(drafts.advancedDraftKey('hardware'))).Effects[0].Speed,9);
});

test('external live scene changes invalidate pending field reads even when their own field is unchanged',async()=>{
  const h=await native(scene('Live'),{dirty:false});h.select('0');const unchanged=h.editor().props.context.capture(),poll=h.delay('effects','scene.get');h.poll();await tick();
  poll.resolve({version:2,Effects:[{...effect('Live'),Brightness:25}]});await h.settle();assert.equal(h.editor().props.value.Brightness,25);assert.equal(unchanged(),false);
});

test('opening a saved scene requires an explicit decision and keeps a recoverable previous draft',async()=>{
  const h=await native();h.tab('scenes');h.open();
  assert.equal(find(h.render(),n=>n.type==='Modal').props.opened,true);assert.equal(h.calls.filter(c=>c.method==='load').length,0);
  button(h.render(),'Остаться').props.onClick();assert.equal(h.storage.getItem(editorState.replacementDraftKey('hardware')),null);
  h.open();h.confirm();await h.settle();
  assert.equal(h.editor().props.value.CustomName,'Loaded');assert.equal(editorState.readReplacedDraft(h.storage,'hardware').scene.Effects[0].CustomName,'Draft');
  button(h.render(),'Восстановить предыдущий').props.onClick();h.confirm();await h.settle();assert.equal(h.editor().props.value.CustomName,'Draft');
});

test('late scene loading preserves newer edits and does not pull the user back to another tab',async()=>{
  const h=await native(),load=h.delay('scenes','load');h.tab('scenes');h.open();h.confirm();
  h.tab('effects');const editor=h.editor();editor.props.onChange({...editor.props.value,CustomName:'New local'});h.tab('settings');
  load.resolve(scene('Loaded'));await h.settle();assert(find(h.render(),n=>n.type==='Fields'));assert.match(text(h.render()),/Сцена не заменена/);
  h.tab('effects');assert.equal(h.editor().props.value.CustomName,'New local');
});

test('a cancelled import keeps the current draft and creates no replacement backup',async()=>{
  const h=await native();h.tab('scenes');button(h.render(),'Импортировать').props.onClick();h.confirm();await h.settle();
  assert.equal(h.storage.getItem(editorState.replacementDraftKey('hardware')),null);h.tab('effects');assert.equal(h.editor().props.value.CustomName,'Draft');
});

test('failed replacement backup aborts scene replacement without deleting current work',async()=>{
  const h=await native(),set=h.storage.setItem.bind(h.storage);
  h.storage.setItem=(key,value)=>{if(key.startsWith(editorState.replacementDraftKey('hardware')))throw Error('quota');set(key,value);};
  h.tab('scenes');h.open();h.confirm();await h.settle();assert.match(text(h.render()),/quota/);
  h.tab('effects');assert.equal(h.editor().props.value.CustomName,'Draft');assert.equal(JSON.parse(h.storage.getItem(drafts.advancedDraftKey('hardware'))).Effects[0].CustomName,'Draft');
});

test('late presets cannot overwrite the next effect after deleting their original target',async()=>{
  const h=await native(scene('First','Second')),load=h.delay('scenes','load');
  find(h.render(),n=>n.type==='RayloomSelect'&&n.props.ariaLabel==='Загрузить пресет').props.onChange('Warm');button(h.render(),'Удалить из сцены').props.onClick();
  load.resolve(effect('Preset'));await h.settle();assert.equal(h.editor().props.value.CustomName,'Second');assert.match(text(h.render()),/Пресет не загружен/);
});

test('a changed effect selection invalidates a pending preset even without a field edit',async()=>{
  const h=await native(scene('First','Second')),load=h.delay('scenes','load');
  find(h.render(),n=>n.type==='RayloomSelect'&&n.props.ariaLabel==='Загрузить пресет').props.onChange('Warm');h.select('1');
  load.resolve(effect('Preset'));await h.settle();h.select('0');assert.equal(h.editor().props.value.CustomName,'First');
});

test('saving new-effect defaults cannot replace a more recent field edit',async()=>{
  const h=await native(),save=h.delay('effects','globals.set');h.tab('settings');button(h.render(),'Сохранить настройки').props.onClick();
  find(h.render(),n=>n.type==='Fields').props.onChange({fps:90});save.resolve({fields:[],value:{fps:60}});await h.settle();
  assert.equal(find(h.render(),n=>n.type==='Fields').props.value.fps,90);assert.match(text(h.render()),/Более новые правки/);
});

test('scene reads that finish after unmount do not write state or replace persisted drafts',async()=>{
  const h=await native(),load=h.delay('scenes','load');h.tab('scenes');h.open();h.confirm();h.unmount();load.resolve(scene('Loaded'));await h.settle();
  assert.equal(h.updatesAfterUnmount(),0);assert.equal(JSON.parse(h.storage.getItem(drafts.advancedDraftKey('hardware'))).Effects[0].CustomName,'Draft');
});

test('native scene limits are enforced before a draft becomes impossible to apply',async()=>{
  const h=await native(scene(...Array.from({length:64},(_,i)=>'Effect '+i)));assert.equal(button(h.render(),'Дублировать').props.disabled,true);
  h.select('library');find(h.render(),n=>n.type==='EffectLibrary').props.onChange('openrgb:Wave');await h.settle();
  assert.equal(JSON.parse(h.storage.getItem(drafts.advancedDraftKey('hardware'))).Effects.length,64);assert.match(text(h.render()),/до 64 эффектов/);
});

test('a late file picker preserves subsequent text edits and safely ignores unmount',async()=>{
  const job=deferred(),changes=[],notices=[];let value='old.gif';
  const h=harness('EffectEditor',{file:()=>job.promise});
  const context={catalog:[],blends:[],notify:message=>notices.push(message)};
  const field={key:'fileName',label:'GIF',type:'file'};
  const node=find(h.exports.Fields({fields:[field],value:{fileName:value},onChange:()=>{},context}),n=>typeof n.type==='function');
  h.setTarget(node.type,()=>({field,value,onChange:next=>{value=next;changes.push(next);},context}));
  button(h.render(),'Выбрать').props.onClick();find(h.render(),n=>n.type==='TextInput').props.onChange({currentTarget:{value:'typed.gif'}});h.render();
  job.resolve('picked.gif');await h.settle();assert.deepEqual(changes,['typed.gif']);assert.match(notices[0],/настройки уже изменились/);
  const later=deferred();const other=harness('EffectEditor',{file:()=>later.promise});
  const otherNode=find(other.exports.Fields({fields:[field],value:{fileName:value},onChange:()=>{},context}),n=>typeof n.type==='function');
  other.setTarget(otherNode.type,()=>({field,value,onChange:next=>changes.push(next),context}));button(other.render(),'Выбрать').props.onClick();other.unmount();later.resolve('unmounted.gif');await other.settle();assert.deepEqual(changes,['typed.gif']);
});

test('a file response cannot replay an old parent settings object after a sibling edit',async()=>{
  const job=deferred(),changes=[];let revision=0;
  const h=harness('EffectEditor',{file:()=>job.promise});
  const context={catalog:[],blends:[],notify:()=>{},capture:()=>{const before=revision;return ()=>revision===before;}};
  const field={key:'fileName',label:'GIF',type:'file'},props={field,value:'same.gif',onChange:next=>changes.push(next),context};
  const node=find(h.exports.Fields({fields:[field],value:{fileName:'same.gif'},onChange:()=>{},context}),n=>typeof n.type==='function');h.setTarget(node.type,()=>props);
  button(h.render(),'Выбрать').props.onClick();revision++;job.resolve('picked.gif');await h.settle();assert.deepEqual(changes,[]);
});

test('a later shader selection wins and an older read cannot replace it',async()=>{
  const first=deferred(),second=deferred();let value={main_pass:{fragment_shader:'old'},passes:[]};const changes=[];
  const h=harness('EffectEditor',{effects:async(method,args)=>method==='shader.read'?(args.path==='first'?first.promise:second.promise):[]});
  const context={catalog:[],blends:[],notify:()=>{}};
  const field={key:'shader_program',label:'Shader',type:'object'};
  const fieldNode=find(h.exports.Fields({fields:[field],value:{shader_program:value},onChange:()=>{},context}),n=>typeof n.type==='function');
  h.setTarget(fieldNode.type,()=>({field,value,onChange:()=>{},context}));const shaderNode=h.render();
  h.setTarget(shaderNode.type,()=>({value,onChange:next=>{value=next;changes.push(next.main_pass.fragment_shader);},context}));
  const select=()=>find(h.render(),n=>n.type==='RayloomSelect'&&n.props.label==='Библиотека шейдеров');
  select().props.onChange('first');select().props.onChange('second');second.resolve({main_pass:{fragment_shader:'second'},passes:[]});await h.settle();first.resolve({main_pass:{fragment_shader:'first'},passes:[]});await h.settle();assert.deepEqual(changes,['second']);
});

test('replacement history survives reopening and a failed archive write preserves both old scenes',()=>{
  const storage=new Storage();editorState.preserveReplacedDraft(storage,'hardware',scene('First'),'One');editorState.preserveReplacedDraft(storage,'hardware',scene('Second'),'Two');
  assert.equal(editorState.readReplacedDraft(storage,'hardware').scene.Effects[0].CustomName,'Second');
  assert.equal(JSON.parse(storage.getItem(editorState.replacementDraftKey('hardware')+'.2')).scene.Effects[0].CustomName,'First');
  const before=new Map(storage.data);storage.setItem=()=>{throw Error('full');};
  assert.throws(()=>editorState.preserveReplacedDraft(storage,'hardware',scene('Third'),'Three'),/full/);assert.deepEqual(storage.data,before);
  assert.equal(editorState.readReplacedDraft(storage,'virtual'),null);
});

test('nested maps wait for the actual equipment mode before restoring their draft scope',async()=>{
  const snapshot=deferred();
  const h=harness('NativeSceneEditor',{snapshot:()=>snapshot.promise,scenes:async()=>[],effects:async method=>method==='catalog'?catalog:method==='scene.get'?scene('Live'):method==='globals.get'?{fields:[],value:{}}:[]},{props:{onBack:()=>{},initialTab:'visual-map'}});
  h.render();await h.settle();assert.equal(nodes(h.render()).some(n=>n.type==='VisualMapPanel'),false);
  snapshot.resolve({mode:'virtual',status:{virtual:true},devices:[],plugins:[]});await h.settle();assert.equal(find(h.render(),n=>n.type==='VisualMapPanel').props.draftScope,'virtual');
});
