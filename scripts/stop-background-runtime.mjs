// Graceful upgrade helper: connects to an existing owner only. Never starts a
// runtime/core, scans devices, deletes the descriptor, or forcibly kills a process.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {RuntimeConnection} from '../desktop/runtime-wire.mjs';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
function readDescriptor(file) {
  try {
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!value||typeof value!=='object')throw Error('Invalid descriptor');
    return value;
  } catch(error) {
    if(error.code==='ENOENT')return null;
    throw Error('Не удалось прочитать descriptor существующего агента; новый агент не запущен.');
  }
}
const sameInstance=(a,b)=>a&&b&&a.pid===b.pid&&a.token===b.token&&a.pipe===b.pipe&&a.port===b.port;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const text=value=>typeof value==='string'?value.slice(0,240):'';

export function discoverySummary(descriptor,hardware,snapshot,runtime) {
  return {
    version:1,collectedAt:new Date().toISOString(),reason:'before-graceful-elevated-restart',
    agentPid:number(descriptor.pid),corePid:number(runtime?.corePid),mode:text(snapshot.mode),
    hardware:{elevated:typeof hardware.elevated==='boolean'?hardware.elevated:null,
      smbusRequiresElevation:hardware.smbusRequiresElevation===true,detectionInProgress:hardware.detectionInProgress===true,
      i2cBusCount:number(hardware.i2cBusCount),i2cBuses:(hardware.i2cBuses??[]).map(bus=>({name:text(bus.name),busId:number(bus.busId),portId:number(bus.portId),pciVendor:number(bus.pciVendor),pciDevice:number(bus.pciDevice)}))},
    snapshot:{starting:snapshot.starting===true,hasError:Boolean(snapshot.error),
      deviceCount:(snapshot.devices??[]).length,pluginCount:(snapshot.plugins??[]).length,
      devices:(snapshot.devices??[]).map(device=>({name:text(device.name),vendor:text(device.vendor),type:number(device.type),
        ledCount:number(device.ledCount),zoneCount:number(device.zoneCount),
        zones:(device.zones??[]).map(zone=>({name:text(zone.name),type:number(zone.type),ledCount:number(zone.ledCount)}))}))}
  };
}

export async function stopBackgroundRuntime({dataDir,evidenceFile=path.join(root,'artifacts','elevated-discovery-before-restart.json'),shutdownTimeoutMs=15000,requestTimeoutMs=5000}={}) {
  if(typeof dataDir!=='string'||!path.isAbsolute(dataDir))throw Error('Требуется абсолютный --data путь.');
  if(!Number.isInteger(shutdownTimeoutMs)||shutdownTimeoutMs<1||shutdownTimeoutMs>15000)throw Error('Недопустимое время штатного завершения.');
  const descriptorFile=path.join(path.resolve(dataDir),'runtime.json'),descriptor=readDescriptor(descriptorFile);
  if(!descriptor)return {ok:true,stopped:false,alreadyStopped:true};
  const client=new RuntimeConnection();
  try {
    await client.connect(descriptor);
    // All three calls only read the already running agent/core. The whitelist
    // summary intentionally omits tokens, serials, USB paths and saved profiles.
    const [hardware,snapshot,runtime]=await Promise.all([
      client.call('core',{method:'hardware.status',params:{}},requestTimeoutMs),
      client.call('snapshot',{},requestTimeoutMs),client.call('runtime.state',{},requestTimeoutMs)
    ]);
    if(!sameInstance(descriptor,readDescriptor(descriptorFile)))throw Error('Экземпляр агента изменился во время диагностики; перезапуск отменён.');
    const summary=discoverySummary(descriptor,hardware,snapshot,runtime);
    fs.mkdirSync(path.dirname(evidenceFile),{recursive:true});
    const temporary=evidenceFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify(summary,null,2)+'\n');fs.renameSync(temporary,evidenceFile);
    let acknowledged=false;
    try {await client.call('shutdown',{},Math.min(requestTimeoutMs,3000));acknowledged=true;}catch{}
    const deadline=Date.now()+shutdownTimeoutMs;
    while(Date.now()<deadline) {
      const current=readDescriptor(descriptorFile);
      if(!current)return {ok:true,stopped:true,acknowledged,agentPid:descriptor.pid,corePid:summary.corePid,deviceCount:summary.snapshot.deviceCount,evidenceFile};
      if(!sameInstance(descriptor,current))throw Error('Запущен другой экземпляр агента; новый запуск отменён.');
      await delay(Math.min(100,Math.max(1,deadline-Date.now())));
    }
    throw Error('Агент не удалил свой descriptor за 15 секунд после команды shutdown. Принудительное завершение и новый запуск не выполнялись.');
  } finally {client.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2),index=args.indexOf('--data');
  try {
    if(index!==0||args.length!==2)throw Error('Использование: node scripts/stop-background-runtime.mjs --data <absolute path>');
    console.log(JSON.stringify(await stopBackgroundRuntime({dataDir:args[1]})));
  } catch(error) {console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
