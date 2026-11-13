import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as panelSession from '../shared/panel-session.mjs';
import * as authoring from '../shared/canvas-authoring.mjs';
import * as templates from '../shared/canvas-templates.mjs';

const transpile=name=>ts.transpileModule(readFileSync(new URL(`../src/mantine/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const source=transpile('CanvasEffectEditor');
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const find=(tree,predicate)=>{if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of [tree.props?.children].flat(Infinity)){const result=find(child,predicate);if(result)return result;}return null;};
const original={id:'mine',name:'My unsaved work',source:'<canvas id="original"></canvas>'};
function storage(){const data=new Map([['lumenrgb.canvas-editor.draft.v1',JSON.stringify(original)]]);return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}

// Execute real component handlers and effect cleanup with fake IPC. This is a
// lifecycle/unit test only: no DOM, browser, Electron process or hardware.
function harness(localStorage=storage()){
  const slots=[],effects=[],calls=[],pending=new Map();let cursor=0;
  const react={Component:class {},Suspense:'Suspense',lazy:()=> 'CanvasCodeEditor',
    useState(initial){const n=cursor++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return [slots[n],next=>{slots[n]=typeof next==='function'?next(slots[n]):next;}];},
    useRef(initial){const n=cursor++;return slots[n]??(slots[n]={current:initial});},
    useEffect(effect,deps){const n=cursor++,previous=slots[n];if(!previous||!deps||deps.some((v,i)=>!Object.is(v,previous.deps?.[i]))){effects.push(()=>{previous?.cleanup?.();slots[n]={deps,cleanup:effect()};});}},
  };
  const components=new Proxy({},{get:(_,name)=>name}),jsx=(type,props)=>({type,props});
  const modules={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'@mantine/core':components,'lucide-react':components,'./panels.css':{},'../types':{hex:v=>v,rgb:v=>v},'./StudioControls':components,'../../shared/panel-session.mjs':panelSession,'../../shared/canvas-authoring.mjs':authoring,'../../shared/canvas-templates.mjs':templates,'./CanvasAuthorHelp':{CanvasAuthorHelp:'CanvasAuthorHelp'}};
  const canvas=async(method,args)=>{calls.push({method,args});if(pending.has(method))return pending.get(method).promise;if(method==='list')return [];if(method==='state')return {target:'output',running:true,name:'Output A',output:'devices',controls:[]};if(method==='preview')return {target:'preview',running:true,name:args.name,output:false,controls:[]};if(method==='save')return {...args,id:'saved'};throw Error('Unexpected IPC '+method);};
  const exports={};vm.runInNewContext(source,{exports,require:name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},console,structuredClone,localStorage,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},window:{rayloom:{platform:'win32',canvas,studio:async(method)=>{calls.push({studio:method});if(method!=='state')throw Error('Hardware mutation forbidden');return {mode:'hardware'};}}}});
  const render=()=>{cursor=0;const tree=exports.CanvasEffectEditor({layout:{groups:[{id:'all',name:'All'}],components:[]},config:{}});for(const effect of effects.splice(0))effect();return tree;};
  const node=(type,tree=render())=>{const value=find(tree,item=>item.type===type);assert(value,`Missing ${type}`);return value.props;};
  render();return {render,node,calls,localStorage,delay:method=>{const job=deferred();pending.set(method,job);return job;},unmount:()=>{for(const slot of slots)slot?.cleanup?.();}};
}

test('guided example -> preview -> save keeps output isolated and original draft recoverable',async()=>{
  const h=harness();await tick();h.node('CanvasAuthorHelp').onTemplate('wave');
  assert.equal(h.node('CanvasCodeEditor').value,templates.canvasTemplates[0].source);
  assert.equal(h.node('CanvasAuthorHelp').context.step,1);
  h.node('CanvasAuthorHelp').onPreview();await tick();
  assert.equal(h.node('CanvasAuthorHelp').context.step,2);
  h.node('CanvasAuthorHelp').onSave();await tick();
  assert.equal(h.calls.filter(call=>call.method==='preview').length,1);
  assert.equal(h.calls.filter(call=>call.method==='save').length,1);
  assert.equal(h.calls.filter(call=>['play','stop'].includes(call.method)||call.studio==='save').length,0);
  const restore=find(h.render(),node=>node.type==='Button'&&node.props.children==='Вернуть черновик');assert(restore);restore.props.onClick();
  assert.equal(h.node('CanvasCodeEditor').value,original.source);
  assert.equal(find(h.render(),node=>node.type==='Select'&&node.props.label==='Мои эффекты').props.value,original.id);
  h.unmount();
});

test('help topic, step and original draft survive navigation through several examples',async()=>{
  const h=harness();await tick();h.node('CanvasAuthorHelp').onTemplate('wave');h.node('CanvasAuthorHelp').onTemplate('aurora');
  h.node('CanvasAuthorHelp').onContext({topic:'api',step:2});h.render();h.unmount();
  const again=harness(h.localStorage);await tick();const help=again.node('CanvasAuthorHelp');
  assert.deepEqual({...help.context},{topic:'api',step:2});assert.equal(again.node('CanvasCodeEditor').value,templates.canvasTemplates[1].source);
  find(again.render(),node=>node.type==='Button'&&node.props.children==='Вернуть черновик').props.onClick();
  assert.equal(again.node('CanvasCodeEditor').value,original.source);again.unmount();
});

test('example opening is blocked during preview launch and failed launch does not advance the guide',async()=>{
  const h=harness();await tick();h.node('CanvasAuthorHelp').onTemplate('wave');const launch=h.delay('preview');
  h.node('CanvasAuthorHelp').onPreview();await tick();assert.equal(h.node('CanvasAuthorHelp').disabled,true);
  h.node('CanvasAuthorHelp').onTemplate('health');assert.equal(h.node('CanvasCodeEditor').value,templates.canvasTemplates[0].source);
  launch.reject(Error('Syntax failure'));await tick();assert.equal(h.node('CanvasAuthorHelp').context.step,1);assert.equal(h.node('CanvasAuthorHelp').disabled,false);h.unmount();
});

test('diagnostic navigation waits for closing help and stale source cannot receive a jump',async()=>{
  const h=harness();await tick();const item={line:3,column:7,message:'Missing value',severity:'error'};
  h.node('CanvasCodeEditor').onDiagnostics({source:original.source,items:[item]});
  h.node('CanvasAuthorHelp').onDiagnostic(item);assert.equal(h.node('CanvasCodeEditor').reveal,undefined);
  h.node('CanvasAuthorHelp').onClosed();assert.equal(h.node('CanvasCodeEditor').reveal.line,3);const request=h.node('CanvasCodeEditor').reveal.request;
  h.node('CanvasAuthorHelp').onDiagnostic(item);h.node('CanvasCodeEditor').onChange('<canvas id="changed"/>');
  assert.equal(h.node('CanvasAuthorHelp').diagnostics.length,0);
  h.node('CanvasAuthorHelp').onClosed();assert.equal(h.node('CanvasCodeEditor').reveal.request,request);h.unmount();
});

test('normalizing Monaco markers rejects stale versions, invalid locations and non-problems',()=>{
  const marker={severity:8,message:'Unexpected token',startLineNumber:4,startColumn:2,modelVersionId:3};
  const value=authoring.canvasDiagnostics([marker,{...marker,modelVersionId:2},{...marker,startLineNumber:0},{...marker,severity:1},{...marker,severity:4,startLineNumber:2},null],3);
  assert.deepEqual(value,[{message:'Unexpected token',line:2,column:2,severity:'warning'},{message:'Unexpected token',line:4,column:2,severity:'error'}]);
  assert.deepEqual(authoring.canvasDiagnostics('runtime error line 9',3),[],'runtime text must not invent a clickable location');
});

test('corrupt help state recovers and no-op example selection does not create a false backup',()=>{
  assert.deepEqual(authoring.normalizeAuthorHelp({topic:'unknown',step:NaN}),{topic:'start',step:0});assert.deepEqual(authoring.normalizeAuthorHelp({topic:'api',step:99}),{topic:'api',step:2});
  const same=templates.canvasTemplates[0];assert.equal(authoring.openCanvasExample(same,same,null).previous,null);
  const first=authoring.openCanvasExample(original,same,null);first.previous.name='Other';assert.equal(original.name,'My unsaved work');
});

test('Monaco adapter reports current markers, focuses the requested location and ignores events after disposal',()=>{
  const code=transpile('CanvasCodeEditor'),slots=[],effects=[],reported=[],positions=[],actions=[];let cursor=0,modelVersion=2;
  const react={useRef(initial){const n=cursor++;return slots[n]??(slots[n]={current:initial});},useEffect(effect,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>v!==old.deps[i]))effects.push(()=>{old?.cleanup?.();slots[n]={deps,cleanup:effect()};});}};
  const model={getValue:()=>'<canvas/>',getVersionId:()=>modelVersion,validatePosition:p=>({lineNumber:Math.min(p.lineNumber,5),column:p.column})};
  const editor={getModel:()=>model,addAction:action=>actions.push(action),setPosition:p=>positions.push(p),revealPositionInCenter:()=>{},focus:()=>positions.push('focused')};
  const monaco={editor:{defineTheme:()=>{}},KeyMod:{CtrlCmd:1},KeyCode:{Enter:2,KeyS:3}};
  const jsx=(type,props)=>({type,props});
  const modules={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'@monaco-editor/react':{__esModule:true,default:'MonacoEditor',loader:{config:()=>{}}},'monaco-editor':monaco,'../../shared/canvas-authoring.mjs':authoring};
  const exports={};vm.runInNewContext(code,{exports,self:{},require:name=>name.endsWith('?worker')?class Worker{}:modules[name]});
  let shortcuts=0;const render=(reveal)=>{cursor=0;const tree=exports.default({value:'<canvas/>',onChange:()=>{},onPreview:()=>shortcuts++,onSave:()=>shortcuts++,onDiagnostics:value=>reported.push(value),reveal});for(const effect of effects.splice(0))effect();return tree.props;};
  let props=render();props.onMount(editor);
  props.onValidate([{severity:8,message:'Invalid value',startLineNumber:3,startColumn:4,modelVersionId:2}]);assert.equal(reported[0].source,'<canvas/>');assert.equal(reported[0].items[0].line,3);
  modelVersion=3;props.onValidate([{severity:8,message:'Old',startLineNumber:2,startColumn:1,modelVersionId:2}]);assert.equal(reported[1].items.length,0);
  props=render({line:99,column:2,request:1});assert.deepEqual({...positions[0]},{lineNumber:5,column:2});assert.equal(positions[1],'focused');
  actions[0].run();actions[1].run();assert.equal(shortcuts,2);
  for(const slot of slots)slot?.cleanup?.();props.onValidate([]);assert.equal(reported.length,2,'disposed editor cannot publish diagnostics');
});
