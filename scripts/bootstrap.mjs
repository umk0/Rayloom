import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(fs.readFileSync(path.join(root,'docs','sources.lock.json'),'utf8'));
const assets={
  'lhwm-wrapper.dll':'https://gitlab.com/api/v4/projects/25437611/jobs/artifacts/master/raw/x64/Release/lhwm-wrapper.dll?job=main_build',
  'OpenRGBEffectsPlugin.dll':'https://codeberg.org/OpenRGB/OpenRGBEffectsPlugin/releases/download/release_1.1/OpenRGBEffectsPlugin_1.1_Windows_64_f211d08.dll',
  'qt-6.8.3.7z':'https://gitlab.com/OpenRGBDevelopers/OpenRGB-Qt-Packages/-/raw/master/qt-6.8.3-base-tools-core5compat-msvc2022-64.7z',
  'jom.zip':'https://gitlab.com/OpenRGBDevelopers/OpenRGB-Qt-Packages/-/raw/master/jom.zip',
};
fs.mkdirSync(path.join(root,'downloads'),{recursive:true});
for(const [name,url] of Object.entries(assets)){
  const target=path.join(root,'downloads',name);
  if(!fs.existsSync(target)){const response=await fetch(url);if(!response.ok)throw new Error(`${name}: HTTP ${response.status}`);fs.writeFileSync(target,Buffer.from(await response.arrayBuffer()));}
  const digest=createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if(digest!==lock.downloads.find(d=>d.file===name)?.sha256)throw new Error(`${name}: checksum mismatch`);
  console.log(`${name}: SHA256 verified`);
}
const sevenZip='C:\\Program Files\\7-Zip\\7z.exe';
for(const [archive,target,probe] of [['qt-6.8.3.7z','qt','msvc2022_64/bin/qmake.exe'],['jom.zip','jom','jom.exe']]){
  const dir=path.join(root,'tooling',target);
  if(!fs.existsSync(path.join(dir,probe)))execFileSync(sevenZip,['x',path.join(root,'downloads',archive),`-o${dir}`,'-y'],{stdio:'inherit'});
}
console.log('Build dependencies ready. Native sources and fork changes must be preserved with this workspace.');
