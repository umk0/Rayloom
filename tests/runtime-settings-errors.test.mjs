import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as panelSession from '../shared/panel-session.mjs';

const source=ts.transpileModule(readFileSync(new URL('../src/mantine/RuntimeSettings.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const find=(tree,predicate)=>{
  if(!tree||typeof tree!=='object')return null;
  if(predicate(tree))return tree;
  for(const child of [tree.props?.children].flat(Infinity)){const result=find(child,predicate);if(result)return result;}
  return null;
};
// Execute actual React handlers and lifecycle with deferred IPC; no DOM, window,
// Electron, system task, hardware call or browser automation is involved.
function harness(){
  const slots=[],effects=[];let cursor=0;const quit=deferred(),calls=[];
  const react={
    useState(initial){const n=cursor++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return [slots[n],next=>{slots[n]=typeof next==='function'?next(slots[n]):next;}];},
    useRef(initial){const n=cursor++;return slots[n]??(slots[n]={current:initial});},
    useEffect(effect){const n=cursor++;if(!(n in slots)){slots[n]=true;effects.push(effect);}},
  };
  const components=new Proxy({},{get:(_,name)=>name});
  const jsx=(type,props)=>({type,props});
  const modules={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'@mantine/core':components,'lucide-react':components,'./panels.css':{},'../../shared/panel-session.mjs':panelSession};
  const exports={};
  vm.runInNewContext(source,{exports,require:name=>modules[name],setInterval:()=>1,clearInterval:()=>{},console,window:{rayloom:{platform:'win32',studio:async()=>({ready:true,mode:'hardware',settings:{autoStart:false},hardware:{elevated:false}}),window:action=>{calls.push(action);return quit.promise;}}}});
  const render=()=>{cursor=0;const tree=exports.RuntimeSettings();for(const effect of effects.splice(0))effect();return tree;};
  render();return {render,quit,calls};
}

test('quit rejection is displayed and releases the UI busy state without an unhandled promise',async()=>{
  const h=harness();await tick();const button=find(h.render(),node=>node.type==='Button'&&node.props.children==='Полностью завершить Rayloom');assert(button);
  button.props.onClick();assert.equal(find(h.render(),node=>node.type==='Button'&&node.props.children==='Полностью завершить Rayloom').props.disabled,true);
  h.quit.reject(Error("Error invoking remote method 'rayloom:window': Error: Дождитесь завершения запроса Windows."));await tick();
  const tree=h.render();assert(find(tree,node=>node.type==='Text'&&node.props.children==='Дождитесь завершения запроса Windows.'));assert.equal(find(tree,node=>node.type==='Button'&&node.props.children==='Полностью завершить Rayloom').props.disabled,false);
});

test('rapid quit requests are serialized by the same lock as runtime settings',async()=>{
  const h=harness();await tick();const button=find(h.render(),node=>node.type==='Button'&&node.props.children==='Полностью завершить Rayloom');button.props.onClick();button.props.onClick();
  assert.deepEqual(h.calls,['quit']);h.quit.resolve({});await tick();
});
