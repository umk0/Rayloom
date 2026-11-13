import {CoreClient} from '../desktop/core-client.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..'),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-detection-'));
const core=new CoreClient(root,runtime,{virtual:false,allPlugins:process.argv.includes('--all-plugins')});
const report={runtime,appliedEffects:false,devices:[]};
try{report.status=await core.start();for(let i=0;i<120&&(report.status.detectionPercent<100||!report.status.pluginsReady);i++){await delay(500);report.status=await core.call('status');}report.plugins=await core.call('plugins.list');report.diagnostics=await core.call('diagnostics');report.devices=(await core.call('devices.list')).map(({name,vendor,ledCount,zones})=>({name,vendor,ledCount,zones}));console.log(JSON.stringify(report,null,2));}
catch(e){report.error=e.message;console.error(e.message);process.exitCode=1;}
finally{await core.stop();report.exitCode=core.exitCode;report.forcedKill=!!core.forcedKill;fs.writeFileSync(path.join(root,'artifacts/hardware-detection.json'),JSON.stringify(report,null,2));}
