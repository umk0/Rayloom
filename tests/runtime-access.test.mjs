import test from 'node:test';
import assert from 'node:assert/strict';
import {changeRuntimeAccess,setBasicStartup} from '../desktop/runtime-access.mjs';

function fixture({elevated=true,settings={autoStart:true,elevatedStartup:true}}={}){
 const calls=[],runtime={ready:true,mode:'hardware',settings:{...settings}},hardware={elevated};let time=0;
 const f={calls,runtime,hardware,clock:0,commandResult:{ok:true},getRuntime:async()=>{calls.push('read');return structuredClone(runtime);},getHardware:async()=>({...hardware}),
 command:async(op,args)=>{calls.push([op,args]);if(f.commandResult.ok){if(op==='Register')Object.assign(runtime.settings,{autoStart:true,elevatedStartup:true});if(op==='Remove')Object.assign(runtime.settings,{autoStart:false,elevatedStartup:false});if(op==='StartOnce')hardware.elevated=true;}return f.commandResult;},
 shutdown:async()=>{calls.push('shutdown');runtime.ready=false;},reconnect:async args=>{calls.push(['reconnect',args]);runtime.ready=true;if(runtime.settings.elevatedStartup)hardware.elevated=true;},
 reload:async()=>{calls.push('reload');},onPhase:phase=>calls.push(['phase',phase]),sleep:async ms=>{time+=ms;f.onSleep?.();},now:()=>time,readyTimeoutMs:1000};
 return f;
}

