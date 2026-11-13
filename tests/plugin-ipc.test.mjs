import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the registered IPC handler, with no Electron process or real runtime.
const main=fs.readFileSync(new URL('../desktop/main.cjs',import.meta.url),'utf8');
const source=main.slice(main.indexOf('  const pluginIds='),main.indexOf("  ipcMain.handle('rayloom:studio'"));
function harness(){
  const calls=[];let invoke;
  vm.runInNewContext(source,{ipcMain:{handle:(name,handler)=>{assert.equal(name,'rayloom:plugin');invoke=handler;}},guard:()=>{},studio:{stop:async()=>{calls.push('stop');}},core:{call:async(method,args)=>{calls.push({method,args});return {ok:true};}}});
  return {invoke,calls};
}
test('theme save leaves the active lighting scene running',async()=>{
  const {invoke,calls}=harness();await invoke({},'skin','config.set',{config:{name:'My theme'}});
  assert.equal(calls.length,1);assert.equal(calls[0].args.plugin,'org.openrgb.openrgbskinplugin');
  assert.equal(calls[0].args.request.method,'config.set');
});
test('lighting plugin mutations still release the active scene first',async()=>{
  const {invoke,calls}=harness();await invoke({},'e131','start');
  assert.equal(calls[0],'stop');assert.equal(calls[1].args.request.method,'start');
});
test('plugin reads and invalid requests do not stop lighting',async()=>{
  const {invoke,calls}=harness();await invoke({},'scheduler','config.get');
  assert.equal(calls.length,1);assert.equal(calls[0].args.request.method,'config.get');
  await assert.rejects(invoke({},'unknown','start'),/Invalid plugin request/);
  await assert.rejects(invoke({},'skin','unknown'),/Invalid plugin request/);
  assert.equal(calls.length,1);
});
