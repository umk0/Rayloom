import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as layouts from '../shared/device-layouts.mjs';

const source=ts.transpileModule(readFileSync(new URL('../src/mantine/DeviceLayoutDialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const initial=()=>[{led:7,x:0,y:0,z:2},{led:2,x:10,y:0,z:3},{led:19,x:20,y:0,z:4}];
const component=()=>({id:'port',deviceKey:'board',device:{name:'Board',vendor:'Test',serial:'123',location:'port'},zone:1,name:'Front fans',source:'native',enabled:true,points:initial(),pose:{x:50,y:0,z:0,rx:0,ry:0,rz:0,scale:1}});
const template=()=>({name:'Arc',source:'user',points:[{led:0,x:0,y:0,z:0},{led:1,x:30,y:30,z:0},{led:2,x:60,y:0,z:0}]});
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const words=tree=>tree==null||typeof tree==='boolean'?'':Array.isArray(tree)?tree.map(words).join(''):typeof tree!=='object'?String(tree):words(tree.props?.children);
const find=(tree,predicate)=>{const value=nodes(tree).find(predicate);assert(value,'Control exists');return value;};
const button=(tree,label)=>find(tree,node=>node.type==='Button'&&(words(node)===label||node.props['aria-label']===label));
const card=(tree,label)=>find(tree,node=>node.type==='UnstyledButton'&&words(node).startsWith(label));
const editor=tree=>find(tree,node=>node.type==='DeviceLayoutEditor');
const nameInput=tree=>find(tree,node=>node.type==='TextInput'&&node.props.label==='Название макета');

// Actual dialog handlers and effects run against deferred boundaries. The
// nested editor and Mantine controls are inert JSX; no GUI or device is used.
function harness({onApply=async()=>{},onSaveTemplate=async()=>{},onIdentify=async()=>{},catalog=async()=>({layouts:[]}),templates=[template()]}={}){
 let current=component(),busy=false,cursor=0,changed=false,effects=[],unmounted=false,lateWrites=0;const slots=[],calls={apply:[],save:[],identify:[],catalog:0,close:0};
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{if(unmounted)lateWrites++;const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i]))changed=true;slots[i]=next;}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:effect()};});}
 };
 const ui=new Proxy({Accordion:{Item:'Accordion.Item',Control:'Accordion.Control',Panel:'Accordion.Panel'},Tabs:{List:'Tabs.List',Tab:'Tabs.Tab',Panel:'Tabs.Panel'},ScrollArea:{Autosize:'ScrollArea.Autosize'}},{get:(target,key)=>target[key]??String(key)}),jsx=(type,props)=>({type,props});
 const modules={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'@mantine/core':ui,'lucide-react':ui,'./DeviceLayoutEditor':{DeviceLayoutEditor:'DeviceLayoutEditor'},'../../shared/device-layouts.mjs':layouts,'./device-layout-dialog.css':{}};
 const exports={};vm.runInNewContext(source,{exports,require:name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},Set,Map,console,window:{rayloom:{studio:async method=>{assert.equal(method,'catalog');calls.catalog++;return catalog();}}}});
 const render=()=>{let tree,count=0;do{cursor=0;changed=false;effects=[];tree=exports.DeviceLayoutDialog({component:current,busy,templates,onApply:(...args)=>{calls.apply.push(args);return onApply(...args);},onSaveTemplate:(...args)=>{calls.save.push(args);return onSaveTemplate(...args);},onIdentify:led=>{calls.identify.push(led);return onIdentify(led);},onClose:()=>{calls.close++;}});effects.splice(0).forEach(effect=>effect());}while(changed&&++count<10);assert(count<10,'effects converge');return tree;};
 const edit=()=>editor(render()).props.onChange(initial().map(point=>({...point,y:point.led+12})));
 return {render,edit,calls,current:()=>current,setComponent:value=>{current=value;},setBusy:value=>{busy=value;},setTemplates:value=>{templates=value;},lateWrites:()=>lateWrites,unmount:()=>{slots.forEach(slot=>slot?.cleanup?.());unmounted=true;}};
}

test('choosing a layout creates a local preview without applying or saving it',()=>{
 const h=harness(),before=plain(h.current());card(h.render(),'Arc').props.onClick();const draft=editor(h.render()).props.points;
 assert.deepEqual(plain(draft),layouts.remapTemplatePoints(template(),before.points));assert.deepEqual(plain(h.current()),before);
 assert.equal(h.calls.apply.length,0);assert.equal(h.calls.save.length,0);assert.equal(button(h.render(),'Применить макет').props.disabled,false);
});

