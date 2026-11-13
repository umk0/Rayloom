import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {setTimeout as delay} from 'node:timers/promises';

export class CoreClient {
  pending = new Map(); sequence = 0; buffer = ''; exited = false; decoder = new StringDecoder('utf8');
  constructor(root, runtime, {virtual = true, originalPlugin = false, allPlugins = true, preview = false} = {}) {
    this.root = root; this.runtime = runtime; this.virtual = preview || virtual; this.preview = preview;
    this.originalPlugin = originalPlugin;
    this.allPlugins = allPlugins && !originalPlugin && !preview;
    this.pipe = `rayloom-${randomUUID()}`; this.token = randomUUID();
  }
  async start() {
    fs.mkdirSync(path.join(this.runtime, 'plugins'), {recursive:true});
    fs.mkdirSync(path.join(this.runtime, 'plugins','settings','effect-profiles'), {recursive:true});
    const upgraded=path.join(this.root,'plugins','effects','release','RayloomEffectsPlugin.dll');
    const source = this.originalPlugin ? path.join(this.root, 'downloads', 'OpenRGBEffectsPlugin.dll') : fs.existsSync(upgraded)?upgraded:path.join(this.root, 'plugins','effects','release','OpenRGBEffectsPlugin.dll');
    if (!fs.existsSync(source)) throw new Error('Effects Plugin DLL is missing; run the dependency bootstrap.');
    fs.copyFileSync(source, path.join(this.runtime,'plugins','OpenRGBEffectsPlugin.dll'));
    if(this.allPlugins)for(const dir of ['scheduler','http-hook','e131','hardware-sync','visual-map','skin']){
      const release=path.join(this.root,'plugins',dir,'release');
      const binaries=fs.existsSync(release)?fs.readdirSync(release).filter(n=>/^OpenRGB.*Plugin\.dll$/.test(n)):[];
      if(!binaries.length)throw new Error(`Native plugin ${dir} is not built; run scripts/build-plugin.cmd ${dir}.`);
      for(const name of binaries)fs.copyFileSync(path.join(release,name),path.join(this.runtime,'plugins',name));
    }
    const executable = path.join(this.root,'core','release','Rayloom-Core.exe');
    if (!fs.existsSync(executable)) throw new Error('Native core is not built. Run scripts/build-core.cmd.');
    const wrapper=path.join(this.root,'downloads','lhwm-wrapper.dll');
    if(this.allPlugins&&!this.virtual&&fs.existsSync(wrapper))fs.copyFileSync(wrapper,path.join(path.dirname(executable),'lhwm-wrapper.dll'));
    this.log = fs.openSync(path.join(this.runtime,'core.log'),'w');
    this.child = spawn(executable, ['--gui','--noautoconnect',...(this.virtual ? ['--nodetect'] : []),'--config',this.runtime,'--loglevel','6'], {
      cwd:path.dirname(executable), windowsHide:true, stdio:['ignore',this.log,this.log],
      env:{...process.env,RAYLOOM_CORE_PIPE:this.pipe,RAYLOOM_CORE_TOKEN:this.token,RAYLOOM_VIRTUAL_DEVICE:this.virtual?'1':'0',RAYLOOM_EFFECT_PREVIEW:this.preview?'1':'0'}
    });
    this.child.once('error', e => {this.failure=e;this.exited=true;this.rejectAll(e);});
    this.child.once('exit', (code,signal) => {this.exited=true;this.exitCode=code;this.exitSignal=signal;this.failure=new Error(`Native core exited (${code ?? signal}); see ${this.runtime}/core.log`);this.rejectAll(this.failure);});
    const deadline = Date.now()+60000;
    while(Date.now()<deadline && !this.exited) {
      try {
        this.socket = await new Promise((resolve,reject) => {
          const socket=net.connect(`\\\\.\\pipe\\${this.pipe}`);
          socket.once('connect',()=>{socket.removeListener('error',reject);resolve(socket);});
          socket.once('error',reject);
        });
        this.socket.on('data', chunk=>this.receive(chunk));
        this.socket.on('error',e=>this.rejectAll(e));
        this.socket.on('close',()=>this.rejectAll(new Error('Native core disconnected')));
        return await this.call('status');
      } catch(e) { if(this.socket) throw e; await delay(150); }
    }
    throw this.failure ?? new Error('Native core startup timed out');
  }
  receive(chunk) {
    this.buffer+=this.decoder.write(chunk);
    if(this.buffer.length>8*1024*1024){this.socket.destroy();return;}
    let end;
    while((end=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);
      try {const response=JSON.parse(line);const p=this.pending.get(response.id);
        if(p){clearTimeout(p.timer);this.pending.delete(response.id);response.error?p.reject(new Error(response.error)):p.resolve(response.result);}
      } catch(e){this.rejectAll(e);}
    }
  }
  call(method, params={}) {
    if(!this.socket || this.socket.destroyed) return Promise.reject(new Error('Native core is offline'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Core request timed out: ${method}`));},15000);
      this.pending.set(id,{resolve,reject,timer});
      this.socket.write(JSON.stringify({...params,id,method,token:this.token})+'\n');
    });
  }
  rejectAll(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  async stop(){
    if(this.child && !this.exited){
      try{await this.call('shutdown');}catch{}
      for(let i=0;i<30&&!this.exited;i++)await delay(100);
      if(!this.exited){this.forcedKill=true;this.child.kill();for(let i=0;i<20&&!this.exited;i++)await delay(50);}
    }
    this.socket?.destroy();
    if(this.log!==undefined){fs.closeSync(this.log);this.log=undefined;}
  }
}
