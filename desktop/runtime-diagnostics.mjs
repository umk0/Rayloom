import fs from 'node:fs';
import path from 'node:path';

const errorSummary=error=>({name:String(error?.name??'Error').slice(0,80),code:error?.code??null,message:error instanceof SyntaxError?'Invalid JSON':String(error?.message??error).slice(0,400)});
export function diagnosticArgv(argv){
 const output=argv.slice(0,2).map(value=>String(value).slice(0,2048));
 for(let i=2;i<argv.length;i++)if(['--data','--mode'].includes(argv[i])&&i+1<argv.length){output.push(argv[i],String(argv[++i]).slice(0,2048));}
 return output;
}
function inspectJson(file,limit,summarize){
 const result={path:file};
 try{
  const stat=fs.statSync(file);result.stat={size:stat.size,mode:stat.mode,isFile:stat.isFile(),modifiedAt:stat.mtime.toISOString()};result.realPath=fs.realpathSync(file);
  if(!stat.isFile()||stat.size>limit){result.read={ok:false,error:{code:'DIAGNOSTIC_SIZE_LIMIT',message:'File is not a regular file within the diagnostic size limit'}};return result;}
  const bytes=fs.readFileSync(file);result.firstBytes=[...bytes.subarray(0,4)];
  // Match the production reader exactly: do not hide a BOM or malformed JSON.
  const text=fs.readFileSync(file,'utf8');result.utf8Length=text.length;result.encodingMatches=text===bytes.toString('utf8');
  const parsed=JSON.parse(text);result.read={ok:true,result:summarize(parsed)};
 }catch(error){result.read={ok:false,error:errorSummary(error)};}
 return result;
}
const settingsSummary=value=>({mode:['hardware','virtual'].includes(value?.mode)?value.mode:null,autoStart:typeof value?.autoStart==='boolean'?value.autoStart:null,elevatedStartup:typeof value?.elevatedStartup==='boolean'?value.elevatedStartup:null,continueOnClose:typeof value?.continueOnClose==='boolean'?value.continueOnClose:null,startupTaskName:/^(?:Rayloom|LumenRGB)-Agent-[0-9a-f]{24}$/.test(value?.startupTaskName??'')?value.startupTaskName:null});
export function runtimeDiagnostics({dataDir,studioDir,root,mode,settings,argv=process.argv}){
 return {
  collectedAt:new Date().toISOString(),pid:process.pid,execPath:process.execPath,nodeVersion:process.version,architecture:process.arch,cwd:process.cwd(),root,dataDir,studioDir,mode,argv:diagnosticArgv(argv),cachedSettings:settingsSummary(settings),
  environment:{appData:process.env.APPDATA??null,userProfile:process.env.USERPROFILE??null,nodeOptionsPresent:!!process.env.NODE_OPTIONS},
  files:{
   settings:inspectJson(path.join(dataDir,'app-settings.json'),65536,settingsSummary),
   layout:inspectJson(path.join(studioDir,'layout.json'),2*1024*1024,value=>({version:value?.version??null,components:Array.isArray(value?.components)?value.components.length:null,groups:Array.isArray(value?.groups)?value.groups.length:null})),
   playback:inspectJson(path.join(dataDir,'playback-'+mode+'.json'),2*1024*1024,value=>({kind:['studio','canvas','native','stopped'].includes(value?.kind)?value.kind:null,savedAt:typeof value?.savedAt==='string'?value.savedAt.slice(0,40):null}))
  }
 };
}
