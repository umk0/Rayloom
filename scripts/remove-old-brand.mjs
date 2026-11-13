// One-time, narrow cleanup after every application reference moved to Rayloom.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const brand=path.join(root,'public','brand');
const files=['lumen-16.png','lumen-32.png','lumen-48.png','lumen-64.png',
 'lumen-128.png','lumen-256.png','lumen-mark.png','lumen-wordmark.svg','lumen.ico'];
const references=/lumen-(?:mark|wordmark|[0-9]+)\.(?:png|svg)|lumen\.ico|brand\/lumen/i;
for(const directory of ['src','desktop','shared','sdk','scripts']){
 const walk=where=>{
  for(const entry of fs.readdirSync(where,{withFileTypes:true})){
   const absolute=path.join(where,entry.name);
   if(entry.isDirectory())walk(absolute);
   else if(entry.isFile()&&absolute!==fileURLToPath(import.meta.url)&&/\.(?:tsx?|mjs|cjs|jsx?|css|html|json|ps1)$/.test(entry.name)&&references.test(fs.readFileSync(absolute,'utf8')))
    throw Error(`Old brand asset is still referenced: ${path.relative(root,absolute)}`);
  }
 };
 walk(path.join(root,directory));
}
for(const name of files){
 const target=path.resolve(brand,name);
 if(path.dirname(target)!==brand)throw Error('Brand target escaped its directory');
 if(fs.existsSync(target)&&!fs.lstatSync(target).isFile())throw Error(`Brand asset is not a regular file: ${name}`);
}
for(const name of files){const target=path.join(brand,name);if(fs.existsSync(target)){fs.unlinkSync(target);console.log(`removed ${name}`);}}
