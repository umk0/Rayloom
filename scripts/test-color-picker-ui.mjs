// Real keyboard/pointer regression for the effect parameter color dialog.
// Runs only with isolated virtual hardware; no system settings are changed.
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
 throw Error('Local Playwright is required');
}
const {_electron}=playwright(),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-color-'));
const output=path.join(root,'output/playwright/color-picker-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(output,{recursive:true});
const report={physicalHardwareTested:false,checks:[],errors:[]};let app,page;
const wait=async(fn)=>{for(let i=0;i<150;i++){if(await fn())return;await delay(60);}throw Error('UI state did not settle');};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
const shot=async name=>{await delay(300);const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data,'base64'));};
try{
 const env={...process.env,LUMEN_MODE:'virtual',LUMEN_USER_DATA:runtime};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],cwd:root,env,timeout:60000});
 page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.waitForFunction(async()=>{const s=await window.rayloom.snapshot();return s.mode==='virtual'&&!s.starting&&s.status?.pluginsReady;},{},{timeout:60000});
 await page.getByRole('button',{name:/Показать все/}).click();await page.locator('[data-effect="wave"]').click();
 const trigger=page.getByRole('button',{name:'Выбрать: Цвет эффекта',exact:true}),dialog=page.getByRole('dialog',{name:'Цвет эффекта',exact:true});
 await check('HEX edit then Tab and Escape closes the dialog and restores trigger focus',async()=>{
  await trigger.click();await dialog.waitFor();const field=dialog.getByRole('textbox',{name:'HEX',exact:true});
  await field.fill('#123456');await field.press('Tab');await wait(async()=>(await trigger.innerText()).includes('#123456'));
  await shot('01-color-dialog');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert(await trigger.evaluate(el=>el===document.activeElement));
 });
 await check('Done button closes through the same dialog state and restores focus',async()=>{
  await trigger.click();await dialog.getByRole('button',{name:'Готово',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert(await trigger.evaluate(el=>el===document.activeElement));
 });
 await check('page playback button accepts a normal click after closing the picker',async()=>{
  assert.equal((await page.evaluate(()=>window.rayloom.snapshot())).mode,'virtual');
  await page.getByRole('button',{name:'Включить',exact:true}).click();
  await wait(async()=>{const s=await page.evaluate(()=>window.rayloom.studio('state'));return s.running&&s.current?.color===0x563412;});
  await shot('02-playback-after-close');
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;if(app)await shot('failure').catch(()=>{});}
finally{
 try{const c=await connectRuntime(root,runtime,'virtual',{launch:false});await c.call('shutdown');c.close();}catch(e){report.errors.push('cleanup: '+e.message);}
 if(app)await app.close().catch(()=>{});
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(output,'report.json'));if(report.error)console.error(report.error);
}
