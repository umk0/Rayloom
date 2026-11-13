// Startup hydration regression in an isolated virtual Electron. Playback,
// scene.load and mode changes below are mocked at IPC; no lighting is changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
function playwright(){
 if(process.env.LUMEN_PLAYWRIGHT_MODULE)return require(process.env.LUMEN_PLAYWRIGHT_MODULE);
 try{return require('playwright');}catch{}
 const cache=path.join(process.env.LOCALAPPDATA,'npm-cache/_npx');
 for(const entry of fs.readdirSync(cache)){const candidate=path.join(cache,entry,'node_modules/playwright');if(fs.existsSync(path.join(candidate,'package.json')))return require(candidate);}
 throw Error('Local Playwright is required; this test never downloads it');
}
const {_electron}=playwright(),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-hydration-'));
const output=path.join(root,'output/playwright/studio-hydration-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(output,{recursive:true});
const report={physicalHardwareTested:false,playbackAndModeChangesMocked:true,checks:[],errors:[]};let app,page;
const wait=async(fn)=>{for(let i=0;i<150;i++){if(await fn())return;await delay(60);}throw Error('UI state did not settle');};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
const shot=name=>page.screenshot({path:path.join(output,name+'.png')});
const nav=name=>page.locator('.studio-nav').getByRole('button',{name:new RegExp('^'+name)}).click();
const patch=values=>app.evaluate((_electron,values)=>{Object.assign(globalThis.__hydrationTest,values);},values);
const expectEffect=async(name,speed)=>{await page.getByRole('heading',{name:'Настройки · '+name,exact:true}).waitFor();assert.equal(Number(await page.getByRole('slider',{name:'Скорость',exact:true}).inputValue()),speed);};
const reloadEmpty=async()=>{await patch({current:null,mode:'virtual',loadRequested:false});await page.reload();await page.getByRole('heading',{name:'Настройки · Спектр',exact:true}).waitFor();await wait(()=>page.locator('.spatial-component').count());await delay(650);};
const prism={effect:'prism',group:'all',speed:5,brightness:100,scale:350,fps:60,color:0x7bf1b4,gameReactive:false,projection:'xy'};
try{
 const env={...process.env,LUMEN_MODE:'virtual',LUMEN_USER_DATA:runtime};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],cwd:root,env,timeout:60000});
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.waitForFunction(async()=>{const s=await window.rayloom.snapshot();return s.mode==='virtual'&&s.status?.virtual&&!s.starting&&s.status.pluginsReady;},{},{timeout:60000});
 await app.evaluate(({ipcMain})=>{
  const originalStudio=ipcMain._invokeHandlers.get('rayloom:studio'),originalSnapshot=ipcMain._invokeHandlers.get('rayloom:snapshot');
  globalThis.__hydrationTest={mode:'virtual',current:null,loadRequested:false};
  ipcMain.removeHandler('rayloom:studio');ipcMain.removeHandler('rayloom:snapshot');
  ipcMain.handle('rayloom:snapshot',async event=>{const result=await originalSnapshot(event),mock=globalThis.__hydrationTest;return {...result,mode:mock.mode,status:result.status?{...result.status,virtual:mock.mode==='virtual'}:result.status};});
  ipcMain.handle('rayloom:studio',async(event,method,args)=>{
   const mock=globalThis.__hydrationTest;
   if(method==='mode'){mock.mode=args.mode;mock.current=null;return {mode:mock.mode};}
   if(method==='scene.load'){mock.loadRequested=true;const state=await originalStudio(event,'state',{});await new Promise(resolve=>setTimeout(resolve,650));return {layout:state.layout,config:{effect:'wave',group:'all',speed:2,brightness:42}};}
   const result=await originalStudio(event,method,args);
   if(method!=='state')return result;
   return {...result,mode:mock.mode,current:structuredClone(mock.current),running:!!mock.current,scenes:[{name:'Hydration scene',layout:result.layout,config:{effect:'wave',speed:2,brightness:42}}]};
  });
 });
 await check('layout first, delayed Prism playback hydrates effect and speed',async()=>{
  await reloadEmpty();await patch({current:prism});await expectEffect('Призма',5);assert.equal(await page.locator('[data-effect="prism"]').getAttribute('aria-pressed'),'true');await shot('01-restored-prism');
 });
 await check('an effect and speed edited before delayed restore stay selected',async()=>{
  await reloadEmpty();await page.getByRole('button',{name:/Показать все/}).click();await page.locator('[data-effect="meteor"]').click();const slider=page.getByRole('slider',{name:'Скорость',exact:true});await slider.focus();await slider.press('End');await expectEffect('Метеорный поток',10);
  await patch({current:prism});await delay(1100);await expectEffect('Метеорный поток',10);assert.equal(await page.locator('[data-effect="meteor"]').getAttribute('aria-pressed'),'true');await shot('02-local-edit-kept');
 });
 await check('explicit scene load wins over a late initial playback poll',async()=>{
  await reloadEmpty();await nav('Сцены и игры');await page.locator('.studio-card').filter({has:page.getByRole('heading',{name:'Hydration scene',exact:true})}).getByRole('button',{name:'Загрузить',exact:true}).click();
  await wait(()=>app.evaluate(()=>globalThis.__hydrationTest.loadRequested));await patch({current:prism});await expectEffect('Волна',2);await delay(1000);await expectEffect('Волна',2);await shot('03-loaded-scene-kept');
 });
 await check('mode switch clears hydration guards and adopts that modes later playback',async()=>{
  await nav('Устройства');await page.getByRole('button',{name:/Режим оборудования/}).click();await page.getByRole('option',{name:'Моё оборудование',exact:true}).click();
  await wait(()=>app.evaluate(()=>globalThis.__hydrationTest.mode==='hardware'));await nav('Моя подсветка');await page.getByRole('heading',{name:'Настройки · Спектр',exact:true}).waitFor();
  await patch({current:{...prism,effect:'nebula',speed:3}});await expectEffect('Туманность',3);await shot('04-other-mode-hydrated');
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error);if(page&&!page.isClosed()){await shot('failure').catch(()=>{});fs.writeFileSync(path.join(output,'failure-dom.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));}}
finally{
 try{const client=await connectRuntime(root,runtime,'virtual',{launch:false});await client.call('shutdown');client.close();}catch(error){report.errors.push('cleanup: '+error.message);process.exitCode=1;}
 if(app)await app.close().catch(()=>{});
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(root,'artifacts/studio-hydration-ui.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(output,'report.json'));
}
