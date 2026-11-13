import test from 'node:test';
import assert from 'node:assert/strict';
import {EffectPreviewQueue} from '../shared/effect-preview-queue.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('hover pauses thumbnails and stale/offscreen work is cancelled',async()=>{
 const calls=[],q=new EffectPreviewQueue(async(method,args)=>{calls.push([method,args?.effectId]);return args;});
 q.setActive('wave');await tick();
 const abort=new AbortController(),cancelled=q.frame({effectId:'fire',animate:false},abort.signal).catch(e=>e.name);
 const pending=q.frame({effectId:'rainbow',animate:false});
 assert.equal((await q.frame({effectId:'wave',animate:true})).effectId,'wave');
 assert(!calls.some(([,id])=>id==='rainbow'));
 abort.abort();assert.equal(await cancelled,'AbortError');
 q.setActive(null);assert.equal((await pending).effectId,'rainbow');
 assert(!calls.some(([,id])=>id==='fire'));
 assert.equal(calls.filter(([method])=>method==='stop').length,2);
});
test('worker requests are serialized even when focus changes mid-frame',async()=>{
 let release;const calls=[];
 const q=new EffectPreviewQueue(async(method,args)=>{calls.push([method,args?.effectId]);if(args?.effectId==='one')await new Promise(r=>release=r);return args;});
 q.setActive('one');await tick();
 const first=q.frame({effectId:'one',animate:true});await tick();q.setActive('two');
 const next=q.frame({effectId:'two',animate:true});assert.deepEqual(calls,[['stop',undefined],['frame','one']]);
 release();await first;await next;
 assert.deepEqual(calls,[['stop',undefined],['frame','one'],['stop',undefined],['frame','two']]);
});
