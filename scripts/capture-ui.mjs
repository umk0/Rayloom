// Capture real Electron screens using an isolated virtual profile; never scans hardware.
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
 for(const base of [process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'npm-cache'),path.join(os.homedir(),'AppData/Local/npm-cache')].filter(Boolean)){
  const dir=path.join(base,'_npx');if(!fs.existsSync(dir))continue;
  for(const name of fs.readdirSync(dir)){const candidate=path.join(dir,name,'node_modules/playwright');if(fs.existsSync(path.join(candidate,'package.json')))return require(candidate);}
 }
 throw Error('Local Playwright package is required.');
}
const {_electron}=playwright(),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-audit-'));
const label=(process.argv[2]??'current').replace(/[^a-z0-9-]/gi,''),output=path.join(root,'output/playwright',label+'-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(output,{recursive:true});
const report={runtime,physicalHardwareTested:false,screens:[],errors:[]};let app,page;
async function capture(name){
 await delay(250);
 const file=path.join(output,name+'.png');
 const screenshot=await app.evaluate(async({BrowserWindow})=>{const image=await BrowserWindow.getAllWindows()[0].capturePage();return {base64:image.toPNG().toString('base64'),size:image.getSize()};});
 fs.writeFileSync(file,Buffer.from(screenshot.base64,'base64'));
 const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,bodyOverflow:document.documentElement.scrollWidth-innerWidth,groupControls:[...document.querySelectorAll('.group-member-choice')].map(e=>({html:e.outerHTML,children:[e,...e.querySelectorAll('*')].map(n=>({tag:n.tagName,slot:n.getAttribute('data-slot'),class:n.className,display:getComputedStyle(n).display,direction:getComputedStyle(n).flexDirection,align:getComputedStyle(n).alignItems,justify:getComputedStyle(n).justifyContent}))})),scrollbars:[...document.querySelectorAll('.studio-scroll,.workbench-scroll,.spatial-expanded-inspector')].map(e=>({class:e.className,width:e.clientWidth,height:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight}))}));
 report.screens.push({name,file,pixels:screenshot.size,...metrics});console.log('CAPTURE',name);
}
try{
 const env={...process.env,RAYLOOM_MODE:'virtual',RAYLOOM_USER_DATA:runtime};delete env.ELECTRON_RUN_AS_NODE;delete env.RAYLOOM_SCREENSHOT;
 app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root],cwd:root,env,timeout:60000});
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.waitForFunction(async()=>{const s=await window.rayloom.snapshot();return s.mode==='virtual'&&s.status?.pluginsReady&&s.status.detectionPercent>=100;},{},{timeout:60000});
 await page.locator('.spatial-component').first().waitFor();

 if(process.env.RAYLOOM_CAPTURE_ONLY==='details'){
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,1000));
  for(const [tab,title,key] of [['Моя подсветка','Качество воспроизведения','fine-settings'],['Сцены и игры','Проверить реакцию без игры','game-tester'],['Создать эффект','Как устроен HTML-эффект','canvas-help'],['Настройки','Благодарности и лицензии','about']]){
   await page.locator('.studio-nav').getByRole('button',{name:tab,exact:true}).click();
   const trigger=page.getByRole('button',{name:title,exact:true});await trigger.click();
   await trigger.locator('xpath=ancestor::*[contains(@class,"lumen-disclosure")][1]').evaluate(el=>el.scrollIntoView({block:'center'}));
   await capture('detail-'+key);
  }
  await page.locator('.studio-nav').getByRole('button',{name:/^Устройства/}).click();
  await page.getByRole('button',{name:'Диагностика обнаружения',exact:true}).click();
  await page.getByRole('button',{name:/^Каталог устройств и матриц/}).click();
  await page.locator('.catalog-results>div').first().waitFor();
  await page.getByRole('button',{name:/^Каталог устройств и матриц/}).evaluate(el=>el.scrollIntoView({block:'start'}));
  await capture('detail-device-catalog');
  await page.locator('.studio-nav').getByRole('button',{name:'Моя подсветка',exact:true}).click();
  await page.getByRole('button',{name:/^Показать все/}).click();
  await page.getByRole('tab',{name:'Effects Plugin',exact:true}).click();
  report.previews=[];
  for(const id of ['RainbowWave','CustomMarquee']){
   const card=page.locator('[data-effect="openrgb:'+id+'"]');await card.scrollIntoViewIfNeeded();await card.hover();
   await card.locator('canvas[data-preview-status="ready"]').waitFor({timeout:60000});
   const before=await card.locator('canvas').evaluate(el=>el.toDataURL());await delay(450);
   const after=await card.locator('canvas').evaluate(el=>el.toDataURL());
   report.previews.push({effect:id,changed:before!==after});await capture('detail-preview-'+id);
  }
  await page.locator('.component-list button').first().click();
  for(const zoom of [1.25,1.5,2]){
   await app.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),zoom);
   await page.getByRole('button',{name:'Развернуть редактор пространства'}).click();
   await page.getByRole('dialog',{name:'Редактор пространства'}).waitFor();
   await capture('detail-fullscreen-selected-'+Math.round(zoom*100));await page.keyboard.press('Escape');
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
 }else{

 const mainPages=[['Моя подсветка','home'],['Устройства','devices'],['Группы','groups'],['Сцены и игры','scenes'],['Создать эффект','code'],['Расширения','extensions'],['Настройки','settings']];
 for(const width of (process.env.RAYLOOM_CAPTURE_ONLY==='advanced'?[]:process.env.RAYLOOM_CAPTURE_GROUP==='1'?[1480]:[1480,1060])){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,width===1480?1000:700),width);
  for(const [index,[title,key]] of mainPages.entries()){
   if(process.env.RAYLOOM_CAPTURE_GROUP==='1'&&key!=='groups')continue;
   await page.locator('.studio-nav').getByRole('button',{name:new RegExp('^'+title)}).click();
   await page.locator('.studio-scroll').evaluate(el=>{el.scrollTop=0;});
   await capture(String(index+1).padStart(2,'0')+'-'+key+'-'+width);
  }
 }

 if(process.env.RAYLOOM_CAPTURE_DPI==='1'){
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,1000));
  for(const zoom of [1.25,1.5,2]){
   await app.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),zoom);
   for(const [index,[title,key]] of mainPages.entries()){
    await page.locator('.studio-nav').getByRole('button',{name:new RegExp('^'+title)}).click();
    await page.locator('.studio-scroll').evaluate(el=>{el.scrollTop=0;});
    await capture(String(index+1).padStart(2,'0')+'-'+key+'-zoom-'+Math.round(zoom*100));
   }
   await page.locator('.studio-nav').getByRole('button',{name:'Моя подсветка',exact:true}).click();
   await page.getByRole('button',{name:'Развернуть редактор пространства'}).click();
   await page.getByRole('dialog',{name:'Редактор пространства'}).waitFor();
   await capture('09-fullscreen-zoom-'+Math.round(zoom*100));
   await page.keyboard.press('Escape');
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
 }

 if(process.env.RAYLOOM_CAPTURE_GROUP!=='1'){
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,1000));
 await page.locator('.studio-nav').getByRole('button',{name:'Моя подсветка',exact:true}).click();
 await page.locator('.component-list button').first().click();
 await page.getByText('Глубина и наклон в 3D',{exact:true}).click();await capture('08-port-inspector');
 await page.getByRole('button',{name:'Развернуть редактор пространства'}).click();
 await page.getByRole('dialog',{name:'Редактор пространства'}).waitFor();await capture('09-fullscreen');
 await page.keyboard.press('Escape');
 await page.locator('.studio-nav').getByRole('button',{name:'Расширенные инструменты',exact:true}).click();
 await page.locator('.sidebar').waitFor();
 const buttons=await page.locator('.sidebar button').allTextContents();report.advancedButtons=buttons;
 const advancedPages=[['Эффекты','effects'],['Устройства','devices'],['Расположение','map'],['Датчики','sensors'],['E1.31','e131'],['Интеграции','integrations'],['Расписание','scheduler'],['Сцены и пресеты','scenes'],['Настройки','settings']];
 for(const width of (process.env.RAYLOOM_CAPTURE_ONLY==='advanced'?[1060]:[1480,1060])){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,width===1480?1000:700),width);
  for(const [index,[title,key]] of advancedPages.entries()){
   const target=page.locator('.sidebar').getByRole('button',{name:new RegExp('^'+title)});
   await target.first().click();
   if(key==='effects')await page.getByRole('tab',{name:'Добавить эффект',exact:true}).click();
   await page.locator('.advanced-content-scroll').evaluate(el=>{el.scrollTop=0;});
   await delay(350);
   await capture(String(index+10).padStart(2,'0')+'-advanced-'+key+'-'+width);
   const createLabel={sensors:'Добавить правило',e131:'Universe',integrations:'Добавить хук',scheduler:'Добавить задачу'}[key];
   if(createLabel){
    await page.getByRole('button',{name:createLabel,exact:true}).click();
    await page.locator('.advanced-content-scroll').evaluate(el=>{el.scrollTop=0;});
    await capture(String(index+10).padStart(2,'0')+'-advanced-'+key+'-form-'+width);
   }
   if(key==='effects'){
    await page.locator('.catalog-card').first().click();
    const section=page.getByRole('button',{name:'Кадры, цветокоррекция и режим',exact:true});if(await section.getAttribute('aria-expanded')!=='true')await section.click();
    await page.locator('.advanced-content-scroll').evaluate(el=>{el.scrollTop=430;});
    await capture('10-advanced-effect-form-'+width);
   }
   if(key==='map'){
    await page.getByRole('button',{name:/Добавить зону на карту/}).click();
    await page.getByRole('option').first().click();
    await page.locator('.advanced-content-scroll').evaluate(el=>{el.scrollTop=440;});
    await capture('12-advanced-map-form-'+width);
   }
  }
 }

 }
 }
}catch(e){report.errors.push(e.stack);process.exitCode=1;console.error(e);if(page)await capture('failure').catch(()=>{});}
finally{
 try{const client=await connectRuntime(root,runtime,'virtual',{launch:false});await client.call('shutdown');client.close();}catch(e){report.errors.push('cleanup: '+e.message);}
 if(app)await app.close().catch(e=>report.errors.push(e.message));
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(output,'report.json'));
}
