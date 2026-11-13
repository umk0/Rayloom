// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'runtime','node');
const executable=path.join(runtime,'node.exe'),license=path.join(runtime,'LICENSE');
const pinned='v24.15.0',expected='4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18';
const version=execFileSync(executable,['--version'],{encoding:'utf8'}).trim();
if(version!==pinned)throw Error(`Bundled Node ${version} needs its own pinned license; expected ${pinned}`);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
if(fs.existsSync(license)){
 if(digest(fs.readFileSync(license))!==expected)throw Error('Bundled Node license hash mismatch');
}else{
 const url=`https://raw.githubusercontent.com/nodejs/node/${pinned}/LICENSE`;
 const response=await fetch(url);if(!response.ok)throw Error(`Node license download failed: HTTP ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(digest(bytes)!==expected)throw Error('Downloaded Node license hash mismatch');
 fs.writeFileSync(license,bytes);
}
console.log(`Node ${version} license verified`);
