import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repos=['core',...fs.readdirSync(path.join(root,'plugins')).map(n=>'plugins/'+n)];
const git=(dir,...args)=>execFileSync('git',args,{cwd:path.join(root,dir),encoding:'utf8'}).trim();
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='.git'?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const report={catalog:'https://openrgb.org/plugins.html',baseRelease:'1.1',repositories:repos.map(dir=>{
  const files=walk(path.join(root,dir));return {path:dir,url:git(dir,'remote','get-url','origin'),commit:git(dir,'rev-parse','HEAD'),nativePanels:files.filter(f=>f.endsWith('.ui')).length,licenses:files.filter(f=>/[/\\](LICENSE|COPYING)(\.|$)/i.test(f)).map(f=>path.relative(root,f))};
}),downloads:fs.readdirSync(path.join(root,'downloads')).map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,'downloads',file))).digest('hex')}))};
fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.writeFileSync(path.join(root,'docs','sources.lock.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
