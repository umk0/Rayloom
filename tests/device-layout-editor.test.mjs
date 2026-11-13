import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as layouts from '../shared/device-layouts.mjs';

const source=ts.transpileModule(readFileSync(new URL('../src/mantine/DeviceLayoutEditor.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const initial=()=>[{led:7,x:0,y:0,z:2},{led:2,x:10,y:0,z:3},{led:19,x:20,y:0,z:4}];
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const words=tree=>tree==null||typeof tree==='boolean'?'':Array.isArray(tree)?tree.map(words).join(''):typeof tree!=='object'?String(tree):words(tree.props?.children);
const find=(tree,predicate)=>{const value=nodes(tree).find(predicate);assert(value,'Control exists');return value;};
const button=(tree,label)=>find(tree,node=>node.type==='Button'&&(words(node)===label||node.props['aria-label']===label));

// Runs actual controlled handlers with synthetic refs. No browser, DOM,
// Electron, physical LEDs or real identify operation is started.
function harness({points=initial(),disabled=false,onIdentify,onChange}={}){
  let cursor=0,changed=false,effects=[],unmounted=false,lateWrites=0;const slots=[],calls=[];
  const react={useState(initial){const n=cursor++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return [slots[n],value=>{if(unmounted)lateWrites++;const next=typeof value==='function'?value(slots[n]):value;if(!Object.is(next,slots[n]))changed=true;slots[n]=next;}];},useRef(initial){const n=cursor++;return slots[n]??(slots[n]={current:initial});},useEffect(effect,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i])))effects.push(()=>{old?.cleanup?.();slots[n]={deps,cleanup:effect()};});}};
  const ui=new Proxy({Accordion:{Item:'Accordion.Item',Control:'Accordion.Control',Panel:'Accordion.Panel'}},{get:(target,key)=>target[key]??String(key)}),jsx=(type,props)=>({type,props});
  const modules={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'@mantine/core':ui,'lucide-react':ui,'./StudioControls':{NumericInput:'NumericInput'},'../../shared/device-layouts.mjs':layouts,'./device-layout-editor.css':{}};
  const exports={};vm.runInNewContext(source,{exports,require:name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},Set,Map,console});
  const captured=new Set(),svg={getBoundingClientRect:()=>({left:100,top:50,width:600,height:400}),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const render=()=>{let tree,count=0;do{cursor=0;changed=false;effects=[];tree=exports.DeviceLayoutEditor({points,disabled,onIdentify,onChange:next=>{if(onChange)onChange(next);calls.push(next);points=next;}});find(tree,node=>node.type==='svg').props.ref.current=svg;for(const effect of effects.splice(0))effect();}while(changed&&++count<10);assert(count<10,'effects converge');return tree;};
  render();return {render,calls,captured,points:()=>points,setPoints:next=>{points=next;},disable:value=>{disabled=value;},lateWrites:()=>lateWrites,unmount:()=>{for(const slot of slots)slot?.cleanup?.();unmounted=true;}};
}
const led=(h,id)=>find(h.render(),node=>node.type==='circle'&&node.props['aria-label']===`LED ${id}`);
const numeric=(h,label)=>find(h.render(),node=>node.type==='NumericInput'&&node.props.label===label).props;
const event=(x,y)=>({pointerId:1,button:0,clientX:x,clientY:y,preventDefault(){},stopPropagation(){},currentTarget:{focus(){}}});

test('shape controls edit only on Apply and preserve the exact noncontiguous LED identities',()=>{
  const h=harness(),original=plain(h.points());
  find(h.render(),node=>node.type==='SegmentedControl').props.onChange('grid');numeric(h,'Столбцов').onChange(2);numeric(h,'Шаг между LED, мм').onChange(12);
  assert.deepEqual(plain(h.points()),original);assert.equal(h.calls.length,0);
  button(h.render(),'Применить форму').props.onClick();assert.deepEqual(h.points().map(point=>point.led),[7,2,19]);assert.equal(h.points().length,3);
  assert.deepEqual(plain(h.points()),layouts.generateLayoutPoints('grid',initial(),{columns:2,spacing:12,radius:50,reverse:false,serpentine:true}));
  button(h.render(),'Отменить изменение').props.onClick();assert.deepEqual(plain(h.points()),original);assert.equal(button(h.render(),'Отменить изменение').props.disabled,true);
});

test('reverse and serpentine are geometry options, not LED renumbering',()=>{
  const h=harness();find(h.render(),node=>node.type==='SegmentedControl').props.onChange('grid');assert.equal(numeric(h,'Столбцов').value,3);
  find(h.render(),node=>node.type==='Switch'&&node.props.label==='Обратный порядок').props.onChange({currentTarget:{checked:true}});
  find(h.render(),node=>node.type==='Switch'&&node.props.label==='Соединение змейкой').props.onChange({currentTarget:{checked:false}});
  button(h.render(),'Применить форму').props.onClick();assert.deepEqual(plain(h.points()),layouts.generateLayoutPoints('grid',initial(),{columns:3,reverse:true,serpentine:false}));
});

