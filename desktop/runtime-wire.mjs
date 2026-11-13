import net from 'node:net';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {timingSafeEqual} from 'node:crypto';

export const pipePath=name=>process.platform==='win32'?'\\\\.\\pipe\\'+name:name;
const LIMIT=2*1024*1024;
export const isLoopbackAddress=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
export function runtimeEndpoint(descriptor){
 if(descriptor?.port!==undefined||descriptor?.version>=2){
  if(!Number.isInteger(descriptor.port)||descriptor.port<1||descriptor.port>65535)throw Error('Недопустимый локальный порт движка');
  // A descriptor never decides which host receives the authentication token.
  return {host:'127.0.0.1',port:descriptor.port};
 }
 if(typeof descriptor?.pipe!=='string'||!/^(?:rayloom|lumen)-runtime-[a-f0-9]{24}$/.test(descriptor.pipe))throw Error('Недопустимый канал движка');
 return pipePath(descriptor.pipe);
}
export function receiveLines(socket,receive,{maxBytes=()=>LIMIT}={}){
 let buffer='';const decoder=new StringDecoder('utf8');
 socket.on('data',chunk=>{if(socket.destroyed)return;buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer,'utf8')>maxBytes()){socket.destroy();return;}let end;
  while(!socket.destroyed&&(end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{receive(JSON.parse(line));}catch{socket.destroy();return;}}
 });
}
export const authenticated=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class RuntimeConnection extends EventEmitter{
 constructor(){super();this.pending=new Map();this.sequence=0;}
 async connect(descriptor){
  if(typeof descriptor?.token!=='string'||! /^[a-f0-9]{64}$/i.test(descriptor.token))throw Error('Недопустимый ключ движка');
  const endpoint=runtimeEndpoint(descriptor);this.descriptor=descriptor;
  this.socket=await new Promise((resolve,reject)=>{const socket=net.connect(endpoint),timer=setTimeout(()=>{socket.destroy();reject(Error('Локальный движок не отвечает'));},2500);socket.once('error',error=>{clearTimeout(timer);socket.destroy();reject(error);});socket.once('connect',()=>{clearTimeout(timer);socket.setNoDelay(true);resolve(socket);});});
  this.socket.on('error',()=>{});this.socket.on('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Фоновый движок отключился'));}this.pending.clear();this.emit('disconnected');});
  receiveLines(this.socket,message=>{if(message.event){this.emit(message.event,message.value);return;}const p=this.pending.get(message.id);if(p){clearTimeout(p.timer);this.pending.delete(message.id);message.error?p.reject(Error(message.error)):p.resolve(message.result);}});
  try{await this.call('hello',{},2500);return this;}catch(error){this.close();throw error;}
 }
 call(method,args={},timeout=65000){
  if(!this.socket||this.socket.destroyed)return Promise.reject(Error('Фоновый движок недоступен'));
  const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Истекло время команды '+method));},timeout);this.pending.set(id,{resolve,reject,timer});this.socket.write(JSON.stringify({id,method,args,token:this.descriptor.token})+'\n');});
 }
 close(){this.socket?.destroy();}
}
