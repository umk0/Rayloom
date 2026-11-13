import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceKey} from '../shared/spatial.mjs';
import {visibleComponents,isComponentAvailable} from '../shared/device-visibility.mjs';

const device={name:'Test keyboard',vendor:'Test',serial:'serial-1',location:'HID:one',ledCount:4,zoneCount:1};
const component={id:'keyboard',deviceKey:deviceKey(device),zone:0,enabled:true,points:[{led:0},{led:3}]};
test('disabled and disconnected devices disappear without losing saved layout',()=>{
 const layout={components:[component,{...component,id:'disabled',enabled:false},{...component,id:'offline',deviceKey:'offline'}]};
 assert.deepEqual(visibleComponents(layout,[device]).map(c=>c.id),['keyboard']);
 assert.deepEqual(visibleComponents(layout,[]),[]);
 assert.equal(layout.components.length,3);
 assert.deepEqual(visibleComponents(layout,[device]).map(c=>c.id),['keyboard']);
});
test('stale ports and invalid LED spans are excluded from the scene',()=>{
 assert.equal(isComponentAvailable({...component,zone:1},device),false);
 assert.equal(isComponentAvailable({...component,points:[{led:4}]},device),false);
 assert.equal(isComponentAvailable({...component,points:[{led:-1}]},device),false);
 assert.equal(isComponentAvailable(component,device),true);
});

test('a shifted preceding zone cannot expose a saved component over neighbouring LEDs',()=>{
 const before={...device,ledCount:16,zoneCount:2,zones:[{index:0,startIndex:0,ledCount:4},{index:1,startIndex:4,ledCount:12}]};
 const saved={...component,zone:1,points:[{led:4},{led:7}]};
 assert.equal(isComponentAvailable(saved,before),true);
 const resized={...before,zones:[{index:0,startIndex:0,ledCount:8},{index:1,startIndex:8,ledCount:8}]};
 assert.equal(isComponentAvailable(saved,resized),false);
 assert.deepEqual(visibleComponents({components:[saved]},[resized]),[]);
 assert.deepEqual(saved.points,[{led:4},{led:7}]);
});

test('noncontiguous LED ids inside the native zone stay available without requiring full coverage',()=>{
 const native={...device,ledCount:24,zoneCount:2,zones:[{index:0,startIndex:0,ledCount:5},{index:1,startIndex:5,ledCount:19}]};
 const split={...component,zone:1,points:[{led:19},{led:5},{led:8}]};
 assert.equal(isComponentAvailable(split,native),true);
 assert.equal(isComponentAvailable({...split,points:[{led:4},{led:8}]},native),false);
 assert.equal(isComponentAvailable({...split,points:[{led:24}]},native),false);
});

test('sparse native zone indices use exact identities rather than their array positions',()=>{
 const native={...device,ledCount:8,zoneCount:2,zones:[{index:2,startIndex:0,ledCount:4},{index:9,startIndex:4,ledCount:4}]};
 assert.equal(isComponentAvailable({...component,zone:2},native),true);
 assert.equal(isComponentAvailable({...component,zone:9,points:[{led:4},{led:7}]},native),true);
 assert.equal(isComponentAvailable({...component,zone:0},native),false);
 assert.equal(isComponentAvailable({...component,zone:1},native),false);
});

test('legacy snapshots without zones or offsets retain total LED bounds',()=>{
 for(const zones of [undefined,[]])assert.equal(isComponentAvailable(component,{...device,zones}),true);
 assert.equal(isComponentAvailable(component,{...device,zoneCount:undefined}),false);
 const nativeWithoutOffset={...device,zones:[{index:9,ledCount:1}]};
 assert.equal(isComponentAvailable({...component,zone:9},nativeWithoutOffset),true);
 assert.equal(isComponentAvailable({...component,zone:0},nativeWithoutOffset),false);
 assert.equal(isComponentAvailable({...component,zone:9,points:[{led:4}]},nativeWithoutOffset),false);
});

test('zero-length and malformed native ranges never claim saved LED addresses',()=>{
 for(const zone of [{index:0,startIndex:0,ledCount:0},{index:0,startIndex:-1,ledCount:4},{index:0,startIndex:0,ledCount:1.5}]){
  assert.equal(isComponentAvailable(component,{...device,zones:[zone]}),false);
 }
});
