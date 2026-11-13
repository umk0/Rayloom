type Rpc=(method:string,args?:any)=>Promise<any>;
type Snapshot={data:any;index:number;selected:number;dirty:Set<number>;conflicts:Set<number>;structureConflict:boolean;busy:boolean;structural:boolean;error:string;message:string;background:any;gradientName:string;assetBusy:string};
const sameMap=(a:any,b:any)=>JSON.stringify(a&&{name:a.name,map:a.map})===JSON.stringify(b&&{name:b.name,map:b.map});
const message=(error:unknown)=>String(error instanceof Error?error.message:error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');

export function normalizeMapGradient(value:any){
 const type=String(value?.type??'').toLowerCase(),colors=value?.colors;
 if(!['linear','radial','conical'].includes(type)||!Array.isArray(colors)||colors.length<2||colors.length>64||colors.some(c=>!/^#[0-9a-f]{6}$/i.test(c?.color)||!Number.isFinite(c.position)||c.position<0||c.position>1))throw Error('Этот файл не содержит корректный градиент. Текущие цвета сохранены.');
 const number=(v:any,fallback:number,min:number,max:number)=>Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
 const spread=typeof value.spread==='string'?['Pad','Repeat','Reflect'].indexOf(value.spread):value.spread;
 return {...value,type,colors:colors.map(c=>({...c})),spread:number(spread,0,0,2),angle:number(value.angle??value.rotate,0,-360,360),x:number(value.x??value.x_offset/100,1,0,2),y:number(value.y??value.y_offset/100,1,0,2),brightness:number(value.brightness,100,0,100)};
}

/** Session drafts survive navigation, never cross hardware/virtual boundaries.
 * The session owns pending requests too, so an unmounted editor cannot clear a
 * newer editor's draft. Map indices are the native plugin's public identity. */
export class VisualMapSession {
 private listeners=new Set<()=>void>();
 private baseline:any[]=[];
 private assetRevision=0;
 private snapshot:Snapshot={data:null,index:0,selected:0,dirty:new Set(),conflicts:new Set(),structureConflict:false,busy:false,structural:false,error:'',message:'',background:{type:'linear',angle:0,spread:0,x:1,y:1,colors:[{position:0,color:'#7568ff'},{position:1,color:'#b4f17b'}]},gradientName:'Мой градиент',assetBusy:''};
 getSnapshot=()=>this.snapshot;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(patch:Partial<Snapshot>){this.snapshot={...this.snapshot,...patch};this.listeners.forEach(listener=>listener());}
 select(index:number){if(!this.snapshot.data?.maps[index])return;this.publish({index,selected:0});}
 selectZone(selected:number){this.publish({selected});}
 editMap(index:number,value:any){
  const {data,structural}=this.snapshot;if(structural||!data?.maps[index])return;
  const dirty=new Set(this.snapshot.dirty);if(sameMap(value,this.baseline[index]))dirty.delete(index);else dirty.add(index);
  this.publish({data:{...data,maps:data.maps.map((map:any,i:number)=>i===index?value:map)},dirty,message:''});
 }
 resolve(index:number,keep:boolean){
  const {data}=this.snapshot;if(this.snapshot.busy||this.snapshot.structureConflict||!data?.maps[index])return;
  const conflicts=new Set(this.snapshot.conflicts);conflicts.delete(index);
  if(keep){this.publish({conflicts,error:''});return;}
  const dirty=new Set(this.snapshot.dirty);dirty.delete(index);
  const maps=data.maps.map((map:any,i:number)=>i===index?this.baseline[i]:map);
  this.publish({data:{...data,maps},dirty,conflicts,index:Math.max(0,Math.min(this.snapshot.index,maps.length-1)),selected:0,error:''});
 }
 discardMapDrafts(){
  if(this.snapshot.busy)return;
  this.publish({data:{...this.snapshot.data,maps:this.baseline},dirty:new Set(),conflicts:new Set(),structureConflict:false,index:Math.max(0,Math.min(this.snapshot.index,this.baseline.length-1)),selected:0,error:''});
 }
 editBackground(value:any){this.publish({background:value,message:''});}
 nameGradient(gradientName:string){this.publish({gradientName});}
 preset(value:any){++this.assetRevision;this.publish({background:normalizeMapGradient(value),assetBusy:'',message:'',error:''});}
 async gradient(name:string,rpc:Rpc){
  const revision=++this.assetRevision,background=this.snapshot.background,gradientName=this.snapshot.gradientName;
  this.publish({assetBusy:'gradient',error:'',message:''});
  try{
   const value=await rpc('gradient.read',{name});if(revision!==this.assetRevision)return;
   if(this.snapshot.background!==background){this.publish({message:'Новые правки градиента сохранены. Чтобы заменить их файлом, выберите его ещё раз.'});return;}
   this.publish({background:normalizeMapGradient(value),gradientName:this.snapshot.gradientName===gradientName?name:this.snapshot.gradientName});
  }catch(error){if(revision===this.assetRevision)this.publish({error:message(error)});}
  finally{if(revision===this.assetRevision)this.publish({assetBusy:''});}
 }
 async image(pick:()=>Promise<string|null>){
  const revision=++this.assetRevision,background=this.snapshot.background;
  this.publish({assetBusy:'image',error:'',message:''});
  try{
   const path=await pick();if(revision!==this.assetRevision||!path||this.snapshot.background.type!=='image')return;
   // Preserve brightness/offset edits made while the file dialog was open.
   if(this.snapshot.background.path===background.path)this.publish({background:{...this.snapshot.background,path}});
  }catch(error){if(revision===this.assetRevision)this.publish({error:message(error)});}
  finally{if(revision===this.assetRevision)this.publish({assetBusy:''});}
 }
 async request(method:string,args:any={},rpc:Rpc){
  const before=this.snapshot,structural=['add','load','delete'].includes(method);
  if(before.busy)return false;
  if(before.structureConflict&&!['config.get','gradient.save'].includes(method)){this.publish({error:'Список карт изменился вне редактора. Загрузите актуальный список, прежде чем применять карту.'});return false;}
  if(structural&&before.dirty.size){this.publish({error:'Сначала сохраните или отмените правки карт.'});return false;}
  if(['register','background'].includes(method)&&before.dirty.has(args.index)){this.publish({error:'Сначала сохраните правки выбранной карты.'});return false;}
  if(['map.set','register','background'].includes(method)&&before.conflicts.has(args.index)){this.publish({error:'Карта изменилась вне редактора. Сначала выберите, какие правки оставить.'});return false;}
  if(method==='map.set'&&!String(args.name??'').trim()){this.publish({error:'Введите название карты.'});return false;}
  this.publish({busy:true,structural,error:'',message:''});
  try{
   const result=await rpc(method,args);
   if(!result||!Array.isArray(result.maps)||!Array.isArray(result.saved))throw Error('Движок не подтвердил состояние карт. Правки сохранены в редакторе.');
   if(method==='map.set'&&result.maps[args.index]?.name!==args.name)throw Error('Движок не подтвердил сохранение выбранной карты. Черновик сохранён в редакторе.');
   const local=this.snapshot,dirty=new Set<number>(),conflicts=new Set<number>();
   const ownedIndex=method==='map.set'?args.index:-1;
   const ambiguousIndices=this.baseline.some((map,index)=>{
    if(index===ownedIndex)return false;
    const remote=result.maps[index];
    if(!remote||remote.name!==map.name)return true;
    if(sameMap(remote,map))return false;
    // Equal list length does not mean equal identities: a native delete/add
    // can shift every index. Duplicate names also cannot establish identity.
    return this.baseline.some((other,i)=>i!==index&&other.name===map.name)||result.maps.some((other:any,i:number)=>i!==index&&sameMap(other,map));
   });
   if(!structural&&local.dirty.size&&(result.maps.length!==local.data.maps.length||ambiguousIndices)){
    // Native map indices changed; never attach a draft to a different map.
    this.baseline=result.maps;
    this.publish({data:{...result,maps:local.data.maps},structureConflict:true,conflicts:new Set(local.dirty),message:'Список карт изменился. Черновики оставлены в редакторе.'});return true;
   }
   const maps=result.maps.map((map:any)=>map);
   if(!structural&&local.data)for(const index of local.dirty){
    const draft=local.data.maps[index],saved=method==='map.set'&&index===args.index&&sameMap(draft,before.data?.maps[index]);
    if(saved||sameMap(draft,maps[index]))continue;
    if(!sameMap(maps[index],this.baseline[index])&&!(method==='map.set'&&index===args.index))conflicts.add(index);
    else if(local.conflicts.has(index))conflicts.add(index);
    maps[index]=draft;dirty.add(index);
   }
   this.baseline=result.maps;
   let index=local.index;
   if(method==='add'||method==='load')index=result.maps.length-1;
   if(method==='delete')index=local.index>args.index?local.index-1:Math.min(local.index,result.maps.length-1);
   this.publish({data:{...result,maps},index:Math.max(0,Math.min(index,maps.length-1)),selected:structural?0:local.selected,dirty,conflicts,structureConflict:local.structureConflict&&dirty.size>0,message:method==='map.set'?(dirty.has(args.index)?'Версия карты сохранена. Более новые правки ещё не сохранены.':'Карта сохранена.'):method==='gradient.save'?'Градиент сохранён.':method==='background'?'Фон отправлен на карту.':''});
   return true;
  }catch(error){this.publish({error:message(error)});return false;}
  finally{this.publish({busy:false,structural:false});}
 }
}

const sessions=new Map<string,VisualMapSession>();
export function visualMapSession(scope:string){let session=sessions.get(scope);if(!session){session=new VisualMapSession();sessions.set(scope,session);}return session;}