test('Apply passes exact target LEDs plus the frozen expected baseline and closes only after success',async()=>{
 const job=deferred(),h=harness({onApply:()=>job.promise});card(h.render(),'Arc').props.onClick();const expected=plain(h.current().points);
 const apply=button(h.render(),'Применить макет').props.onClick;apply();apply();assert.equal(h.calls.apply.length,1);assert.equal(h.calls.close,0);
 assert.deepEqual(plain(h.calls.apply[0][0]),layouts.remapTemplatePoints(template(),expected));assert.deepEqual(plain(h.calls.apply[0][1]),expected);assert.equal(h.calls.apply[0][2],'Arc');
 assert.equal(editor(h.render()).props.disabled,true);job.resolve();await tick();assert.equal(h.calls.close,1);assert.equal(h.calls.save.length,0);
});

test('saving a named template only changes the library; it never applies the draft',async()=>{
 const h=harness();h.edit();nameInput(h.render()).props.onChange({currentTarget:{value:'My saved draft'}});const draft=plain(editor(h.render()).props.points);
 button(h.render(),'Сохранить макет').props.onClick();await tick();assert.equal(h.calls.save.length,1);assert.deepEqual(plain(h.calls.save[0]),['My saved draft',draft,false]);
 assert.equal(h.calls.apply.length,0);assert.equal(h.calls.close,0);assert.deepEqual(plain(h.current().points),initial());assert.match(words(h.render()),/Макет сохранён/);
 assert(card(h.render(),'My saved draft'));assert.equal(button(h.render(),'Применить макет').props.disabled,false);
});

test('a name collision requires explicit replace confirmation and changing the name revokes it',async()=>{
 const h=harness();h.edit();nameInput(h.render()).props.onChange({currentTarget:{value:' Arc '}});button(h.render(),'Сохранить макет').props.onClick();assert.equal(h.calls.save.length,0);
 assert.equal(find(h.render(),node=>node.type==='Alert'&&node.props.title==='Такое название уже есть').props.title,'Такое название уже есть');button(h.render(),'Оставить прежний').props.onClick();assert.equal(h.calls.save.length,0);
 button(h.render(),'Сохранить макет').props.onClick();nameInput(h.render()).props.onChange({currentTarget:{value:'Unique'}});assert(!nodes(h.render()).some(node=>node.props?.title==='Такое название уже есть'));
 nameInput(h.render()).props.onChange({currentTarget:{value:'Arc'}});button(h.render(),'Сохранить макет').props.onClick();button(h.render(),'Заменить сохранённый макет').props.onClick();await tick();assert.equal(h.calls.save.length,1);assert.equal(h.calls.save[0][2],true);assert.equal(h.calls.apply.length,0);
});

test('pending template save locks selection, edits, close and duplicate writes synchronously',async()=>{
 const job=deferred(),h=harness({onSaveTemplate:()=>job.promise});h.edit();const before=plain(editor(h.render()).props.points),save=button(h.render(),'Сохранить макет').props.onClick;
 save();save();card(h.render(),'Arc').props.onClick();editor(h.render()).props.onChange(initial());find(h.render(),node=>node.type==='Modal').props.onClose();
 assert.equal(h.calls.save.length,1);assert.equal(h.calls.close,0);assert.deepEqual(plain(editor(h.render()).props.points),before);assert.equal(editor(h.render()).props.disabled,true);
 job.resolve();await tick();assert.equal(editor(h.render()).props.disabled,false);assert.equal(h.calls.apply.length,0);
});

test('failed apply or template save retains the draft and allows retry without false success',async()=>{
 let applyCalls=0,saveCalls=0;const h=harness({onApply:async()=>{if(!applyCalls++)throw Error('write failed');},onSaveTemplate:async()=>{if(!saveCalls++)throw Error('library unavailable');}});h.edit();const draft=plain(editor(h.render()).props.points);
 button(h.render(),'Применить макет').props.onClick();await tick();assert.equal(h.calls.close,0);assert.match(words(h.render()),/write failed/);assert.deepEqual(plain(editor(h.render()).props.points),draft);
 button(h.render(),'Сохранить макет').props.onClick();await tick();assert.match(words(h.render()),/library unavailable/);assert.doesNotMatch(words(h.render()),/Макет сохранён/);assert.deepEqual(plain(editor(h.render()).props.points),draft);
 button(h.render(),'Сохранить макет').props.onClick();await tick();assert.equal(h.calls.save.length,2);button(h.render(),'Применить макет').props.onClick();await tick();assert.equal(h.calls.close,1);
});

for(const field of ['id','deviceKey','zone','points'])test(`external component ${field} change blocks stale Apply until an explicit reload`,async()=>{
 const h=harness();h.edit();const staleApply=button(h.render(),'Применить макет').props.onClick;
 h.setComponent({...h.current(),[field]:field==='points'?initial().map(point=>({...point,x:point.x+100})):field==='zone'?2:'other'});const tree=h.render();staleApply();await tick();
 assert.equal(h.calls.apply.length,0);assert.equal(button(tree,'Применить макет').props.disabled,true);assert.match(words(tree),/Новые настройки устройства сохранены/);
 button(h.render(),'Загрузить текущий макет').props.onClick();assert.deepEqual(plain(editor(h.render()).props.points),plain(h.current().points));assert.equal(button(h.render(),'Применить макет').props.disabled,true);
 h.edit();button(h.render(),'Применить макет').props.onClick();await tick();assert.equal(h.calls.apply.length,1);assert.deepEqual(plain(h.calls.apply[0][1]),plain(h.current().points));
});

