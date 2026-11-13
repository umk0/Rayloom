// Isolated real Electron tests; never opens the user's physical runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';
import {normalizeAdvancedScene,advancedDraftKey} from '../shared/advanced-draft.mjs';

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
function playwrightPath(){
 if(process.env.RAYLOOM_PLAYWRIGHT_MODULE)return process.env.RAYLOOM_PLAYWRIGHT_MODULE;
 try{return require.resolve('playwright');}catch{}
 const caches=[process.env.npm_config_cache,process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'npm-cache'),path.join(os.homedir(),'AppData','Local','npm-cache'),path.join(os.homedir(),'.npm')].filter(Boolean);
 for(const cache of [...new Set(caches)]){
  const npx=path.join(cache,'_npx');if(!fs.existsSync(npx))continue;
  for(const folder of fs.readdirSync(npx,{withFileTypes:true}).filter(f=>f.isDirectory())){
   const candidate=path.join(npx,folder.name,'node_modules','playwright');if(fs.existsSync(path.join(candidate,'package.json')))return candidate;
  }
 }
 throw Error('Set RAYLOOM_PLAYWRIGHT_MODULE to an existing Playwright installation. No download is performed.');
}
const {_electron}=require(playwrightPath());
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-draft-ui-'));
const artifacts=path.join(root,'output','playwright','advanced-drafts-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(artifacts,{recursive:true});
const report={started:new Date().toISOString(),runtime,artifacts,physicalHardwareTested:false,checks:[],rendererErrors:[]};
let app,page;
const wait=async(label,check,timeout=15000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(80);}throw Error('Timed out: '+label);};
const step=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
const screen=name=>page.screenshot({path:path.join(artifacts,name+'.png')});
const enter=async()=>{await page.getByRole('button',{name:'Расширенные инструменты',exact:true}).click();await page.getByRole('heading',{name:'Редактор эффектов',exact:true}).waitFor();};
const leave=async()=>{await page.getByRole('button',{name:'← Моя подсветка',exact:true}).click();await page.getByRole('heading',{name:'Моя подсветка',exact:true}).waitFor();};
const read=key=>page.evaluate(key=>sessionStorage.getItem(key),key);
const draftKey=advancedDraftKey('virtual'),hardwareKey=advancedDraftKey('hardware');
try{
 const env={...process.env,RAYLOOM_MODE:'virtual',RAYLOOM_USER_DATA:runtime};delete env.ELECTRON_RUN_AS_NODE;delete env.RAYLOOM_SCREENSHOT;
 app=await _electron.launch({executablePath:process.platform==='win32'?path.join(root,'node_modules','electron','dist','electron.exe'):require(path.join(root,'node_modules','electron')),args:[root],cwd:root,env,timeout:60000});
 page=await app.firstWindow({timeout:30000});page.setDefaultTimeout(15000);page.on('pageerror',e=>report.rendererErrors.push(e.message));await page.waitForLoadState('domcontentloaded');
 await wait('virtual runtime ready',async()=>{const snapshot=await page.evaluate(()=>window.rayloom.snapshot());return snapshot.mode==='virtual'&&snapshot.status?.virtual&&snapshot.status.pluginsReady&&snapshot.status.detectionPercent>=100;},45000);
 const catalog=await page.evaluate(()=>window.rayloom.effects('catalog'));
 await step('all 58 native default profiles normalize safely for the editor',async()=>{assert.equal(catalog.length,58);for(const description of catalog)normalizeAdvancedScene({version:2,Effects:[description.defaults]},catalog);});
 const effect=structuredClone(catalog.find(e=>e.id==='RainbowWave').defaults);effect.CustomName='Draft A';delete effect.UserColors;delete effect.ControllerZones;
 await page.evaluate(({key,scene})=>sessionStorage.setItem(key,JSON.stringify(scene)),{key:draftKey,scene:{version:2,Effects:[effect]}});
 await step('missing UserColors and zone list are restored before rendering',async()=>{
  await enter();await page.getByRole('heading',{name:'Настройки · Draft A',exact:true}).waitFor();
  await wait('normalized draft persisted',async()=>{const value=JSON.parse(await read(draftKey));return Array.isArray(value?.Effects?.[0]?.UserColors)&&Array.isArray(value?.Effects?.[0]?.ControllerZones);});await screen('01-restored-draft');
 });
 await step('edits during apply remain dirty and survive return navigation',async()=>{
  await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('rayloom:effects');ipcMain.removeHandler('rayloom:effects');ipcMain.handle('rayloom:effects',async(e,method,args)=>{if(method==='scene.apply')await new Promise(resolve=>setTimeout(resolve,1000));return original(e,method,args);});});
  await page.getByRole('button',{name:'Применить изменения',exact:true}).click();
  await page.locator('.effect-settings input[placeholder]').fill('Draft B');
  await page.getByText('Сцена применена. Новые правки остаются в черновике.',{exact:true}).waitFor();
  assert.equal(await page.locator('.effect-settings input[placeholder]').inputValue(),'Draft B');
  assert.equal(JSON.parse(await read(draftKey)).Effects[0].CustomName,'Draft B');
  await leave();await enter();await page.getByRole('heading',{name:'Настройки · Draft B',exact:true}).waitFor();await screen('02-concurrent-edit-preserved');await leave();
 });
 const damaged='{"version":2,"Effects":[{"EffectClassName":"UnavailableEffect"}]}';
 await step('damaged draft has an exit and is backed up before creating another',async()=>{
  await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key:draftKey,raw:damaged});
  await enter();await page.getByText('Черновик требует восстановления',{exact:true}).waitFor();assert.equal(await read(draftKey),damaged);await screen('03-recovery');await leave();assert.equal(await read(draftKey),damaged);
  await enter();await page.getByText('Черновик требует восстановления',{exact:true}).waitFor();await page.getByRole('button',{name:'Создать новый черновик',exact:true}).click();
  await wait('old draft backup',async()=>await read(draftKey+'.recovery')===damaged);
  await page.getByRole('heading',{name:/^Библиотека эффектов/}).waitFor();assert.deepEqual(JSON.parse(await read(draftKey)),{version:2,Effects:[]});await leave();
 });
 await step('a virtual editor does not load or delete a hardware draft',async()=>{
  const hardware=JSON.stringify({version:2,Effects:[{...catalog[0].defaults,CustomName:'Hardware only'}]});
  await page.evaluate(({virtualKey,key,raw})=>{sessionStorage.removeItem(virtualKey);sessionStorage.setItem(key,raw);},{virtualKey:draftKey,key:hardwareKey,raw:hardware});
  await enter();await page.getByRole('tab',{name:'Добавить эффект',exact:true}).waitFor();assert.equal(await page.getByText('Hardware only',{exact:true}).count(),0);assert.equal(await read(hardwareKey),hardware);await leave();
 });
 assert.deepEqual(report.rendererErrors,[]);report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);if(page&&!page.isClosed()){await screen('failure').catch(()=>{});fs.writeFileSync(path.join(artifacts,'failure-dom.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));}}
finally{
 try{const client=await connectRuntime(root,runtime,'virtual',{launch:false});await client.call('shutdown');client.close();}catch(error){if(fs.existsSync(path.join(runtime,'runtime.json'))){report.runtimeCleanupError=error.message;process.exitCode=1;}}
 if(app)await app.close().catch(error=>{report.cleanupError=error.message;process.exitCode=1;});
 report.finished=new Date().toISOString();fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(root,'artifacts','advanced-drafts-ui.json'),JSON.stringify(report,null,2));console.log('Draft UI report:',path.join(artifacts,'report.json'));
}
