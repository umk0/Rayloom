import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioHydration} from '../shared/studio-hydration.mjs';

const layout={version:1,components:[{id:'saved'}]},restored={effect:'prism',speed:5,brightness:100};
test('restored playback hydrates after an earlier state supplied layout but null current',()=>{
 const gate=new StudioHydration();
 const first=gate.observe({mode:'hardware',layout,current:null},gate.token());assert.equal(first.layout,layout);assert.equal(first.config,undefined);assert.equal(gate.configLoaded,false);
 const second=gate.observe({mode:'hardware',layout,current:restored},gate.token());assert.equal(second.layout,undefined);assert.equal(second.config.effect,'prism');assert.equal(second.config.speed,5);assert.equal(second.config.brightness,100);
 assert.equal(gate.observe({mode:'hardware',current:{effect:'rainbow'}},gate.token()).config,undefined,'initial hydration is not an ongoing overwrite');
});
test('an effect or parameter edit before restored playback arrives owns the local draft',()=>{
 const gate=new StudioHydration();gate.observe({mode:'hardware',layout,current:null},gate.token());const inFlight=gate.token();
 gate.editConfig();const update=gate.observe({mode:'hardware',layout,current:restored},inFlight);assert.equal(update.config,undefined);assert.equal(gate.configLoaded,true);
 assert.equal(gate.observe({mode:'hardware',current:restored},gate.token()).config,undefined);
});
test('a choice made before even the first poll is not erased when the mode becomes known',()=>{
 const gate=new StudioHydration(),inFlight=gate.token();gate.editConfig();assert.equal(gate.observe({mode:'hardware',layout,current:restored},inFlight).config,undefined);assert.equal(gate.mode,'hardware');
});
test('explicit scene load and play responses cannot overwrite a newer user revision',()=>{
 const gate=new StudioHydration();gate.observe({mode:'hardware',layout,current:null},gate.token());gate.editConfig();const load=gate.token();
 assert(gate.isCurrent(load));assert.equal(gate.observe({mode:'hardware',current:restored},gate.token()).config,undefined,'scene load owns config before async completion');
 gate.editConfig();assert.equal(gate.isCurrent(load),false,'newer edit invalidates delayed load/play response');
});
test('mode switches reset hydration and reject polls and responses from the previous mode',()=>{
 const gate=new StudioHydration();gate.observe({mode:'hardware',layout,current:restored},gate.token());gate.editConfig();const old=gate.token();
 gate.reset('virtual');assert.equal(gate.observe({mode:'hardware',current:restored},old).stale,true);assert.equal(gate.isCurrent(old),false);
 assert.equal(gate.observe({mode:'virtual',layout:{components:[]},current:null},gate.token()).config,undefined);
 const next=gate.observe({mode:'virtual',current:{effect:'aurora',speed:2}},gate.token());assert.equal(next.config.effect,'aurora');assert.equal(next.config.speed,2);
});
test('a mode changed outside the selector is adopted without leaking the prior config',()=>{
 const gate=new StudioHydration();gate.observe({mode:'virtual',layout,current:restored},gate.token());gate.editConfig();
 const changed=gate.observe({mode:'hardware',layout:{components:[]},current:null},gate.token());assert.equal(changed.modeChanged,true);assert.equal(gate.configLoaded,false);
 assert.equal(gate.observe({mode:'hardware',current:{effect:'solid'}},gate.token()).config.effect,'solid');
});
test('malformed playback does not prevent layout hydration or a subsequent valid restore',()=>{
 const gate=new StudioHydration();const invalid=gate.observe({mode:'hardware',layout,current:{effect:'prism',speed:'not-a-number'}},gate.token());
 assert.equal(invalid.layout,layout);assert.match(invalid.configError,/число/);assert.equal(invalid.config,undefined);assert.equal(gate.configLoaded,false);
 const valid=gate.observe({mode:'hardware',layout,current:restored},gate.token());assert.equal(valid.layout,undefined);assert.equal(valid.config.effect,'prism');assert.equal(valid.config.speed,5);
});
