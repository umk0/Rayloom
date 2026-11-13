// SPDX-License-Identifier: GPL-2.0-or-later
// Curated source snapshot for the public monorepo. Never follows links or copies local profiles/builds.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.argv[2]&&path.resolve(process.argv[2]);
if(!output||output===root||!output.startsWith(path.resolve(root,'artifacts','source')+path.sep))throw Error('Target must be inside artifacts/source');
const entries=['.gitignore','LICENSE','README.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','legacy.html','desktop','src','shared','sdk','scripts','installer','data','tests','core','plugins','public/brand','public/licenses'];
const docs=['BRAND.md','BRAND-MIGRATION.md','CANVAS-EFFECTS.md','DEVICE-CATALOG.md','DEVICE-LAYOUTS.md','EFFECT-PARAMETERS.md','EFFECT-PREVIEWS.md','INSTALLER-UPDATE.md','PLUGIN-MIGRATION.md','PLUGIN-PROTOCOL.md','PRODUCT-DIRECTION.md','PRODUCT-PLAN.md','RELEASE-PACKAGE.md','RELEASE-PLAN.md','SOURCE-CONTROL.md','sources.lock.json'];
for(const name of docs)entries.push('docs/'+name);
const excludedDirs=new Set(['.git','.vs','.vscode','node_modules','release','_intermediate_release','build','dist','runtime','downloads','tooling','artifacts','output','outputs','__pycache__','.qm','.qmake','debug']);
const excludedExtensions=new Set(['.obj','.dll','.exe','.pdb','.ilk','.idb','.ipch','.pch','.lib','.exp','.o','.a','.so','.dylib','.qm','.log','.tmp','.cache','.class','.pyc']);
let files=0,bytes=0;
function copy(relative){
 const source=path.join(root,relative),destination=path.join(output,relative);
 if(!fs.existsSync(source))throw Error('Missing public source: '+relative);
 const stat=fs.lstatSync(source);
 if(stat.isSymbolicLink())throw Error('Source link: '+relative);
 if(stat.isDirectory()){
  if(excludedDirs.has(path.basename(source)))return;
  for(const name of fs.readdirSync(source))copy(path.join(relative,name));
  return;
 }
 if(!stat.isFile())throw Error('Unsupported source: '+relative);
 const name=path.basename(source);
 if(name==='.git'||name==='.qmake.stash'||name==='Makefile'||name.startsWith('Makefile.')||/^moc_|^ui_|^qrc_/.test(name)||excludedExtensions.has(path.extname(name).toLowerCase()))return;
 if(stat.size>25*1024*1024)throw Error('Large source file requires review: '+relative);
 files++;bytes+=stat.size;
 if(process.argv.includes('--dry-run'))return;
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 if(fs.existsSync(destination)&&!fs.lstatSync(destination).isFile())throw Error('Export target changed: '+relative);
 fs.copyFileSync(source,destination);
}
for(const entry of entries)copy(entry);
console.log(JSON.stringify({files,bytes,output,dryRun:process.argv.includes('--dry-run')}));
