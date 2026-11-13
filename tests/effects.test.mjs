import test from 'node:test';
import assert from 'node:assert/strict';
import {effectProfile} from '../desktop/effects.mjs';
const device={name:'Fixture',zoneCount:2,location:'LumenRGB:test',serial:'1',description:'Test',vendor:'Test',version:'1'};
test('maps every selected zone using persistent device descriptors',()=>{
  const p=effectProfile({devices:[device]});
  assert.equal(p.Effects[0].ControllerZones.length,2);
  assert.equal(p.Effects[0].ControllerZones[1].zone_idx,1);
  assert.equal(p.Effects[0].ControllerZones[0].serial,'1');
  assert.equal(p.Effects[0].SelectAll,false);
});
test('rejects invalid animation input before calling native code',()=>{
  for(const input of [{speed:0},{speed:Infinity},{brightness:-1},{frequency:51},{colors:[]},{colors:[-1]},{effect:'Unknown'}])
    assert.throws(()=>effectProfile({devices:[device],...input}));
  assert.throws(()=>effectProfile({devices:[]}));
});

test('legacy profiles use the actual native effect color schema',()=>{
  const colors=[0x112233,0x445566];
  for(const effect of ['RainbowWave','SpectrumCycling','Breathing']){
    const value=effectProfile({effect,devices:[device],colors}).Effects[0];
    assert.deepEqual(value.UserColors,[],effect+' has zero generic color slots');
    if(effect==='Breathing'){assert.deepEqual(value.CustomSettings,{colors});assert.notEqual(value.CustomSettings.colors,colors);}
    if(effect==='SpectrumCycling')assert.deepEqual(value.CustomSettings,{saturation:255});
    if(effect==='RainbowWave')assert.deepEqual(value.CustomSettings,{});
    assert.equal(value.Slider2Val,effect==='RainbowWave'?10:1);
  }
});

test('legacy Breathing respects its native speed range',()=>{
  assert.throws(()=>effectProfile({effect:'Breathing',speed:9,devices:[device]}),/speed/);
  assert.equal(effectProfile({effect:'Breathing',speed:200,devices:[device]}).Effects[0].Speed,200);
});
