// One-time, explicit profile migration. Never deletes or overwrites the source.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
if(!args.includes('--source'))throw Error('Specify --source with the verified physical profile directory.');
const source=path.resolve(value('--source')),destination=path.join(root,'runtime','user-data');
if(fs.existsSync(destination))throw Error('Destination already exists; migration will not overwrite it.');
if(!fs.existsSync(path.join(source,'hardware','studio','layout.json')))throw Error('Source does not contain the expected Rayloom layout.');
const backup=path.join(root,'runtime','profile-backups',new Date().toISOString().replaceAll(':','-'));
const files=[];
const collect=relative=>{
 const file=path.join(source,relative);if(!fs.existsSync(file))return;
 const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Profile links are not migrated: '+relative);
 if(stat.isDirectory()){for(const name of fs.readdirSync(file))collect(path.join(relative,name));}
 else if(stat.isFile()){if(stat.size>20*1024*1024)throw Error('Profile file exceeds 20 MiB: '+relative);files.push(relative);}
};
for(const name of ['app-settings.json','scene.json','playback-hardware.json','playback-virtual.json','hardware','virtual','scenes','presets'])collect(name);
for(const mode of ['native','native-hardware','native-virtual'])for(const name of ['OpenRGB.json','profiles','plugins/settings'])collect(path.join(mode,name));
const manifest=[];
for(const relative of files){
 const bytes=fs.readFileSync(path.join(source,relative));
 for(const target of [backup,destination]){const file=path.join(target,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});}
 manifest.push({path:relative,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
// The replacement task is registered only after migration succeeds.
const settings=JSON.parse(fs.readFileSync(path.join(destination,'app-settings.json'),'utf8'));
fs.writeFileSync(path.join(destination,'app-settings.json'),JSON.stringify({...settings,mode:'hardware',autoStart:false,elevatedStartup:false,startupTaskName:null},null,2));
const result={time:new Date().toISOString(),source,destination,backup,files:manifest};
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts','profile-migration.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({destination,backup,files:files.length,bytes:manifest.reduce((sum,file)=>sum+file.size,0)}));
