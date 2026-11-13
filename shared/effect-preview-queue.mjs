// A single native preview worker is shared by the whole gallery. Hovered cards
// take priority over thumbnails; aborted/offscreen cards never keep work queued.
export class EffectPreviewQueue {
 constructor(invoke){this.invoke=invoke;this.queue=[];this.active=null;this.busy=false;this.stopPending=false;}
 setActive(id){
  if(this.active===id)return;
  this.active=id;this.stopPending=true;
  for(const item of [...this.queue])if(item.args.animate&&item.args.effectId!==id)item.cancel();
  void this.pump();
 }
 frame(args,signal){
  return new Promise((resolve,reject)=>{
   const item={args,resolve,reject,signal,cancelled:false,cancel:()=>{
    if(item.cancelled)return;item.cancelled=true;
    this.queue=this.queue.filter(q=>q!==item);reject(new DOMException('Preview cancelled','AbortError'));
    signal?.removeEventListener('abort',item.cancel);
   }};
   if(signal?.aborted){item.cancel();return;}
   signal?.addEventListener('abort',item.cancel,{once:true});this.queue.push(item);void this.pump();
  });
 }
 async pump(){
  if(this.busy)return;this.busy=true;
  try{
   while(true){
    if(this.stopPending){this.stopPending=false;try{await this.invoke('stop');}catch{}continue;}
    const index=this.queue.findIndex(item=>this.active?item.args.animate&&item.args.effectId===this.active:!item.args.animate);
    if(index<0)break;
    const [item]=this.queue.splice(index,1);
    try{
     if(item.cancelled)continue;
     const result=await this.invoke('frame',item.args);
     if(!item.cancelled)item.resolve(result);
    }catch(error){if(!item.cancelled)item.reject(error);}
    finally{item.signal?.removeEventListener('abort',item.cancel);}
   }
  }finally{this.busy=false;}
 }
}
