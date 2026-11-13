import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as library from '../shared/scene-library.mjs';
import * as panelSession from '../shared/panel-session.mjs';

const sources=Object.fromEntries(['ScenesScreen','WindowTitlebar'].map(name=>[name,ts.transpileModule(fs.readFileSync(new URL(`../src/mantine/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText]));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of [tree.props?.children].flat(Infinity)){const match=find(child,predicate);if(match)return match;}return null;}
const button=(tree,label)=>find(tree,node=>node.type==='Button'&&node.props.children===label);
// Source handlers only: no browser, DOM, Electron, operating-system or device actions.
function harness(name,props,api={}){
 const slots=[],effects=[],cleanups=[];let cursor=0;
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(effect){const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(effect);}}};
 const useForm=options=>{
  const ref=react.useRef(null);if(!ref.current){const values={...options.initialValues};ref.current={key:field=>field,getInputProps:field=>({defaultValue:values[field],onChange:e=>{values[field]=e.currentTarget.value;options.onValuesChange?.(values);}}),onSubmit:handler=>input=>handler(input)};}return ref.current;
 };
 const components=new Proxy({},{get:(_,name)=>name}),jsx=(type,props)=>({type,props});
 const modules={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'@mantine/core':components,'@mantine/form':{useForm},'lucide-react':components,'./StudioControls':components,'../../shared/scene-library.mjs':library,'../../shared/panel-session.mjs':panelSession};
 const exports={};vm.runInNewContext(sources[name],{exports,require:key=>{if(!(key in modules))throw Error('Unexpected import '+key);return modules[key];},window:{rayloom:api},console,Map,Set});
 const render=()=>{cursor=0;const tree=exports[name](props);for(const effect of effects.splice(0))cleanups.push(effect());return tree;};
 return {render,unmount:()=>{for(const cleanup of cleanups)cleanup?.();}};
}
function scene(overrides={}){
 const layout={version:1,components:[],groups:[{id:'all',name:'All',members:[]}],scenes:[]};
 const notices=[],calls=[],s={snapshot:{mode:'hardware'},state:{mode:'hardware',scenes:[{name:'Evening',layout}]},layout,config:{effect:'solid'},hasChanges:false,busy:false,ready:true,saveScene:async()=>({layout,config:{effect:'solid'}}),loadScene:async()=>true,setField:()=>{},setNotice:text=>notices.push(text),run:async fn=>fn(),...overrides};
 const h=harness('ScenesScreen',{s,onLoaded:()=>calls.push('navigate'),onNative:()=>{}},{studio:async method=>{calls.push(method);return false;}});
 return {...h,s,calls,notices};
}
test('scene overwrite waits for an explicit decision',async()=>{
 let saves=0;const h=scene({saveScene:async(name,replace)=>{saves++;assert.equal(name,'Evening');assert.equal(replace,true);return {layout:h.s.layout,config:h.s.config};}});
 await find(h.render(),n=>n.type==='form').props.onSubmit({name:'Evening'});assert.equal(saves,0);assert.equal(find(h.render(),n=>n.type==='Modal').props.opened,true);
 button(h.render(),'Заменить сцену').props.onClick();await tick();assert.equal(saves,1);assert.equal(find(h.render(),n=>n.type==='Modal').props.opened,false);
});
test('loading a scene cannot discard an existing draft without confirmation',async()=>{
 let loads=0;const h=scene({hasChanges:true,loadScene:async()=>{loads++;return true;}});button(h.render(),'Загрузить').props.onClick();await tick();assert.equal(loads,0);
 button(h.render(),'Остаться').props.onClick();assert.equal(find(h.render(),n=>n.type==='Modal').props.opened,false);assert.equal(loads,0);
 button(h.render(),'Загрузить').props.onClick();button(h.render(),'Загрузить без сохранения').props.onClick();await tick();assert.equal(loads,1);assert.deepEqual(h.calls,['navigate']);
});
test('late scene response does not navigate after leaving the screen; repeated clicks send once',async()=>{
 const job=deferred();let loads=0;const h=scene({loadScene:()=>{loads++;return job.promise;}}),load=button(h.render(),'Загрузить');load.props.onClick();load.props.onClick();h.unmount();job.resolve(true);await tick();assert.equal(loads,1);assert.deepEqual(h.calls,[]);
});
test('a failed overwrite keeps the dialog and recoverable draft visible',async()=>{
 const h=scene({saveScene:async()=>undefined});await find(h.render(),n=>n.type==='form').props.onSubmit({name:'Evening'});button(h.render(),'Заменить сцену').props.onClick();await tick();assert.equal(find(h.render(),n=>n.type==='Modal').props.opened,true);assert(find(h.render(),n=>n.type==='Alert'&&n.props.color==='red'));
});
test('cancelling game configuration export never reports success',async()=>{
 const h=scene(),game=find(h.render(),n=>typeof n.type==='function'&&n.type.name==='GameIntegration');button(game.type(game.props),'Конфигурация игры').props.onClick();await tick();assert.deepEqual(h.calls,['game.export']);assert.deepEqual(h.notices,[]);
});
test('window action errors are visible and double clicks are serialized',async()=>{
 const job=deferred(),errors=[],calls=[];const h=harness('WindowTitlebar',{onError:error=>errors.push(error)},{platform:'win32',window:action=>{calls.push(action);return job.promise;}});
 const close=find(h.render(),n=>n.props?.['aria-label']==='Закрыть редактор, оставить подсветку');close.props.onClick();close.props.onClick();job.reject(Error("Error invoking remote method 'rayloom:window': Error: Дождитесь завершения запроса Windows."));await tick();
 assert.deepEqual(calls,['close']);assert.deepEqual(errors,['Дождитесь завершения запроса Windows.']);assert.equal(find(h.render(),n=>n.props?.['aria-label']==='Закрыть редактор, оставить подсветку').props.disabled,false);
});
test('macOS state failure is caught before a fullscreen command is sent',async()=>{
 const calls=[],errors=[];const h=harness('WindowTitlebar',{onError:error=>errors.push(error)},{platform:'darwin',window:async action=>{calls.push(action);throw Error('Unavailable');}});
 find(h.render(),n=>n.props?.['aria-label']==='Развернуть или восстановить окно').props.onClick();await tick();assert.deepEqual(calls,['state']);assert.deepEqual(errors,['Unavailable']);
});
test('macOS window action uses actual fullscreen state to exit fullscreen',async()=>{
 const calls=[];const h=harness('WindowTitlebar',{}, {platform:'darwin',window:async action=>{calls.push(action);return {fullscreen:action==='state'};}});
 find(h.render(),n=>n.props?.['aria-label']==='Развернуть или восстановить окно').props.onClick();await tick();assert.deepEqual(calls,['state','fullscreen-exit']);
});
