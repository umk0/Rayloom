import fs from 'node:fs';
const text=fs.readFileSync('tooling/netfx/exports.txt','utf8');
const names=[...text.matchAll(/^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\w+)/gmi)].map(m=>m[1]);
if(names.length<10)throw new Error('Cannot read mscoree export table');
fs.writeFileSync('tooling/netfx/mscoree.def','LIBRARY mscoree.dll\nEXPORTS\n'+names.join('\n')+'\n');
