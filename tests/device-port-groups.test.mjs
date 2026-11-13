import test from 'node:test';
import assert from 'node:assert/strict';
import {groupDevicePorts} from '../shared/device-port-groups.mjs';
import {deviceKey} from '../shared/spatial.mjs';

const controller=()=>({name:'Board',vendor:'Test',serial:'board-1',location:'USB:first',index:0,zoneCount:5,ledCount:85,zones:[
  {index:0,name:'Встроенная подсветка',type:0,ledCount:1},
  {index:1,name:'ARGB 1',type:1,ledCount:24},
  {index:2,name:'ARGB 2',type:1,ledCount:24},
  {index:3,name:'RGB Header',type:0,ledCount:1},
  {index:4,name:'ARGB 3',type:1,ledCount:35},
]});
const component=(device,zone,id,leds)=>({id,name:id,deviceKey:deviceKey(device),device:{name:device.name,vendor:device.vendor,serial:device.serial,location:device.location},zone,enabled:true,points:leds.map(led=>({led,x:led*10,y:0,z:0})),source:'User calibrated',pose:{x:20,y:30,z:0,rx:0,ry:0,rz:0,scale:1}});

test('five native zones produce five groups, including built-in lighting, with native labels and counts',()=>{
  const device=controller(),components=device.zones.map(zone=>component(device,zone.index,`zone-${zone.index}`,[zone.index*10]));
  const groups=groupDevicePorts(device,components);
  assert.deepEqual(groups.map(group=>group.zone),[0,1,2,3,4]);
  assert.deepEqual(groups.map(group=>group.label),device.zones.map(zone=>zone.name));
  assert.deepEqual(groups.map(group=>group.ledCount),[1,24,24,1,35]);
  assert.equal(groups[0].kind,'single');assert.equal(groups[1].kind,'linear');assert(groups.every(group=>group.configured));
});

test('split fan components remain in one port, retain their input order and are never recreated',()=>{
  const device=controller(),first=component(device,1,'front-lower',[9,10,11]),second=component(device,1,'front-upper',[1,2,3]),other=component(device,4,'strip',[70,71]);
  const original=structuredClone([device,first,second,other]);const groups=groupDevicePorts(device,[other,first,second]);
  assert.equal(groups.length,5);assert.deepEqual(groups[1].components.map(item=>item.id),['front-lower','front-upper']);
  assert.equal(groups[1].components[0],first);assert.equal(groups[1].components[1],second);assert.equal(groups[1].ledCount,24);
  assert.deepEqual([device,first,second,other],original);
});

test('explicit sparse native zone indices are sorted numerically without filling invented ports',()=>{
  const device={...controller(),zoneCount:3,zones:[{index:12,name:'Long strip',ledCount:2},{index:2,name:'ARGB',ledCount:3},{index:7,name:'Side',ledCount:4}]};
  const saved=component(device,20,'Remembered removed zone',[90]);const groups=groupDevicePorts(device,[saved]);
  assert.deepEqual(groups.map(group=>group.zone),[2,7,12,20]);assert.deepEqual(groups.map(group=>group.label),['ARGB','Side','Long strip','Зона 21']);
  assert.equal(groups[3].components[0],saved);assert.equal(groups[3].ledCount,1);
});

test('an offline remembered controller retains every saved zone and derives unique configured LED counts',()=>{
  const device={...controller(),index:-1,zoneCount:0,zones:undefined,ledCount:0};
  const a=component(device,3,'Fan A',[7,2,19]),b=component(device,3,'Fan B',[19,20]),c=component(device,11,'Pump',[100,104]);b.enabled=false;
  const groups=groupDevicePorts(device,[c,a,b]);
  assert.deepEqual(groups.map(group=>group.zone),[3,11]);assert.deepEqual(groups[0].components,[a,b]);assert.equal(groups[0].ledCount,4);assert.equal(groups[1].ledCount,2);
  assert(groups.every(group=>group.configured&&group.kind==='unknown'));
});

test('declared zoneCount without native zone details creates placeholders with unknown counts',()=>{
  for(const zones of [undefined,[]]){
    const device={...controller(),zones,ledCount:9999,zoneCount:3},groups=groupDevicePorts(device,[]);
    assert.deepEqual(groups.map(group=>group.zone),[0,1,2]);assert.deepEqual(groups.map(group=>group.label),['Зона 1','Зона 2','Зона 3']);
    assert(groups.every(group=>group.ledCount===null&&!group.configured&&group.kind==='unknown'));
  }
});

test('missing native zone count neither invents a default port nor discards saved sparse zones',()=>{
  const device={...controller(),zones:undefined,zoneCount:undefined};assert.deepEqual(groupDevicePorts(device,[]),[]);
  const saved=component(device,8,'Saved port',[2,7,19]);const groups=groupDevicePorts(device,[saved]);
  assert.equal(groups.length,1);assert.equal(groups[0].zone,8);assert.equal(groups[0].ledCount,3);assert.equal(groups[0].components[0],saved);
});

test('components from another controller never appear even when their zone or display name matches',()=>{
  const device=controller(),other={...device,serial:'board-2'},mine=component(device,1,'Fans',[1]),foreign=component(other,1,'Fans',[1,2]);
  const groups=groupDevicePorts(device,[foreign,mine]);assert.deepEqual(groups[1].components,[mine]);assert.equal(groups.flatMap(group=>group.components).length,1);
});

test('native zero LED count remains zero, while an existing empty component is still configured',()=>{
  const device={...controller(),zones:[{index:1,name:'  ARGB off  ',ledCount:0}],zoneCount:1};
  const saved=component(device,1,'Old LEDs',[1,2]),empty=component(device,6,'Configured empty',[]);const groups=groupDevicePorts(device,[saved,empty]);
  assert.equal(groups[0].label,'ARGB off');assert.equal(groups[0].ledCount,0);assert.equal(groups[0].configured,true);
  assert.equal(groups[1].ledCount,0);assert.equal(groups[1].configured,true);
});

test('missing native count falls back to the sparse LED union, never max index or device total',()=>{
  const device={...controller(),zones:[{index:0,name:'',ledCount:undefined}],zoneCount:1,ledCount:1000};
  const saved=component(device,0,'LEDs',[2,19,500]);const groups=groupDevicePorts(device,[saved]);
  assert.equal(groups[0].ledCount,3);assert.equal(groups[0].label,'Зона 1');assert.deepEqual(saved.points.map(point=>point.led),[2,19,500]);
});

test('native matrix and loop flags describe geometry without claiming a physical device model',()=>{
  const device={...controller(),zones:[{index:0,name:'Keys',type:2,ledCount:98},{index:1,name:'Ring zone',type:3,ledCount:12},{index:2,name:'Mapped',type:99,matrix:{width:2,height:1,map:[0,1]}}]};
  assert.deepEqual(groupDevicePorts(device,[]).map(group=>group.kind),['matrix','linear','matrix']);
});

test('invalid identities and excessive fallback counts cannot fabricate or merge zones',()=>{
  const device={...controller(),zones:undefined,zoneCount:999999};
  const invalid=[{...component(device,0,'Negative',[]),zone:-1},{...component(device,0,'Fraction',[]),zone:.5},{...component(device,0,'Unbound',[]),deviceKey:undefined}];
  assert.deepEqual(groupDevicePorts(device,invalid),[]);assert.deepEqual(groupDevicePorts(null,invalid),[]);
});
