import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {receiveLines,authenticated,pipePath} from '../desktop/runtime-wire.mjs';
import {stopBackgroundRuntime} from '../scripts/stop-background-runtime.mjs';

async function fixture(t,{legacy=false,removeDescriptor=true,replaceDescriptor=false}={}) {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-graceful-stop-'));
  const descriptorFile=path.join(dataDir,'runtime.json'),evidenceFile=path.join(dataDir,'evidence.json');
  const token=randomBytes(32).toString('hex'),pipe='lumen-runtime-'+randomBytes(12).toString('hex');
  const sockets=new Set(),methods=[];
  let descriptor;
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('error',()=>{});
    receiveLines(socket,message=>{
      if(!authenticated(message.token,token)){socket.destroy();return;}
      methods.push(message.method);
      let result={};
      if(message.method==='hello')result={pid:12345};
      if(message.method==='core') {assert.equal(message.args.method,'hardware.status');result={elevated:true,smbusRequiresElevation:true,detectionInProgress:false,i2cBusCount:1,i2cBuses:[{name:'AMD SMBus',busId:0,portId:0,pciVendor:0x1022,pciDevice:0x790b}]};}
      if(message.method==='snapshot') {
        result={mode:'hardware',devices:[{name:'ADATA DRAM',vendor:'ADATA',serial:'SENSITIVE-SERIAL',location:'SENSITIVE-USB-PATH',type:1,ledCount:8,zoneCount:1,zones:[{name:'RAM',type:1,ledCount:8}]}],plugins:[]};
        if(replaceDescriptor)fs.writeFileSync(descriptorFile,JSON.stringify({...descriptor,pid:23456,token:randomBytes(32).toString('hex')}));
      }
      if(message.method==='runtime.state')result={pid:12345,corePid:54321,settings:{secret:token}};
      if(message.method==='shutdown')result=true;
      socket.write(JSON.stringify({id:message.id,result})+'\n');
      if(message.method==='shutdown'&&removeDescriptor)fs.unlinkSync(descriptorFile);
    });
  });
  await new Promise(resolve=>legacy?server.listen(pipePath(pipe),resolve):server.listen(0,'127.0.0.1',resolve));
  descriptor={version:legacy?1:2,pipe,token,pid:12345,...(legacy?{}:{port:server.address().port})};
  fs.writeFileSync(descriptorFile,JSON.stringify(descriptor));
  t.after(async()=>{
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
    for(const name of ['runtime.json','evidence.json','evidence.json.tmp']){const file=path.join(dataDir,name);if(fs.existsSync(file))fs.unlinkSync(file);}
    fs.rmdirSync(dataDir);
  });
  return {dataDir,evidenceFile,descriptorFile,methods,token};
}

test('graceful stop captures existing discovery without credentials/serials, then waits for owner cleanup',async t=>{
  const f=await fixture(t);const result=await stopBackgroundRuntime(f);
  assert.equal(result.stopped,true);assert.equal(result.corePid,54321);
  assert.equal(fs.existsSync(f.descriptorFile),false);
  const raw=fs.readFileSync(f.evidenceFile,'utf8'),evidence=JSON.parse(raw);
  assert.equal(evidence.hardware.elevated,true);assert.equal(evidence.snapshot.devices[0].name,'ADATA DRAM');
  for(const secret of [f.token,'SENSITIVE-SERIAL','SENSITIVE-USB-PATH'])assert.equal(raw.includes(secret),false);
  assert.deepEqual(f.methods,['hello','core','snapshot','runtime.state','shutdown']);
});
test('legacy pipe runtime remains reachable for graceful transport upgrade',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t,{legacy:true});assert.equal((await stopBackgroundRuntime(f)).stopped,true);
});
test('unremoved descriptor prevents success and remains untouched after bounded wait',async t=>{
  const f=await fixture(t,{removeDescriptor:false});
  await assert.rejects(stopBackgroundRuntime({...f,shutdownTimeoutMs:50}),/Принудительное завершение/);
  assert.equal(fs.existsSync(f.descriptorFile),true);assert.equal(f.methods.filter(m=>m==='shutdown').length,1);
});
test('replacement runtime is never stopped by an outdated connection',async t=>{
  const f=await fixture(t,{replaceDescriptor:true});
  await assert.rejects(stopBackgroundRuntime(f),/Экземпляр агента изменился/);
  assert.equal(f.methods.includes('shutdown'),false);assert.equal(fs.existsSync(f.evidenceFile),false);
});