test('repeated access request with confirmed privileges leaves playback and elevated autostart untouched',async()=>{
 const f=fixture(),before=structuredClone(f.runtime.settings);
 const result=await changeRuntimeAccess({...f,operation:'StartOnce'});
 assert.equal(result.hardware.elevated,true);assert.deepEqual(result.settings,before);
 assert.deepEqual(f.calls,['read']);
});
test('registering already confirmed elevated autostart is idempotent',async()=>{
 const f=fixture();await changeRuntimeAccess({...f,operation:'Register'});assert.deepEqual(f.calls,['read']);
});
test('registering startup for an already elevated owner never restarts playback',async()=>{
 const f=fixture({settings:{autoStart:false,elevatedStartup:false}});
 const result=await changeRuntimeAccess({...f,operation:'Register'});
 assert.equal(result.settings.autoStart,true);assert.equal(result.settings.elevatedStartup,true);
 assert(f.calls.some(c=>Array.isArray(c)&&c[0]==='Register'&&c[1].noStart===true));
 assert(!f.calls.includes('shutdown'));assert(!f.calls.some(c=>Array.isArray(c)&&c[0]==='reconnect'));
});
test('UAC cancellation leaves current owner running and does not change settings',async()=>{
 const f=fixture({elevated:false,settings:{autoStart:true,elevatedStartup:false}}),before=structuredClone(f.runtime.settings);
 f.commandResult={ok:false,cancelled:true,error:'Отменено пользователем'};
 await assert.rejects(changeRuntimeAccess({...f,operation:'StartOnce'}),/Отменено/);
 assert.deepEqual(f.runtime.settings,before);assert(!f.calls.includes('shutdown'));assert(!f.calls.some(c=>Array.isArray(c)&&c[0]==='reconnect'));
});
test('one-time elevation delegates restart after approval and never removes existing autostart',async()=>{
 const f=fixture({elevated:false});const before=structuredClone(f.runtime.settings);
 await changeRuntimeAccess({...f,operation:'StartOnce'});
 assert.deepEqual(f.runtime.settings,before);assert(!f.calls.includes('shutdown'));
 assert(f.calls.some(c=>Array.isArray(c)&&c[0]==='StartOnce'&&c[1].restart===true));
 assert(!f.calls.some(c=>Array.isArray(c)&&c[0]==='Remove'));
});
test('register grants startup before gracefully replacing an unelevated owner',async()=>{
 const f=fixture({elevated:false,settings:{autoStart:false}});
 const r=await changeRuntimeAccess({...f,operation:'Register'});
 assert.equal(r.hardware.elevated,true);
 const register=f.calls.findIndex(c=>Array.isArray(c)&&c[0]==='Register');
 assert(register<f.calls.indexOf('shutdown'));
 assert.deepEqual(f.calls.find(c=>Array.isArray(c)&&c[0]==='reconnect'),['reconnect',{launch:true}]);
});
test('confirmation waits for discovery and does not report ready before actual privilege confirmation',async()=>{
 const f=fixture({elevated:false,settings:{autoStart:false}});
 f.reconnect=async()=>{f.runtime.ready=false;};f.onSleep=()=>{f.runtime.ready=true;f.hardware.elevated=true;};
 const r=await changeRuntimeAccess({...f,operation:'StartOnce'});assert.equal(r.ready,true);assert.equal(r.hardware.elevated,true);
 assert(f.calls.some(c=>Array.isArray(c)&&c[0]==='phase'&&c[1]==='detecting'));
});
test('failed privilege confirmation is an error even when the launcher reported success',async()=>{
 const f=fixture({elevated:false,settings:{autoStart:false}});
 f.command=async()=>({ok:true});f.reconnect=async()=>{};
 await assert.rejects(changeRuntimeAccess({...f,operation:'StartOnce'}),/не подтверждён/);
});
test('unknown UAC outcome never launches a second owner or clears settings',async()=>{
 const f=fixture({elevated:false}),before=structuredClone(f.runtime.settings);
 f.commandResult={ok:false,outcomeUnknown:true,error:'Истекло время'};
 await assert.rejects(changeRuntimeAccess({...f,operation:'StartOnce'}),/Истекло время/);
 assert.deepEqual(f.runtime.settings,before);
 assert.deepEqual(f.calls.find(c=>Array.isArray(c)&&c[0]==='reconnect'),['reconnect',{launch:false}]);
 assert(!f.calls.includes('shutdown'));
});
test('turning off elevated startup keeps current access and playback',async()=>{
 const f=fixture();const r=await changeRuntimeAccess({...f,operation:'Remove'});
 assert.equal(r.settings.autoStart,false);assert.equal(r.hardware.elevated,true);assert(!f.calls.includes('shutdown'));
});
test('discovery confirmation is bounded and rejects virtual mode without mutations',async()=>{
 const f=fixture();f.runtime.ready=false;await assert.rejects(changeRuntimeAccess({...f,operation:'Register'}),/ещё ищет устройства/);
 const v=fixture();v.runtime.mode='virtual';await assert.rejects(changeRuntimeAccess({...v,operation:'StartOnce'}),/реальных устройств/);
 assert.deepEqual(v.calls,['read']);
});
test('ordinary startup cannot downgrade or overwrite an elevated registration',async()=>{
 const settings={autoStart:true,elevatedStartup:true,startupTaskName:'stable',other:'kept'};
 const execute=()=>assert.fail('registry must not be written'),write=()=>assert.fail('settings must not be written');
 const base={settings,mode:'hardware',platform:'win32',launcherExists:true,execute,write};
 assert.deepEqual(await setBasicStartup({...base,enabled:true}),settings);
 await assert.rejects(setBasicStartup({...base,enabled:false}),/окне настроек/);
});
test('ordinary startup commits settings only after success and retains unrelated settings',async()=>{
 const calls=[],base={settings:{autoStart:false,theme:'kept'},mode:'hardware',platform:'win32',launcherExists:true,execute:async value=>{calls.push(value);},write:async value=>{calls.push(value);}};
 const next=await setBasicStartup({...base,enabled:true});assert.deepEqual(next,{autoStart:true,theme:'kept'});
 assert.deepEqual(calls,[true,next]);
 await assert.rejects(setBasicStartup({...base,enabled:true,execute:async()=>{throw Error('access denied');},write:()=>assert.fail('must not save failed operation')}),/access denied/);
});
