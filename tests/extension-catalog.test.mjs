import test from 'node:test';
import assert from 'node:assert/strict';
import {builtInExtensions,nativeExtensionState,matchesExtension} from '../shared/extension-catalog.mjs';

test('native catalog gates actions until a plugin really loads',()=>{
  const extension=builtInExtensions[0];
  assert.equal(nativeExtensionState(extension,{starting:true}).available,false);
  const snapshot={status:{pluginsReady:true},plugins:[]};
  assert.equal(nativeExtensionState(extension,snapshot).label,'Недоступно');
  snapshot.plugins.push({id:extension.nativeId,loaded:true,version:'1.1'});
  assert.equal(nativeExtensionState(extension,snapshot).available,true);
  snapshot.plugins[0].incompatible=true;
  assert.equal(nativeExtensionState(extension,snapshot).label,'Несовместимо');
  snapshot.error='disconnected';
  assert.equal(nativeExtensionState(extension,snapshot).label,'Нет связи');
});

test('all seven native modules are reachable, including theme',()=>{
  assert.equal(builtInExtensions.length,7);
  assert.equal(new Set(builtInExtensions.map(p=>p.id)).size,7);
  assert.equal(new Set(builtInExtensions.map(p=>p.nativeId)).size,7);
  assert.ok(builtInExtensions.find(p=>p.id==='skin'));
});

test('search includes author and individual effect names across terms',()=>{
  assert.ok(matchesExtension('  RAYLOOM   север ', 'Aurora pack','Rayloom','Северное сияние'));
  assert.ok(matchesExtension('   ', 'anything'));
  assert.equal(matchesExtension('schedule','Aurora pack'),false);
});
