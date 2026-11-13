export const MAX_CANVAS_SOURCE=200000;
export function validateCanvasSource(source){if(typeof source!=='string'||!source.trim()||source.length>MAX_CANVAS_SOURCE)throw Error('HTML должен содержать от 1 до 200 000 символов.');return source;}
export function canvasControls(source){
 validateCanvasSource(source);const controls=[];
 for(const match of source.matchAll(/<meta\b([^>]{0,2000})>/gi)){
  const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2]]));
  const key=attrs.property,type=attrs.type;
  if(!key||!/^[a-zA-Z][\w]{0,39}$/.test(key)||['__proto__','constructor','prototype'].includes(key)||!['number','color','boolean'].includes(type)||controls.some(c=>c.key===key))continue;
  const item={key,label:(attrs.label||key).slice(0,80),type};
  if(type==='number'){
   const num=(v,f)=>v!==undefined&&Number.isFinite(Number(v))?Number(v):f;
   item.min=num(attrs.min,0);item.max=Math.max(item.min,num(attrs.max,100));item.step=Math.max(.001,num(attrs.step,1));item.default=Math.max(item.min,Math.min(item.max,num(attrs.default,item.min)));
  }else if(type==='color')item.default=/^#[a-f\d]{6}$/i.test(attrs.default??'')?attrs.default:'#a378ef';
  else item.default=attrs.default==='true';
  controls.push(item);if(controls.length===16)break;
 }
 return controls;
}
export function normalizeCanvasParameters(controls,input={}){
 const output={};for(const c of controls){let v=input?.[c.key]??c.default;
  if(c.type==='number')v=Number.isFinite(Number(v))?Math.max(c.min,Math.min(c.max,Number(v))):c.default;
  else if(c.type==='color')v=typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v)?v:c.default;
  else v=v===true;
  output[c.key]=v;
 }return output;
}
export function secureCanvasDocument(source){
 validateCanvasSource(source);
 // This policy precedes all untrusted markup. Removing the tag cannot relax the applied policy.
 return `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;overflow:hidden;background:#000}</style></head>`+source;
}
