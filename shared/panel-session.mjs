const copy=value=>structuredClone(value);
const scopes=new Set(['hardware','virtual']);
const keys={scheduler:['tasks'],'http-hook':['config'],e131:['config'],'hardware-sync':['measures'],skin:['name','accent','background','panel','text','load_at_startup']};
const editable=(id,value)=>Object.fromEntries((keys[id]??[]).filter(key=>key in (value??{})).map(key=>[key,copy(value[key])]));
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>!['next_run','next_run_ms'].includes(key)).sort().map(key=>[key,canonical(value[key])]));
  return value;
};
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function cleanPanelError(value){
  const message=value&&typeof value==='object'&&'message'in value?value.message:value;
  return String(message).replace(/^(?:Error:\s*)?Error invoking remote method '[^']+':\s*/,'').replace(/^Error:\s*/,'');
}
export function canRunPluginCommand(busy,dirty,method){return !busy&&(!dirty||method==='config.set'||method==='stop');}
export async function readUnchangedCanvasDocument(load,getRevision){
  const revision=getRevision(),next=await load();
  if(next&&getRevision()!==revision)throw Error('Код изменился во время загрузки. Ваши правки сохранены; повторите открытие, если хотите заменить их.');
  return next;
}

/** In-window drafts survive navigation, while each hardware mode stays isolated. */
export class PluginDraftSession {
  entries=new Map();
  key(scope,id){return scopes.has(scope)&&keys[id]?scope+'/'+id:null;}
  write(scope,id,baseline,draft){
    const key=this.key(scope,id);if(!key)return;
    const value=editable(id,draft),base=editable(id,baseline);
    if(same(value,base)){this.entries.delete(key);return;}
    this.entries.set(key,{base,value});
  }
  restore(scope,id,server){
    const entry=this.entries.get(this.key(scope,id));if(!entry)return null;
    return {draft:{...copy(server),...copy(entry.value)},conflict:!same(entry.base,editable(id,server))};
  }
  clear(scope,id){this.entries.delete(this.key(scope,id));}
  acknowledge(scope,id,saved){
    const key=this.key(scope,id),entry=this.entries.get(key);
    if(entry&&same(entry.value,editable(id,saved)))this.entries.delete(key);
  }
}

export class CanvasEditorSession {
  entries=new Map();
  read(scope){return scopes.has(scope)?copy(this.entries.get(scope)??{}):{};}
  write(scope,patch){if(scopes.has(scope))this.entries.set(scope,{...this.entries.get(scope),...copy(patch)});}
}

export const MAX_EDITOR_SOURCE=200000;
export function validateEditorSource(source){
  if(typeof source!=='string')return 'Не удалось прочитать HTML-код.';
  return source.length>MAX_EDITOR_SOURCE?'Код длиннее 200 000 символов. Он не обрезан; сократите его перед запуском или сохранением в библиотеку.':'';
}

export function normalizeCodePreferences(value={}){
  if(!value||typeof value!=='object')value={};
  return {fontSize:Number.isFinite(value.fontSize)?Math.max(12,Math.min(22,Math.round(value.fontSize))):14,wordWrap:value.wordWrap!==false};
}
