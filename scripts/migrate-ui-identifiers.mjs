// One-time source rename. The old profile keys and native IDs are handled by
// explicit migrations; this script only changes the renderer/Electron API.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const visit=(dir,callback)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 const target=path.join(dir,entry.name);if(entry.isDirectory())visit(target,callback);else if(entry.isFile())callback(target);
}};
const changes=[];
for(const folder of ['src','desktop','tests','scripts'])visit(path.join(root,folder),file=>{
 if(file===fileURLToPath(import.meta.url)||!/[.](?:tsx?|css|mjs|cjs)$/.test(file))return;
 const relative=path.relative(root,file).replaceAll('\\','/');
 if(relative==='scripts/remove-old-brand.mjs')return;
 const old=fs.readFileSync(file,'utf8');let next=old;
 next=next.replace(/window\.lumen\b/g,'window.rayloom').replace(/window\.lumenEffect\b/g,'window.rayloomEffect').replace(/lumen:/g,'rayloom:');
 if(relative.startsWith('src/'))next=next.replace(/\blumen(?=\s*:\s*\{)/g,'rayloom').replace(/lumen-/g,'rayloom-').replace(/\bLumen(?=[A-Z])/g,'Rayloom');
 if(relative==='desktop/preload.cjs')next=next.replace("exposeInMainWorld('lumen',","exposeInMainWorld('rayloom',");
 if(next!==old){fs.writeFileSync(file,next);changes.push(relative);}
});
console.log(JSON.stringify({changed:changes.length,files:changes}));
