import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {RuntimeConnection,runtimeEndpoint,isLoopbackAddress,receiveLines,authenticated,pipePath} from '../desktop/runtime-wire.mjs';

test('TCP descriptor always targets IPv4 loopback and cannot redirect its token',()=>{
 assert.deepEqual(runtimeEndpoint({version:2,port:43567,host:'203.0.113.10',pipe:'arbitrary'}),{host:'127.0.0.1',port:43567});
 for(const port of [undefined,null,0,-1,65536,'1234',1.5])assert.throws(()=>runtimeEndpoint({version:2,port}),/порт/);
 for(const address of ['127.0.0.1','::1','::ffff:127.0.0.1'])assert(isLoopbackAddress(address));
 for(const address of ['0.0.0.0','192.168.1.2','127.0.0.2','203.0.113.1',undefined])assert(!isLoopbackAddress(address));
});

test('legacy descriptors retain the deterministic named pipe for graceful upgrade shutdown',()=>{
 const pipe='lumen-runtime-0123456789abcdef01234567';assert.equal(runtimeEndpoint({version:1,pipe}),pipePath(pipe));
 assert.throws(()=>runtimeEndpoint({pipe:'\\\\remote-host\\pipe\\untrusted'}),/канал/);
});

test('authenticated loopback connection exchanges requests while ignoring descriptor host',async t=>{
 const token=randomBytes(32).toString('hex'),sockets=new Set();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});receiveLines(socket,message=>{if(!authenticated(message.token,token)){socket.destroy();return;}socket.write(JSON.stringify({id:message.id,result:{method:message.method,localAddress:socket.localAddress}})+'\n');});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const client=new RuntimeConnection();
 t.after(async()=>{client.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 await client.connect({version:2,port:server.address().port,host:'203.0.113.1',token});
 assert.deepEqual(await client.call('snapshot'),{method:'snapshot',localAddress:'127.0.0.1'});assert.equal(client.socket.remoteAddress,'127.0.0.1');
 const denied=new RuntimeConnection();await assert.rejects(denied.connect({version:2,port:server.address().port,token:'0'.repeat(64)}),/отключился/);denied.close();
});

test('unauthenticated line budget closes oversized input before parsing',()=>{
 const listeners=new Map(),socket={destroyed:false,on:(event,fn)=>listeners.set(event,fn),destroy(){this.destroyed=true;}};let received=false;
 receiveLines(socket,()=>{received=true;},{maxBytes:()=>4096});listeners.get('data')(Buffer.from('x'.repeat(4097)));assert(socket.destroyed);assert(!received);
});
