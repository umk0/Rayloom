import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as spatial from '../shared/spatial.mjs';
import * as availability from '../shared/device-visibility.mjs';

const source=ts.transpileModule(readFileSync(new URL('../src/mantine/DeviceLayoutPreview.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
let nextId=0;const jsx=(type,props)=>({type,props});
const hex=c=>'#'+[c&255,(c>>8)&255,(c>>16)&255].map(value=>value.toString(16).padStart(2,'0')).join('');
const modules={'react':{useMemo:fn=>fn(),useId:()=>`preview-${++nextId}`},'react/jsx-runtime':{jsx,jsxs:jsx},'../types':{hex},'../../shared/spatial.mjs':spatial,'../../shared/device-visibility.mjs':availability,'./device-layout-preview.css':{}};
const exports={};vm.runInNewContext(source,{exports,require:name=>{if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];},Set,Math,Number});
const {DeviceLayoutPreview,projectDeviceLayout}=exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const byType=(tree,type)=>nodes(tree).filter(node=>node.type===type);
const device=()=>({index:0,name:'Board',vendor:'Vendor',serial:'board-1',location:'usb:1',ledCount:32,zoneCount:2,colors:Array.from({length:32},()=>0xffffff),zones:[{index:0,name:'Port 1',startIndex:0,ledCount:8},{index:1,name:'Port 2',startIndex:8,ledCount:8}]});
const component=(points,hardware=device())=>({id:'port-2',name:'Front fans',deviceKey:spatial.deviceKey(hardware),device:hardware,zone:1,enabled:true,points,pose:{x:999,y:-999,z:444,rx:180,ry:90,rz:35,scale:3},source:'test'});
const point=(led,x,y=0,z=0)=>({led,x,y,z});
const assertFits=result=>{const [x,y,w,h]=result.viewBox.split(' ').map(Number);assert([x,y,w,h,result.radius].every(Number.isFinite));assert(w>0&&h>0&&result.radius>0);for(const point of result.points){assert(point.x-result.radius>=x-1e-6);assert(point.x+result.radius<=x+w+1e-6);assert(point.y-result.radius>=y-1e-6);assert(point.y+result.radius<=y+h+1e-6);}};

// Source/geometry and actual presentational SVG-tree checks only. This does
// not render a browser, start Electron or read a physical device.
test('port preview uses sparse global LED ids directly without zone slicing or scene pose',()=>{
  const hardware=device();hardware.colors[14]=0xff0000;hardware.colors[8]=0x0000ff;hardware.colors[11]=0x00ff00;
  const input=[point(14,40,20),point(8,-20,10),point(11,5,-15)],part=component(input,hardware),tree=DeviceLayoutPreview({component:part,device:hardware,available:true}),dots=byType(tree,'circle');
  assert.deepEqual(dots.map(dot=>[dot.props['data-led'],dot.props.fill]),[[14,'#0000ff'],[8,'#ff0000'],[11,'#00ff00']]);
  assert.deepEqual(dots.map(dot=>[dot.props.cx,dot.props.cy]),input.map(point=>[point.x,point.y]));assert.equal(tree.props['data-state'],'live');
  assert.equal(byType(tree,'svg')[0].props.preserveAspectRatio,'xMidYMid meet');
});

test('ring, grid, line and hand-placed forms retain their distinct local geometry',()=>{
  const forms=[spatial.generatePoints('ring',8,{radius:30}),spatial.generatePoints('grid',6,{columns:3,spacing:12}),spatial.generatePoints('line',5,{spacing:9}),[point(3,-18,2),point(9,5,-7),point(12,2,20)]];
  for(const input of forms){const frozen=input.map(point=>Object.freeze({...point}));Object.freeze(frozen);const result=projectDeviceLayout(frozen);assert.equal(result.plane,'XY');assert.deepEqual(plain(result.points),input.map(({led,x,y})=>({led,x,y})));assertFits(result);}
  assert.notDeepEqual(projectDeviceLayout(forms[0]).viewBox,projectDeviceLayout(forms[2]).viewBox);
});

test('unavailable, disabled and mismatched controllers expose only neutral outlines',()=>{
  const hardware=device(),part=component([point(8,0),point(11,10)],hardware);
  const inputs=[{component:part,device:hardware,available:false},{component:{...part,enabled:false},device:hardware,available:true},{component:part,available:true},{component:part,device:{...hardware,serial:'another-board'},available:true},{component:{...part,zone:8},device:hardware,available:true}];
  for(const props of inputs){const tree=DeviceLayoutPreview(props);assert.notEqual(tree.props['data-state'],'live');for(const dot of byType(tree,'circle')){assert.equal(dot.props.fill,'none');assert.equal(dot.props['data-color-state'],'unknown');}}
});

test('undefined, malformed or absent color data is not represented as confirmed black',()=>{
  const hardware=device(),part=component([point(8,0)],hardware);
  for(const raw of [undefined,NaN,Infinity,-1,0x1000000,1.2,'#ff0000']){hardware.colors[8]=raw;const dot=byType(DeviceLayoutPreview({component:part,device:hardware,available:true}),'circle')[0];assert.equal(dot.props.fill,'none');assert.equal(dot.props['data-color-state'],'unknown');}
  const absent=DeviceLayoutPreview({component:part,device:{...hardware,colors:undefined},available:true});assert.equal(byType(absent,'circle')[0].props.fill,'none');
  hardware.colors[8]=0;const black=byType(DeviceLayoutPreview({component:part,device:hardware,available:true}),'circle')[0];assert.equal(black.props.fill,'#000000');assert.equal(black.props['data-color-state'],'known');
});

test('native sparse zone identity works but a resized neighbouring port cannot lend its colors',()=>{
  const hardware=device();hardware.zones[1].index=7;
  const part={...component([point(8,0),point(11,10)],hardware),zone:7};
  const before=DeviceLayoutPreview({component:part,device:hardware,available:true});assert.equal(before.props['data-state'],'live');
  hardware.zones[1]={...hardware.zones[1],startIndex:16};
  const shifted=DeviceLayoutPreview({component:part,device:hardware,available:true});assert.equal(shifted.props['data-state'],'unavailable');assert(byType(shifted,'circle').every(dot=>dot.props.fill==='none'));
});

test('Z-only layouts and YZ surfaces choose a visible labelled plane',()=>{
  const depth=projectDeviceLayout([point(8,0,0,-10),point(11,0,0,0),point(14,0,0,20)]);assert.equal(depth.plane,'XZ');assert.equal(new Set(depth.points.map(point=>point.y)).size,3);assert.equal(depth.caption,'Плоскость XZ');assertFits(depth);
  const surface=projectDeviceLayout([point(1,0,0,0),point(2,0,20,0),point(3,0,0,20),point(4,0,20,20)]);assert.equal(surface.plane,'YZ');assert.equal(surface.caption,'Плоскость YZ');assertFits(surface);
});

test('a volume whose faces overlap in every orthogonal plane uses a labelled oblique projection',()=>{
  const points=[];for(const x of [0,10])for(const y of [0,10])for(const z of [0,10])points.push(point(points.length,x,y,z));
  const result=projectDeviceLayout(points);assert.equal(result.plane,'3D');assert.equal(result.caption,'Проекция объёма');assert.equal(new Set(result.points.map(point=>`${point.x}/${point.y}`)).size,8);assertFits(result);
});

test('coincident coordinates show every LED in an explicitly schematic row; single and empty views stay finite',()=>{
  const input=[point(14,5,5,5),point(8,5,5,5),point(11,5,5,5)],result=projectDeviceLayout(input);
  assert.equal(result.plane,'coincident');assert.equal(result.caption,'LED находятся в одной точке — задайте макет');assert.deepEqual(result.points.map(point=>point.led),[14,8,11]);assert.equal(new Set(result.points.map(point=>point.x)).size,3);assertFits(result);
  const single=projectDeviceLayout([point(4,0)]);assert.equal(single.plane,'XY');assertFits(single);
  const small=projectDeviceLayout([point(4,0),point(6,.001)]);assertFits(small);assert(small.radius/Number(small.viewBox.split(' ')[2])>.005,'fit must not bury a small but valid layout inside a fixed-size margin');
  const empty=projectDeviceLayout([]);assert.equal(empty.plane,'empty');assertFits(empty);assert.equal(empty.points.length,0);
  const invalid=projectDeviceLayout([point(4,NaN),point(6,Infinity),point(7,1e308)]);assert.equal(invalid.points.length,0);assertFits(invalid);
});

test('SVG has an accessible per-component title and only non-XY views need a plane caption',()=>{
  const hardware=device(),flat=DeviceLayoutPreview({component:component([point(8,0),point(11,10)],hardware),device:hardware,available:true,className:'port-preview'}),depth=DeviceLayoutPreview({component:component([point(8,0,0,1),point(11,0,0,5)],hardware),device:hardware,available:true});
  const svg=byType(flat,'svg')[0],title=byType(svg,'title')[0];assert.equal(svg.props.role,'img');assert.equal(svg.props['aria-labelledby'],title.props.id);assert(flat.props.className.includes('port-preview'));
  assert.equal(byType(flat,'figcaption').length,0);assert.equal(byType(depth,'figcaption')[0].props.children,'Плоскость XZ');assert.notEqual(svg.props['aria-labelledby'],byType(depth,'svg')[0].props['aria-labelledby']);
});