test('drag maps letterboxed SVG coordinates correctly and one undo restores the complete gesture',()=>{
  const h=harness(),original=plain(h.points());led(h,7).props.onPointerDown(event(250,250));assert(h.captured.has(1));
  find(h.render(),node=>node.type==='svg').props.onPointerMove(event(280,280));find(h.render(),node=>node.type==='svg').props.onPointerMove(event(310,295));
  find(h.render(),node=>node.type==='svg').props.onPointerUp();assert.equal(h.captured.size,0);
  assert.deepEqual(plain(h.points()[0]),{led:7,x:4,y:3,z:2});assert.deepEqual(plain(h.points().slice(1)),original.slice(1));
  button(h.render(),'Отменить изменение').props.onClick();assert.deepEqual(plain(h.points()),original);
});

test('external preset replacement cancels an old drag and its undo without overwriting the new draft',()=>{
  const h=harness();led(h,7).props.onPointerDown(event(250,250));find(h.render(),node=>node.type==='svg').props.onPointerMove(event(280,280));
  const replacement=initial().map(point=>({...point,x:point.x+400}));h.setPoints(replacement);const tree=h.render();
  assert.equal(h.captured.size,0);assert.equal(button(tree,'Отменить изменение').props.disabled,true);
  find(tree,node=>node.type==='svg').props.onPointerMove(event(350,300));assert.equal(h.points(),replacement);
});

test('numeric coordinates and keyboard movement target only the selected immutable LED id',()=>{
  const h=harness();find(h.render(),node=>node.type==='Select').props.onChange('19');numeric(h,'Z, мм').onChange(17.2);numeric(h,'X, мм').onChange(100001);
  assert.equal(h.points()[2].z,17.2);assert.equal(h.points()[2].x,100000);assert.deepEqual(h.points().map(point=>point.led),[7,2,19]);assert.equal(h.points()[0].z,2);
  led(h,2).props.onFocus();led(h,2).props.onKeyDown({key:'ArrowDown',shiftKey:true,preventDefault(){}});assert.equal(h.points()[1].y,10);assert.equal(find(h.render(),node=>node.type==='Select').props.value,'2');
});

test('disabled callbacks and pointer gestures cannot mutate the controlled draft',()=>{
  const h=harness();led(h,7).props.onPointerDown(event(250,250));h.disable(true);const tree=h.render();
  button(tree,'Применить форму').props.onClick();numeric(h,'X, мм').onChange(20);find(tree,node=>node.type==='svg').props.onPointerMove(event(280,280));
  assert.equal(h.calls.length,0);assert.equal(h.captured.size,0);assert.deepEqual(plain(h.points()),initial());
});

test('identify is explicit, serialized and releases its busy state after a rejection',async()=>{
  const job=deferred(),ids=[],h=harness({onIdentify:id=>{ids.push(id);return job.promise;}});find(h.render(),node=>node.type==='Select').props.onChange('19');
  const click=button(h.render(),'Подсветить выбранный').props.onClick;click();click();assert.deepEqual(ids,[19]);assert.equal(button(h.render(),'Применить форму').props.disabled,true);
  job.reject(Error('Device disconnected'));await tick();assert.match(words(h.render()),/Device disconnected/);assert.equal(button(h.render(),'Применить форму').props.disabled,false);assert.equal(h.calls.length,0);
});

test('late identify failure after unmount cannot write to disposed editor state',async()=>{
  const job=deferred(),h=harness({onIdentify:()=>job.promise});button(h.render(),'Подсветить выбранный').props.onClick();h.unmount();job.reject(Error('Late'));await tick();assert.equal(h.lateWrites(),0);
});

test('empty or malformed points show a recoverable state with a finite view and no writes',()=>{
  for(const points of [[],[{led:1,x:NaN,y:0,z:0}],initial().map(point=>({...point,led:1}))]){
    const h=harness({points});assert.equal(button(h.render(),'Применить форму').props.disabled,true);assert(!/NaN|Infinity/.test(find(h.render(),node=>node.type==='svg').props.viewBox));assert.equal(find(h.render(),node=>node.type==='Select').props.data.length,0,'invalid duplicate ids must not reach Mantine Select');
    button(h.render(),'Применить форму').props.onClick();assert.equal(h.calls.length,0);
  }
});

test('a rejected local draft change reports an error without corrupting points or creating undo',()=>{
  const h=harness({onChange:()=>{throw Error('Draft replaced');}});numeric(h,'X, мм').onChange(30);assert.match(words(h.render()),/Draft replaced/);assert.deepEqual(plain(h.points()),initial());assert.equal(button(h.render(),'Отменить изменение').props.disabled,true);
});
