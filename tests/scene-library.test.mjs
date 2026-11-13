import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneRecord,upsertSceneRecord,sceneNameError} from '../shared/scene-library.mjs';
const layout=()=>({version:1,components:[],groups:[{id:'all',name:'All',members:[]}],scenes:[]});
test('scene names are validated before any write while international names are preserved',()=>{
 for(const name of ['', '  ', '../bad', 'CON', 'COM1.txt', 'bad.', 'a'.repeat(101)])assert.ok(sceneNameError(name),name);
 assert.equal(sceneNameError(' Вечер • 晚上 '),null);assert.equal(createSceneRecord({name:' Вечер • 晚上 ',layout:layout(),config:{}}).name,'Вечер • 晚上');
});
test('stored scene is a validated independent snapshot with an existing target group',()=>{
 const source=layout(),config={brightness:25},record=createSceneRecord({name:'A',layout:source,config});source.groups[0].name='Changed';config.brightness=80;
 assert.equal(record.layout.groups[0].name,'All');assert.equal(record.config.brightness,25);
 assert.throws(()=>createSceneRecord({name:'Bad',layout:source,config:{group:'missing'}}),/группу/);
 assert.throws(()=>createSceneRecord({name:'Bad',layout:{version:99},config:{}}),/layout/);
});
test('an existing scene is preserved until overwrite is explicit',()=>{
 const first=createSceneRecord({name:'A',layout:layout(),config:{brightness:25}}),next=createSceneRecord({name:'A',layout:layout(),config:{brightness:70}}),list=[first];
 assert.throws(()=>upsertSceneRecord(list,next),/уже существует/);assert.equal(list[0].config.brightness,25);
 const replaced=upsertSceneRecord(list,next,{replace:true});assert.equal(replaced.length,1);assert.equal(replaced[0].config.brightness,70);assert.equal(list[0],first);
});
