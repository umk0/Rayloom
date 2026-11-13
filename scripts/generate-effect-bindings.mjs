import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','plugins','effects');
const bindings={};
for(const dir of fs.readdirSync(path.join(root,'Effects'),{withFileTypes:true}).filter(d=>d.isDirectory())){
  const file=path.join(root,'Effects',dir.name,dir.name+'.cpp');if(!fs.existsSync(file))continue;
  const source=fs.readFileSync(file,'utf8');const map={};
  for(const m of source.matchAll(/ui->(\w+)->(?:setValue|setCurrentIndex|setCurrentText|setChecked|SetColors|SetRGBColor|setText)\(\s*\w+\["([^"]+)"\]/g))map[m[2]]=m[1];
  bindings[dir.name]=map;
}
fs.writeFileSync(path.join(root,'LumenBindings.h'),'// Generated from upstream LoadCustomSettings bindings.\n#pragma once\nstatic const char* LumenBindingsJSON = R"LUMEN('+JSON.stringify(bindings)+')LUMEN";\n');
console.log(`Generated setting bindings for ${Object.keys(bindings).length} effect sources`);
