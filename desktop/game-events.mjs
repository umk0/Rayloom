import http from 'node:http';import {randomBytes,timingSafeEqual} from 'node:crypto';
export class GameEvents{
 constructor(studio){this.studio=studio;this.token=studio.read('game-auth',{}).token??randomBytes(24).toString('hex');studio.write('game-auth',{token:this.token});this.port=19421;this.lastEvent=null;this.server=null;}
 state(){return {enabled:!!this.server,port:this.port,lastEvent:this.lastEvent};}
 accept(event){if(!event||!['health','ammo'].includes(event.name)||!Number.isFinite(event.value)||event.value<0||event.value>1)throw Error('Event must be health/ammo in 0..1');this.studio.events[event.name]=event.value;this.lastEvent={name:event.name,value:event.value,time:Date.now()};return this.state();}
 authorized(token){return typeof token==='string'&&Buffer.byteLength(token)===Buffer.byteLength(this.token)&&timingSafeEqual(Buffer.from(token),Buffer.from(this.token));}
 async start(port=19421){if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');await this.stop();this.port=port;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.method!=='POST'||!['/events','/gsi'].includes(req.url)){res.writeHead(404).end('{}');return;}let body='',bytes=0;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>131072){req.destroy();return;}body+=chunk;});req.on('end',()=>{try{const value=JSON.parse(body);if(!this.authorized(value.token??value.auth?.token)){res.writeHead(401).end('{}');return;}if(req.url==='/events')this.accept(value.event);else{if(Number.isFinite(value.player?.state?.health))this.accept({name:'health',value:Math.max(0,Math.min(1,value.player.state.health/100))});const weapon=Object.values(value.player?.weapons??{}).find(w=>w.state==='active');if(weapon?.ammo_clip_max>0)this.accept({name:'ammo',value:Math.max(0,Math.min(1,weapon.ammo_clip/weapon.ammo_clip_max))});}res.writeHead(204).end();}catch{res.writeHead(400).end('{}');}});});
  server.requestTimeout=3000;server.headersTimeout=3000;server.maxConnections=8;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});server.on('error',()=>{});this.server=server;return this.state();
 }
 async stop(){const s=this.server;this.server=null;if(s){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}return this.state();}
 config(){return `"Rayloom game integration"\n{\n "uri" "http://127.0.0.1:${this.port}/gsi"\n "timeout" "3.0"\n "buffer" "0.1"\n "throttle" "0.1"\n "heartbeat" "30.0"\n "auth" { "token" "${this.token}" }\n "data" { "provider" "1" "player_id" "1" "player_state" "1" "player_weapons" "1" }\n}\n`;}
}
