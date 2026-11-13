import {CoreClient} from '../desktop/core-client.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'..'),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-persistence-'));
const report={runtime,physicalHardwareTested:false,checks:[],exits:[]};
let core;
const rpc=(id,method,params={})=>core.call('plugin.rpc',{plugin:`org.openrgb.openrgb${id}plugin`,request:{method,...params}});
const check=name=>{report.checks.push(name);console.log('PASS',name);};
try{
 for(let pass=0;pass<2;pass++){
  core=new CoreClient(root,runtime);await core.start();
  if(!pass){
   await rpc('scheduler','config.set',{tasks:[{name:'Saved early',cron_line:'0 0 20 * * ?',action:0,sub_action:'',run:false}]});
   await delay(2200);assert.equal((await rpc('scheduler','config.get')).tasks.length,1);check('early scheduler save is not duplicated by delayed startup');
   await rpc('hardwaresync','config.set',{measures:[{name:'Persistent sensor',hardware:0,hardware_feature:0,fps:30,refresh_interval:100,brightness:70,running:false,devices:[],measure_color:{color_stops:[[0,255],[100,16711680]]}}]});
   await rpc('skin','config.set',{config:{name:'Persistent theme',accent:'#abcdef',background:'#101113',panel:'#191a1e',text:'#eeeeee',load_at_startup:true}});
   const gradient={type:'Linear',spread:'Pad',rotate:0,x_offset:100,y_offset:100,colors:[{position:0,color:'#ff0000'},{position:1,color:'#0000ff'}]};
   await rpc('visualmap','gradient.save',{name:'persistent-gradient',gradient});assert.deepEqual(await rpc('visualmap','gradient.read',{name:'persistent-gradient'}),gradient);check('Visual Map gradients save in original format');
   for(let i=0;i<5;i++){await rpc('e131receiver','start');await rpc('e131receiver','stop');}check('immediate E1.31 start/stop does not hang');
   await rpc('e131receiver','start');await rpc('visualmap','register',{index:0,enabled:true});await delay(400);assert.equal((await core.call('devices.list')).length,2);assert((await rpc('e131receiver','config.get')).running);await rpc('visualmap','register',{index:0,enabled:false});await delay(400);await rpc('e131receiver','stop');assert.equal((await core.call('devices.list')).length,1);check('E1.31 survives virtual controller add/remove');
  }else{
   await delay(2200);assert.equal((await rpc('scheduler','config.get')).tasks.length,1);
   const hw=await rpc('hardwaresync','config.get');assert.equal(hw.measures.length,1);assert.equal(hw.measures[0].name,'Persistent sensor');assert.equal(hw.measures[0].brightness,70);
   assert.equal((await rpc('skin','config.get')).accent,'#abcdef');assert((await rpc('visualmap','config.get')).gradients.includes('persistent-gradient'));check('settings restored after clean native restart');
  }
  await core.stop();report.exits.push(core.exitCode);assert.equal(core.exitCode,0);assert(!core.forcedKill);
 }
}finally{await core?.stop();fs.writeFileSync(path.join(root,'artifacts/persistence-smoke.json'),JSON.stringify(report,null,2));}
