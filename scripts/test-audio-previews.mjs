// Captures the existing Windows output stream, never a microphone by default.
// Does not play sound, save PCM, or connect to the user's lighting agent.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeEffectPreviews} from '../desktop/effect-previews.mjs';
const root=path.resolve(import.meta.dirname,'..'),service=new NativeEffectPreviews(root);
const report={physicalLightingTouched:false,generatedAudio:false,pcmSaved:false,effects:[]};
try{
 await service.frame({effectId:'AudioSync',animate:false});
 const audio=service.catalog.filter(e=>e.category==='Audio');assert.equal(audio.length,8);
 const defaultDevice=audio[0].audioDefaultDevice;report.defaultDevice=defaultDevice;
 assert(!['listening','silent'].includes((await service.rpc('audio.status',{deviceIndex:defaultDevice})).status),'a thumbnail must not capture audio');
 for(const effect of audio){
  let result=await service.frame({effectId:effect.id,animate:true});
  let peak=0,frames=0;
  for(let i=0;i<8;i++){await delay(100);result=await service.frame({effectId:effect.id,animate:true});assert.equal(result.source,'native');assert.equal(result.input.kind,'audio');assert(result.colors.every(c=>Number.isInteger(c)&&c>=0&&c<=0xffffff));peak=Math.max(peak,result.input.peak);frames=Math.max(frames,result.frame);}
  if(defaultDevice>=0)assert(['listening','silent'].includes(result.input.status),JSON.stringify(result.input));
  else assert.equal(result.input.status,'unavailable');
  const cached=await service.frame({effectId:effect.id,animate:false});assert.equal(cached.input.status,'idle');
  const wide=await service.frame({effectId:effect.id,animate:true,effectParameters:{['openrgb:'+effect.id]:{'native.CustomSettings.audio_settings.avg_mode':1,'native.CustomSettings.audio_settings.avg_size':256}}});assert.equal(wide.status,'ready');assert.equal(wide.settings.CustomSettings.audio_settings.avg_size,256);assert(wide.colors.every(c=>Number.isInteger(c)&&c>=0&&c<=0xffffff));
  await service.stop();assert(!['listening','silent'].includes((await service.rpc('audio.status',{deviceIndex:defaultDevice})).status),'stop releases capture immediately');
  report.effects.push({effect:effect.id,status:result.input.status,deviceName:result.input.deviceName,peak,frames});console.log('PASS',effect.id,result.input.status,peak);
 }
 report.liveSignalObserved=report.effects.some(e=>e.peak>.0001);report.passed=true;
}catch(error){report.error=error.stack;throw error;}
finally{await service.dispose();fs.writeFileSync(path.join(root,'artifacts','audio-previews-smoke.json'),JSON.stringify(report,null,2));}
