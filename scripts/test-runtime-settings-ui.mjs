// Settings UI checks in an isolated virtual Electron app. UAC and startup
// mutations are replaced at the IPC boundary; no Windows task is changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
function playwright(){
 if(process.env.RAYLOOM_PLAYWRIGHT_MODULE)return require(process.env.RAYLOOM_PLAYWRIGHT_MODULE);
 try{return require('playwright');}catch{}
 const cache=path.join(process.env.LOCALAPPDATA,'npm-cache/_npx');
 for(const entry of fs.readdirSync(cache)){const candidate=path.join(cache,entry,'node_modules/playwright');if(fs.existsSync(path.join(candidate,'package.json')))return require(candidate);}
 throw Error('Local Playwright is required');
}
const {_electron}=playwright(),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-settings-'));
const output=path.join(root,'output/playwright/runtime-settings-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(output,{recursive:true});
const report={physicalHardwareTested:false,systemChangesMocked:true,checks:[],errors:[]};let app,page;
const wait=async(fn)=>{for(let i=0;i<150;i++){if(await fn())return;await delay(60);}throw Error('UI state did not settle');};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
const shot=async name=>{await delay(400);const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data,'base64'));};
const toggle=async()=>{const field=page.getByRole('switch',{name:'Запускать подсветку вместе с Windows',exact:true});await field.focus();await field.press('Space');};
const size=async(width)=>{await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,1000),width);await delay(250);};
try{
 const env={...process.env,RAYLOOM_MODE:'virtual',RAYLOOM_USER_DATA:runtime};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],cwd:root,env,timeout:60000});
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.waitForFunction(async()=>{const s=await window.rayloom.snapshot();return s.mode==='virtual'&&!s.starting&&s.status?.pluginsReady;},{},{timeout:60000});
 await page.locator('.studio-nav').getByRole('button',{name:'Настройки',exact:true}).click();
 await check('real virtual runtime status is readable and technical data is collapsed',async()=>{
  await page.getByRole('heading',{name:'Автозапуск',exact:true}).waitFor();
  await page.getByText('Фоновый движок готов',{exact:true}).waitFor();
  assert(await page.getByRole('switch',{name:'Запускать подсветку вместе с Windows',exact:true}).isDisabled());
  assert(!/Память агента|SMBus|PawnIO|Chromium/.test(await page.locator('.runtime-settings').innerText()));
  await shot('01-normal-settings');
  await size(1060);await shot('01b-normal-settings-1060');await size(1480);
 });
 // Test-only replacement lives in this isolated main process and is discarded
 // on close. The original IPC remains in use for all non-settings operations.
 await app.evaluate(({ipcMain})=>{
  const original=ipcMain._invokeHandlers.get('rayloom:studio');
  globalThis.__settingsTest={state:{ready:true,mode:'hardware',settings:{autoStart:false,elevatedStartup:false},hardware:{elevated:false,i2cBusCount:2},memory:{rss:50*1024*1024},pid:123},calls:[],resolve:null};
  ipcMain.removeHandler('rayloom:studio');
  ipcMain.handle('rayloom:studio',async(event,method,args)=>{
   const mock=globalThis.__settingsTest;
   if(method==='runtime.status'){
    const snapshot=structuredClone(mock.state);
    if(mock.holdStatus){mock.holdStatus=false;return new Promise(resolve=>{mock.releaseStatus=()=>{resolve(snapshot);mock.releaseStatus=null;};});}
    return snapshot;
   }
   if(['runtime.elevate','runtime.settings'].includes(method)){mock.calls.push({method,args});return new Promise((resolve,reject)=>{mock.resolve=outcome=>{if(outcome.error)reject(Error(outcome.error));else{mock.state=outcome.state;resolve(structuredClone(mock.state));}mock.resolve=null;};});}
   return original(event,method,args);
  });
 });
 await wait(()=>page.getByRole('button',{name:'Разрешить доступ',exact:true}).isVisible());
 await check('cancelled Windows permission shows failure and preserves confirmed switch state',async()=>{
  await page.getByRole('button',{name:'Разрешить доступ',exact:true}).click();
  await page.getByText('Подтверждаем доступ к памяти…',{exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'Разрешить доступ',exact:true}).isDisabled());
  await shot('02-permission-pending');
  await app.evaluate(()=>globalThis.__settingsTest.resolve({error:'Запрос Windows отменён. Настройки не изменены.'}));
  await page.getByRole('alert').waitFor();
  assert(!(await page.getByRole('switch',{name:'Запускать подсветку вместе с Windows',exact:true}).isChecked()));
  await shot('03-permission-cancelled');
 });
 await check('access confirmation updates immediately and repeated grant is unavailable',async()=>{
  await app.evaluate(()=>{globalThis.__settingsTest.holdStatus=true;});
  await wait(()=>app.evaluate(()=>!!globalThis.__settingsTest.releaseStatus));
  await page.getByRole('button',{name:'Разрешить доступ',exact:true}).click();
  await app.evaluate(()=>{const m=globalThis.__settingsTest;m.resolve({state:{...m.state,hardware:{...m.state.hardware,elevated:true}}});});
  await page.getByText('Доступ разрешён',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Разрешить доступ',exact:true}).count(),0);
  assert(!(await page.getByRole('switch',{name:'Запускать подсветку вместе с Windows',exact:true}).isChecked()));
 });
 await check('late polling response cannot revert confirmed memory access',async()=>{
  await app.evaluate(()=>globalThis.__settingsTest.releaseStatus());await delay(150);
  await page.getByText('Доступ разрешён',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Разрешить доступ',exact:true}).count(),0);
 });
 await check('startup enabled with granted access asks for persistent permission and confirms it',async()=>{
  await toggle();
  await app.evaluate(()=>{const m=globalThis.__settingsTest;const last=m.calls.at(-1);if(last.method!=='runtime.elevate'||last.args.autoStart!==true)throw Error('Must persist current privileges');m.resolve({state:{...m.state,settings:{autoStart:true,elevatedStartup:true}}});});
  await wait(()=>page.getByRole('switch',{name:'Запускать подсветку вместе с Windows',exact:true}).isChecked());
  await page.getByText('Включён · с доступом к RGB-памяти',{exact:true}).waitFor();await shot('04-confirmed-settings');
  await size(1060);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);await shot('04b-confirmed-settings-1060');await size(1480);
 });
 await check('disabling startup leaves current memory access visibly granted',async()=>{
  await toggle();
  await app.evaluate(()=>{const m=globalThis.__settingsTest;if(m.calls.at(-1).method!=='runtime.settings')throw Error('Wrong command');m.resolve({state:{...m.state,settings:{autoStart:false,elevatedStartup:false}}});});
  await wait(async()=>!(await page.getByRole('switch',{name:'Запускать подсветку вместе с Windows',exact:true}).isChecked()));
  await page.getByText('Доступ разрешён',{exact:true}).waitFor();
 });
 await check('diagnostics are optional and page has no horizontal overflow',async()=>{
  await page.getByRole('button',{name:'Техническая диагностика',exact:true}).click();await page.locator('.runtime-diagnostics').waitFor();
  assert.match(await page.locator('.runtime-diagnostics').innerText(),/50 МБ/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);await shot('05-diagnostics');
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;if(app)await shot('failure').catch(()=>{});}
finally{
 try{const c=await connectRuntime(root,runtime,'virtual',{launch:false});await c.call('shutdown');c.close();}catch(e){report.errors.push('cleanup: '+e.message);}
 if(app)await app.close().catch(()=>{});
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(output,'report.json'));if(report.error)console.error(report.error);
}