test('a component rename or pose edit preserves the dialog draft and does not cause a geometry conflict',async()=>{
 const h=harness();h.edit();const draft=plain(editor(h.render()).props.points);h.setComponent({...h.current(),name:'Renamed',pose:{...h.current().pose,x:500}});
 assert.deepEqual(plain(editor(h.render()).props.points),draft);assert.equal(button(h.render(),'Применить макет').props.disabled,false);button(h.render(),'Применить макет').props.onClick();await tick();assert.equal(h.calls.apply.length,1);
});

test('Cancel and Escape request discard confirmation, while continuing keeps the local draft',()=>{
 const h=harness();h.edit();const draft=plain(editor(h.render()).props.points);find(h.render(),node=>node.type==='Modal').props.onClose();assert.equal(h.calls.close,0);
 assert(find(h.render(),node=>node.type==='Alert'&&node.props.title==='Закрыть без применения макета?'));button(h.render(),'Продолжить редактирование').props.onClick();assert.deepEqual(plain(editor(h.render()).props.points),draft);
 button(h.render(),'Отмена').props.onClick();button(h.render(),'Отменить изменения и закрыть').props.onClick();assert.equal(h.calls.close,1);assert.equal(h.calls.apply.length,0);
});

for(const action of ['apply','save'])test(`late ${action} response after unmount cannot close another dialog or write disposed state`,async()=>{
 const job=deferred(),h=harness({onApply:()=>job.promise,onSaveTemplate:()=>job.promise});h.edit();button(h.render(),action==='apply'?'Применить макет':'Сохранить макет').props.onClick();h.unmount();job.resolve();await tick();
 assert.equal(h.calls.close,0);assert.equal(h.lateWrites(),0);
});

test('disposed callbacks cannot launch new persistence, identify or close actions',async()=>{
 const h=harness();h.edit();const tree=h.render(),apply=button(tree,'Применить макет').props.onClick,save=button(tree,'Сохранить макет').props.onClick,identify=editor(tree).props.onIdentify,close=find(tree,node=>node.type==='Modal').props.onClose;
 h.unmount();apply();save();await identify(7);close();await tick();assert.equal(h.calls.apply.length,0);assert.equal(h.calls.save.length,0);assert.equal(h.calls.identify.length,0);assert.equal(h.calls.close,0);assert.equal(h.lateWrites(),0);
});

test('identify remains explicit, holds the draft lock and releases it after failure',async()=>{
 const job=deferred(),h=harness({onIdentify:()=>job.promise});h.edit();const identify=editor(h.render()).props.onIdentify,pending=identify(19);const another=identify(7);
 assert.deepEqual(h.calls.identify,[19]);assert.equal(editor(h.render()).props.disabled,true);button(h.render(),'Применить макет').props.onClick();assert.equal(h.calls.apply.length,0);
 job.reject(Error('device disconnected'));await assert.rejects(pending,/device disconnected/);await another;assert.equal(editor(h.render()).props.disabled,false);
});

test('catalog loads on demand, retains the draft on error and exposes retry without applying',async()=>{
 let attempt=0;const h=harness({catalog:async()=>{if(!attempt++)throw Error('catalog unavailable');return {layouts:[{id:'example',name:'Grid candidate',rows:1,columns:3,matrix:[[0,1,2]],requiredLedCount:3}]};}});h.edit();const draft=plain(editor(h.render()).props.points);assert.equal(h.calls.catalog,0);
 find(h.render(),node=>node.props?.keepMounted===false).props.onChange('catalog');h.render();await tick();assert.match(words(h.render()),/catalog unavailable/);assert.deepEqual(plain(editor(h.render()).props.points),draft);
 button(h.render(),'Повторить загрузку').props.onClick();h.render();await tick();card(h.render(),'Grid candidate').props.onClick();assert.equal(h.calls.catalog,2);assert.equal(h.calls.apply.length,0);assert.equal(h.calls.save.length,0);assert.deepEqual(editor(h.render()).props.points.map(point=>point.led),initial().map(point=>point.led));
});

test('late catalog response after unmount neither writes disposed state nor applies a candidate',async()=>{
 const job=deferred(),h=harness({catalog:()=>job.promise});find(h.render(),node=>node.props?.keepMounted===false).props.onChange('catalog');h.render();h.unmount();job.resolve({layouts:[template()]});await tick();assert.equal(h.lateWrites(),0);assert.equal(h.calls.apply.length,0);
});
