import {CoreClient} from '../desktop/core-client.mjs';
import {effectProfile,effectsId} from '../desktop/effects.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-smoke-'));
const client=new CoreClient(root,runtime,{originalPlugin:true});
const report={runtime,startedAt:new Date().toISOString(),physicalHardwareTested:false};
try {
  report.core=await client.start();
  report.plugins=await client.call('plugins.list');
  const plugin=report.plugins.find(p=>p.id===effectsId);
  assert(plugin?.loaded,'Original Effects Plugin must load');
  assert.equal(plugin.api,5);
  const devices=await client.call('devices.list');assert.equal(devices.length,1);
  assert.equal(devices[0].location,'Rayloom:virtual');
  report.initialColors=devices[0].colors;
  const profile=effectProfile({devices});
  report.profile=await client.call('plugin.profile.set',{plugin:effectsId,profile});
  assert.equal(report.profile.Effects[0].EffectClassName,'RainbowWave');
  await delay(400);
  const first=(await client.call('devices.list'))[0].colors;
  await delay(400);
  const second=(await client.call('devices.list'))[0].colors;
  assert(first.some(c=>c!==0),'Effect must write nonzero colors');
  assert.notDeepEqual(first,second,'Effect must animate');
  report.frames=[first,second];
  await client.call('plugin.action',{plugin:effectsId,action:'OpenRGBEffectsPlugin::Action::StopAll'});
  await delay(150);const stopped=(await client.call('devices.list'))[0].colors;
  await delay(200);assert.deepEqual((await client.call('devices.list'))[0].colors,stopped);
  report.animationVerified=true;report.stopVerified=true;report.passed=true;
  report.additionalEffects=[];
  for(const effect of ['Breathing','SpectrumCycling']){
    const applied=await client.call('plugin.profile.set',{plugin:effectsId,profile:effectProfile({effect,devices})});
    assert.equal(applied.Effects[0].EffectClassName,effect);
    await delay(350);const a=(await client.call('devices.list'))[0].colors;
    await delay(350);const b=(await client.call('devices.list'))[0].colors;
    assert(b.some(c=>c!==0),`${effect} must write colors`);
    assert.notDeepEqual(a,b,`${effect} must animate`);
    report.additionalEffects.push({effect,animated:true});
  }
  await client.call('plugin.action',{plugin:effectsId,action:'OpenRGBEffectsPlugin::Action::StopAll'});
  await assert.rejects(client.call('plugin.window',{plugin:'missing.plugin'}),/Plugin not found/);
  await assert.rejects(client.call('unknown.method'),/Unknown method/);
  report.invalidRequestsRejected=true;
} catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally {
  await client.stop();report.coreExited=client.exited;report.exitCode=client.exitCode;report.forcedKill=!!client.forcedKill;if(client.exitCode!==0||client.forcedKill){report.passed=false;process.exitCode=1;}
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  fs.writeFileSync(path.join(root,'artifacts','core-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,core:report.core,plugins:report.plugins,error:report.error,runtime},null,2));
}
