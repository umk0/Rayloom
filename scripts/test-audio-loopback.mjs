// Explicit opt-in: plays one quiet generated test tone through the existing
// system output. Does not change system volume or record the user's audio.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeEffectPreviews} from '../desktop/effect-previews.mjs';
if(!process.argv.includes('--tone'))throw Error('Pass --tone only after announcing the 1.5-second quiet audio test');
const root=path.resolve(import.meta.dirname,'..'),service=new NativeEffectPreviews(root);
const output=path.join(root,'artifacts','audio-loopback-fixture.wav');
const rate=48000,duration=1.5,count=rate*duration,amplitude=10**(-26/20),wav=Buffer.alloc(44+count*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++){const t=i/rate,ramp=Math.min(1,t/.1,(duration-t)/.1);wav.writeInt16LE(Math.round(32767*amplitude*ramp*Math.sin(2*Math.PI*440*t)),44+i*2);}
fs.writeFileSync(output,wav);
const report={physicalLightingTouched:false,systemVolumeChanged:false,generatedTone:{seconds:duration,amplitudeDb:-26,frequencyHz:440,rampSeconds:.1},samples:[]};
// The intentionally quiet tone needs sensitivity above the upstream noise gate.
// This is a normal saved effect parameter, not a replacement signal or FFT.
const request={effectId:'AudioSync',animate:true,effectParameters:{'openrgb:AudioSync':{'native.CustomSettings.audio_settings.amplitude':1000}}};
report.effectAmplitude=1000;
let player;
try{
 await service.frame(request);await delay(150);
 const baseline=await service.frame(request);assert.equal(baseline.settings.CustomSettings.audio_settings.amplitude,1000);
 const devicesBefore=await service.core.call('devices.list');
 player=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','play-audio-fixture.ps1'),'-FixturePath',output],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stderr='';player.stderr.on('data',data=>stderr+=data);
 const completion=new Promise((resolve,reject)=>{player.once('error',reject);player.once('exit',code=>code===0?resolve():reject(Error(stderr||'Tone playback failed: '+code)));});
 for(let i=0;i<65;i++){await delay(40);const frame=await service.frame(request);report.samples.push({peak:frame.input.peak,status:frame.input.status,frame:frame.frame,changed:frame.colors.some((color,index)=>color!==baseline.colors[index]),lit:frame.colors.filter(Boolean).length});}
 await completion;
 assert(report.samples.some(s=>s.peak>.001&&s.status==='listening'),'must capture the actual played signal');
 assert(report.samples.some(s=>s.peak>.001&&s.changed),'actual audio changes the native effect frame');
 await delay(150);const after=await service.frame(request);assert.equal(after.input.status,'silent');
 await service.stop();const stopped=await service.rpc('audio.status',{deviceIndex:after.input.deviceIndex});assert(!['listening','silent'].includes(stopped.status));
 assert.deepEqual(await service.core.call('devices.list'),devicesBefore,'registered virtual devices remain untouched by private preview fixture');
 report.peak=Math.max(...report.samples.map(s=>s.peak));report.changedFrames=report.samples.filter(s=>s.changed&&s.peak>.001).length;report.stoppedStatus=stopped.status;report.passed=true;
 console.log(JSON.stringify({passed:true,peak:report.peak,changedFrames:report.changedFrames,stoppedStatus:report.stoppedStatus}));
}catch(error){report.error=error.stack;throw error;}
finally{if(player&&player.exitCode===null)player.kill();await service.dispose();fs.writeFileSync(path.join(root,'artifacts','audio-loopback-smoke.json'),JSON.stringify(report,null,2));}
