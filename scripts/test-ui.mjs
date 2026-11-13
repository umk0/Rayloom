// Real Electron UI regression checks. Always uses an isolated virtual studio.
// npm run build && node scripts/test-ui.mjs
// Optional: RAYLOOM_PLAYWRIGHT_MODULE=/absolute/path/to/playwright
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
function playwrightPath(){
 if(process.env.RAYLOOM_PLAYWRIGHT_MODULE)return process.env.RAYLOOM_PLAYWRIGHT_MODULE;
 try{return require.resolve('playwright');}catch{}
 const caches=[process.env.npm_config_cache,process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'npm-cache'),path.join(os.homedir(),'AppData','Local','npm-cache'),path.join(os.homedir(),'.npm')].filter(Boolean);
 for(const cache of [...new Set(caches)]){
  const npx=path.join(cache,'_npx');if(!fs.existsSync(npx))continue;
  for(const folder of fs.readdirSync(npx,{withFileTypes:true}).filter(f=>f.isDirectory())){
   const candidate=path.join(npx,folder.name,'node_modules','playwright');
   if(fs.existsSync(path.join(candidate,'package.json')))return candidate;
  }
 }
 throw Error('Playwright is not installed locally. Set RAYLOOM_PLAYWRIGHT_MODULE to an existing Playwright package. This test does not download packages.');
}
const {_electron}=require(playwrightPath());
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-ui-'));
const artifacts=path.join(root,'output','playwright','ui-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(artifacts,{recursive:true});
const report={started:new Date().toISOString(),runtime,artifacts,physicalHardwareTested:false,checks:[],rendererErrors:[],consoleErrors:[]};
let app,page,componentId,groupId,canvasId;const retiredApps=[];
const wait=async(label,check,timeout=12000)=>{
 const deadline=Date.now()+timeout;let last;
 while(Date.now()<deadline){try{const value=await check();if(value)return value;}catch(error){last=error;}await delay(100);}
 throw Error('Timed out: '+label+(last?' ('+last.message+')':''));
};
const studio=()=>page.evaluate(()=>window.rayloom.studio('state'));
const snapshot=()=>page.evaluate(()=>window.rayloom.snapshot());
const canvas=()=>page.evaluate(()=>window.rayloom.canvas('state'));
const select=async(name,option)=>{await page.getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('option',{name:option,exact:true}).click();};
const toggleSwitch=name=>page.locator('.lumen-switch').filter({has:page.getByRole('switch',{name,exact:true})}).locator('[data-slot="switch-control"]').click();
const nav=name=>page.locator('.studio-nav').getByRole('button',{name:new RegExp('^'+name)}).click();
const fill=async(locator,value)=>{await locator.fill(String(value));await locator.press('Tab');};
const screenshot=async name=>{await page.screenshot({path:path.join(artifacts,name+'.png')});};
const step=async(name,fn)=>{
 const started=Date.now();await fn();report.checks.push({name,ms:Date.now()-started});console.log('PASS',name);
};
async function launch(){
 const env={...process.env,RAYLOOM_MODE:'virtual',RAYLOOM_USER_DATA:runtime,RAYLOOM_UI:'legacy'};delete env.ELECTRON_RUN_AS_NODE;delete env.RAYLOOM_SCREENSHOT;
 const executablePath=process.platform==='win32'?path.join(root,'node_modules','electron','dist','electron.exe'):require(path.join(root,'node_modules','electron'));
 app=await _electron.launch({executablePath,args:[root],cwd:root,env,timeout:60000});
 page=await app.firstWindow({timeout:30000});page.setDefaultTimeout(12000);
 page.on('pageerror',error=>report.rendererErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text().slice(0,1000));});
 await page.waitForLoadState('domcontentloaded');
 assert.equal(path.resolve(await app.evaluate(({app})=>app.getPath('userData'))),path.resolve(runtime),'isolated user data');
 await wait('virtual core and plugins ready',async()=>{const s=await snapshot();if(s.error)throw Error(s.error);return s.mode==='virtual'&&s.status?.pluginsReady&&s.status.detectionPercent>=100;},45000);
 const snap=await snapshot();assert.equal(snap.mode,'virtual');assert.equal(snap.status.virtual,true,'never test a physical core');
 assert.equal((await studio()).mode,'virtual');assert(snap.devices.length>0);
 await wait('discovered components shown',()=>page.locator('.spatial-component').count());
}
async function closeViaTitlebar(){
 const pid=await app.evaluate(()=>process.pid),processes=await app.evaluate(({app})=>app.getAppMetrics().map(metric=>({pid:metric.pid,type:metric.type})));
 const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
 // On Windows Playwright's wrapper can wait on a pipe inherited by the
 // independent agent even after every Electron process has exited. Verify the
 // actual processes, and dispose of the wrapper after our agent is shut down.
 await page.getByRole('button',{name:'Закрыть редактор, оставить подсветку',exact:true}).click();
 try{await wait('all Electron UI processes exit',()=>processes.every(info=>!alive(info.pid)),10000);}
 finally{report.closedElectron={pid,processes:processes.map(info=>({...info,alive:alive(info.pid)}))};}
 retiredApps.push(app);app=null;page=null;
}
async function ensureVirtual(){
 const s=await snapshot();assert.equal(s.mode,'virtual');assert.equal(s.status.virtual,true);
}
const constantSource='<!doctype html><html><head><meta charset="utf-8"><meta property="color" label="Цвет" type="color" default="#123456"><style>html,body{margin:0;overflow:hidden;background:#000}canvas{display:block}</style></head><body><canvas id="effect" width="128" height="128"></canvas><script>const ctx=document.getElementById("effect").getContext("2d");function draw(){ctx.fillStyle=window.rayloomEffect.getState().parameters.color;ctx.fillRect(0,0,128,128);requestAnimationFrame(draw)}draw();</script></body></html>';

try{
 await step('isolated Electron launch and virtual discovery',launch);
 if(process.env.RAYLOOM_UI_CLOSE_ONLY==='1')await step('isolated titlebar close',closeViaTitlebar);else{
 await step('fixed titlebar, bounded body and HeroUI scroll area',async()=>{
  const m=await page.evaluate(()=>{const title=document.querySelector('.titlebar'),scroll=document.querySelector('.studio-scroll'),r=title.getBoundingClientRect();return {bodyOverflow:document.body.scrollHeight-innerHeight,htmlOverflow:document.documentElement.scrollHeight-innerHeight,widthOverflow:document.documentElement.scrollWidth-innerWidth,titleTop:r.top,titleHeight:r.height,titleInsideScroll:scroll.contains(title),scrollOverflow:getComputedStyle(scroll).overflowY,scrollTop:scroll.getBoundingClientRect().top,scrollbarWidth:getComputedStyle(scroll).scrollbarWidth};});
  assert(m.bodyOverflow<=2&&m.htmlOverflow<=2&&m.widthOverflow<=2,JSON.stringify(m));assert.equal(m.titleTop,0);assert.equal(m.titleHeight,36);assert(!m.titleInsideScroll);assert(m.scrollTop>=36);assert(['auto','scroll'].includes(m.scrollOverflow));assert.equal(m.scrollbarWidth,'none');
  await screenshot('01-studio-default');
 });
 await step('default 2D, wheel zoom, Ctrl precision and Shift pan',async()=>{
  assert.equal(await page.getByRole('tab',{name:'2D',exact:true}).getAttribute('aria-selected'),'true');
  const svg=page.getByRole('application',{name:'Двумерное расположение светодиодов'});await svg.scrollIntoViewIfNeeded();
  const box=await svg.boundingBox(),zoom=()=>page.locator('.spatial-zoom').innerText().then(parseFloat);
  const z0=await zoom(),scroll=await page.locator('.studio-scroll').evaluate(el=>el.scrollTop);
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.wheel(0,-240);await wait('wheel zoom changes camera',async()=>await zoom()>z0);
  assert.equal(await page.locator('.studio-scroll').evaluate(el=>el.scrollTop),scroll,'canvas wheel must not scroll the page');
  const z1=await zoom();await page.keyboard.down('Control');await page.mouse.wheel(0,-240);await page.keyboard.up('Control');await wait('fine zoom changes camera',async()=>await zoom()>z1);
  const z2=await zoom();assert(z2/z1<z1/z0,'Ctrl wheel must zoom more gently');
  await page.locator('.spatial-tools').getByRole('button',{name:'Показать всё',exact:true}).click();
  const before=await page.locator('.spatial-component rect').first().getAttribute('x');
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.keyboard.down('Shift');await page.mouse.wheel(0,90);await page.keyboard.up('Shift');
  await wait('Shift wheel pans camera',async()=>await page.locator('.spatial-component rect').first().getAttribute('x')!==before);
  await svg.focus();await page.keyboard.press('f');
 });
 await step('complete searchable effect library, real HeroUI tabs and animated previews',async()=>{
  assert.equal(await page.locator('.effect-card-grid .effect-card').count(),6,'compact featured library');
  const aurora=page.locator('[data-effect="aurora"]');await aurora.scrollIntoViewIfNeeded();
  const bitmap=()=>aurora.locator('canvas').evaluate(canvas=>canvas.toDataURL());
  const staticFrame=await bitmap();await aurora.hover();await wait('hover animates the actual Lumen renderer',async()=>(await bitmap())!==staticFrame);
  await page.getByRole('button',{name:/Показать все/}).click();await wait('all native Effects Plugin entries available',async()=>await page.locator('[data-effect^="openrgb:"]').count()>=58);
  await page.getByRole('tab',{name:'Rayloom',exact:true}).click();assert.equal(await page.locator('.effect-card-grid .effect-card').count(),13);
  const search=page.locator('.effect-library input');await search.fill('Полярное');assert.equal(await page.locator('.effect-card-grid .effect-card').count(),1);
  await search.fill('');await page.getByRole('tab',{name:'Effects Plugin',exact:true}).click();assert(await page.locator('[data-effect^="openrgb:"]').count()>=58);assert.equal(await page.locator('[data-effect="aurora"]').count(),0);
  await page.getByRole('tab',{name:'Rayloom',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await aurora.hover();await delay(100);const still=await bitmap();await delay(150);assert.equal(await bitmap(),still,'reduced motion disables animation');await page.emulateMedia({reducedMotion:'no-preference'});
  await screenshot('02-effect-library');await page.getByRole('button',{name:'Свернуть',exact:true}).click();
 });
 await step('native and SDK previews use their own algorithms without changing devices',async()=>{
  const before=await snapshot(),beforeState=await studio();
  await page.getByRole('button',{name:/Показать все/}).click();await page.getByRole('tab',{name:'Effects Plugin',exact:true}).click();
  const wave=page.locator('[data-effect="openrgb:RainbowWave"]'),canvas=wave.locator('canvas');
  await wave.hover();await wait('native frame received',async()=>await canvas.getAttribute('data-preview-status')==='ready',20000);
  const bitmap=()=>canvas.evaluate(el=>el.toDataURL());const first=await bitmap();await wait('actual native frame animates',async()=>await bitmap()!==first);
  await page.mouse.move(10,10);await wave.focus();
  const mask=page.locator('[data-effect="openrgb:Mask"]');await mask.scrollIntoViewIfNeeded();
  await wait('offscreen keyboard focus releases thumbnail queue',async()=>await mask.locator('canvas').getAttribute('data-preview-status')==='ready',20000);
  await page.locator('.effect-library input').fill('GIF');
  // Match the catalog's exact ID rather than relying on its translated label.
  const catalog=await page.evaluate(()=>window.rayloom.effects('catalog'));const gifEntry=catalog.find(e=>/gif/i.test(e.id));assert(gifEntry);
  const missing=page.locator('[data-effect="openrgb:'+gifEntry.id+'"]');await missing.hover();
  await wait('missing source is explicit',async()=>await missing.locator('canvas').getAttribute('data-preview-status')==='needs-input');
  assert.match(await missing.innerText(),/GIF|изображение/);await screenshot('02-native-preview-input');
  await page.locator('.effect-library input').fill('');await page.getByRole('tab',{name:'Сообщество',exact:true}).click();
  const sdk=page.locator('[data-effect="org.rayloom.reactor/reactor"]');await sdk.hover();
  const pixels=await sdk.locator('canvas').evaluate(el=>[...el.getContext('2d').getImageData(0,0,1,1).data]);
  assert.equal(pixels[0],0,'Reactor red is 1-health at healthy fixture');assert.equal(pixels[2],204,'Reactor blue expression is exactly 0.8');
  assert.deepEqual((await snapshot()).devices.map(d=>d.colors),before.devices.map(d=>d.colors));assert.equal((await studio()).running,beforeState.running);
  await page.getByRole('tab',{name:'Rayloom',exact:true}).click();await page.getByRole('button',{name:'Свернуть',exact:true}).click();
 });
 await step('fullscreen 3D, 95 metre recovery, axis handles and keyboard undo',async()=>{
  await page.getByRole('button',{name:'Развернуть редактор пространства'}).click();
  const dialog=page.getByRole('dialog',{name:'Редактор пространства'});await dialog.waitFor();
  const bounds=await dialog.boundingBox(),size=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  assert.equal(bounds.y,0);assert.equal(bounds.x,0);assert.equal(bounds.width,size.width);assert.equal(bounds.height,size.height);assert.equal((await page.evaluate(()=>window.rayloom.window('state'))).fullscreen,true,'real monitor fullscreen');
  await dialog.getByRole('tab',{name:'3D',exact:true}).click();await dialog.locator('.spatial-component-list button').first().click();await dialog.getByRole('button',{name:'Глубина и наклон в 3D',exact:true}).click();
  componentId=await dialog.locator('.spatial-component.selected').getAttribute('data-component');
  const x=dialog.getByRole('spinbutton',{name:/^Положение X(?: |$)/});
  await fill(x,95000);await dialog.locator('.spatial-offscreen-banner').waitFor();
  assert(await dialog.locator('.spatial-edge-indicator').count()>0);
  await dialog.getByRole('button',{name:'Найти выбранное',exact:true}).click();await dialog.locator('.spatial-component.selected').waitFor();
  await dialog.getByRole('button',{name:'Вернуть в начало пространства',exact:true}).click();await dialog.getByRole('button',{name:'Найти выбранное',exact:true}).click();
  const handle=dialog.locator('[data-axis="x"] circle'),handleBox=await handle.boundingBox();assert(handleBox);
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();await page.mouse.move(handleBox.x+handleBox.width/2+35,handleBox.y+handleBox.height/2,{steps:6});await page.mouse.up();
  await wait('X handle moves only X',async()=>Math.abs(Number(await x.inputValue()))>1);
  assert.equal(Number(await dialog.getByRole('spinbutton',{name:/^Положение Y(?: |$)/}).inputValue()),0);assert.equal(Number(await dialog.getByRole('spinbutton',{name:/^Положение Z(?: |$)/}).inputValue()),0);
  const svg=dialog.getByRole('application');await svg.focus();await page.keyboard.press('Control+z');await wait('undo restores X',async()=>Number(await x.inputValue())===0);
  await dialog.getByRole('tab',{name:'2D',exact:true}).click();await svg.focus();await page.keyboard.press('Shift+ArrowRight');await wait('keyboard 10 mm step',async()=>Number(await x.inputValue())===10);await page.keyboard.press('Control+z');
  await dialog.getByRole('tab',{name:'3D',exact:true}).click();
  const rect=dialog.locator('.spatial-component.selected rect'),before=await rect.getAttribute('width'),s=await svg.boundingBox();
  await page.mouse.move(s.x+70,s.y+65);await page.keyboard.down('Alt');await page.mouse.down();await page.mouse.move(s.x+115,s.y+80,{steps:5});await page.mouse.up();await page.keyboard.up('Alt');await wait('Alt drag orbits camera',async()=>await rect.getAttribute('width')!==before);
  assert.equal(Number(await x.inputValue()),0,'orbit must not move the component');
  await screenshot('02-spatial-3d');await svg.focus();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await wait('native fullscreen exits',async()=>!(await page.evaluate(()=>window.rayloom.window('state'))).fullscreen);
 });
 await step('component and device aliases persist through UI save',async()=>{
  await page.getByRole('textbox',{name:'Название компонента',exact:true}).fill('Передние вентиляторы');
  await nav('Устройства');const alias=page.locator('.device-alias-label input').first();await alias.fill('Тестовый контроллер');await page.locator('.device-save-bar').getByRole('button',{name:'Сохранить',exact:true}).click();
  const saved=await wait('aliases saved',async()=>{const s=await studio();return s.layout.components.find(c=>c.id===componentId)?.name==='Передние вентиляторы'&&Object.values(s.layout.deviceAliases??{}).includes('Тестовый контроллер')&&s;});
  report.componentId=componentId;report.deviceKey=saved.layout.components.find(c=>c.id===componentId).deviceKey;
  await screenshot('03-device-cards');
 });
 await step('background runtime settings hide diagnostics and disable real autostart in virtual mode',async()=>{
  await nav('Настройки');await page.getByRole('heading',{name:'Работа после закрытия окна',exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:'Запускать подсветку вместе с Windows',exact:true}).isDisabled(),true);
  assert(!/Память агента|SMBus|PawnIO|Chromium/.test(await page.locator('.runtime-settings').innerText()));assert.equal(await page.getByRole('button',{name:'Разрешить доступ',exact:true}).count(),0);
  await page.getByRole('button',{name:'Техническая диагностика',exact:true}).click();assert.match(await page.locator('.runtime-diagnostics').innerText(),/Память агента/);
  await screenshot('03-background-settings');
 });
 await step('group creation explains missing members and activates selected ports',async()=>{
  await nav('Группы');await page.getByRole('textbox',{name:'Название группы',exact:true}).fill('Корпус');await page.getByRole('button',{name:'Сохранить группу',exact:true}).click();
  await page.getByText('Отметьте хотя бы одно устройство или порт.',{exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'Добавить в группу: Передние вентиляторы',exact:true}).press('Space');await page.getByRole('button',{name:'Сохранить группу',exact:true}).click();
  const group=await wait('group saved',async()=>(await studio()).layout.groups.find(g=>g.name==='Корпус'));groupId=group.id;assert.deepEqual(group.members,[componentId]);
  await screenshot('03-groups');await page.getByRole('button',{name:'Назначить эффект группе',exact:true}).click();await wait('group activated',async()=>(await page.getByRole('button',{name:/Группа подсветки/}).innerText()).includes('Корпус'));
 });
 await step('device disable hides the controller from space and preserves its saved matrix',async()=>{
  const before=(await studio()).layout.components.find(c=>c.id===componentId);await nav('Устройства');
  await toggleSwitch('Участвует в подсветке: Тестовый контроллер');
  await wait('device disabled immediately',async()=>!(await studio()).layout.components.find(c=>c.id===componentId).enabled);await nav('Моя подсветка');assert.equal(await page.locator('[data-component="'+componentId+'"]').count(),0);
  await nav('Устройства');const toggle=page.getByRole('switch',{name:'Участвует в подсветке: Тестовый контроллер',exact:true});await toggle.focus();await toggle.press('Space');
  await wait('device enabled immediately',async()=>(await studio()).layout.components.find(c=>c.id===componentId).enabled);await nav('Моя подсветка');await page.locator('[data-component="'+componentId+'"]').waitFor();
  const after=(await studio()).layout.components.find(c=>c.id===componentId);assert.deepEqual(after.points,before.points);assert.deepEqual(after.pose,before.pose);
 });
 await step('effect-specific parameters and actual HeroUI controls',async()=>{
  await page.getByRole('button',{name:/Показать все/}).click();await page.locator('[data-effect="wave"]').click();await page.getByRole('button',{name:/Показать все/}).waitFor();
  await page.locator('[data-effect="prism"]').click();
  const prism=page.locator('[data-effect-parameters="prism"]');await prism.waitFor();assert.equal(await prism.getByRole('button',{name:/Выбрать.*Цвет/}).count(),0,'fixed-palette Prism has no fake color setting');
  await page.getByRole('button',{name:/Показать все/}).click();await page.locator('[data-effect="wave"]').click();await page.getByRole('button',{name:/Показать все/}).waitFor();
  const speed=page.getByRole('slider',{name:'Скорость',exact:true});await speed.focus();await speed.press('End');assert.equal(await speed.inputValue(),'10');
  const scale=page.getByRole('slider',{name:'Размер рисунка',exact:true});await scale.focus();await scale.press('Home');assert.equal(await scale.inputValue(),'1');
  await page.getByText('Качество воспроизведения',{exact:true}).click();await select('Целевая частота кадров','120 FPS');
  await page.getByRole('button',{name:'Выбрать: Цвет эффекта',exact:true}).click();const picker=page.getByRole('dialog',{name:'Цвет эффекта',exact:true});await picker.waitFor();
  await fill(picker.getByRole('textbox',{name:'HEX',exact:true}),'#123456');await wait('HEX field changes selected color',async()=>(await page.getByRole('button',{name:'Выбрать: Цвет эффекта',exact:true}).innerText()).includes('#123456'));
  await screenshot('04-color-picker');await page.keyboard.press('Escape');
  await ensureVirtual();await page.getByRole('button',{name:'Включить',exact:true}).click();
  const state=await wait('normalized wave running',async()=>{const s=await studio();return s.running&&s.current?.speed===10&&s;});
  assert.equal(state.current.scale,1);assert.equal(state.current.color,0x563412);assert.equal(state.current.fps,120);assert.equal(state.current.group,groupId);assert.equal(state.error,'');
  const metrics=await wait('frame performance samples',async()=>{const s=await studio();return s.metrics.achievedFps>0&&s.metrics.frames>5&&s.metrics;});report.frameMetrics=metrics;
  assert(!/invalid scene range|Error invoking remote method/.test(await page.locator('body').innerText()));
 });
 await step('identify port restores running scene and RGB calibration saves',async()=>{
  await ensureVirtual();await page.getByRole('button',{name:'Какой это порт?',exact:true}).click();await page.getByText('Порт определён: три красных импульса. Предыдущее освещение восстановлено.',{exact:true}).waitFor({timeout:15000});assert.equal((await studio()).running,true);
  await page.getByRole('button',{name:'Калибровать цвета',exact:true}).click();const wizard=page.getByRole('dialog',{name:'Настроим цвета'});await wizard.waitFor();await wizard.getByRole('button',{name:'Начать проверку',exact:true}).click();
  await wizard.getByText('Вопрос 1 из 3',{exact:true}).waitFor();await wizard.getByRole('button',{name:'Синий',exact:true}).click();await wizard.getByText('Вопрос 2 из 3',{exact:true}).waitFor();await wizard.getByRole('button',{name:'Зелёный',exact:true}).click();await wizard.getByText('Вопрос 3 из 3',{exact:true}).waitFor();await wizard.getByRole('button',{name:'Красный',exact:true}).click();
  await wizard.getByText('Теперь должен гореть красный',{exact:true}).waitFor();assert.equal(await wizard.locator('.calibration-result strong').innerText(),'BGR');await screenshot('04-calibration-wizard');await wizard.getByRole('button',{name:'Да, сохранить',exact:true}).click();await wizard.waitFor({state:'hidden'});assert.equal((await studio()).running,true);
  assert.equal((await studio()).layout.components.find(c=>c.id===componentId).calibration.channelOrder,'BGR');
  await page.getByRole('button',{name:'Калибровать цвета',exact:true}).click();await wizard.getByRole('button',{name:'Начать проверку',exact:true}).click();await wizard.getByText('Вопрос 1 из 3',{exact:true}).waitFor();await wizard.getByRole('button',{name:'Отменить и вернуть подсветку',exact:true}).click();await wizard.waitFor({state:'hidden'});assert.equal((await studio()).running,true);
  await page.getByText('Ручная коррекция цветов',{exact:true}).click();assert((await page.getByRole('button',{name:/Порядок цветовых каналов/}).innerText()).includes('BGR'));
  await wait('BGR calibration saved',async()=>(await studio()).layout.components.find(c=>c.id===componentId)?.calibration?.channelOrder==='BGR');
  await select('Порядок цветовых каналов','RGB');await page.getByRole('button',{name:'Сохранить расположение',exact:true}).click();
  await wait('RGB calibration restored',async()=>(await studio()).layout.components.find(c=>c.id===componentId)?.calibration?.channelOrder==='RGB');
 });
 await step('scene saves layout and normalized effect settings',async()=>{
  await nav('Сцены и игры');await page.getByRole('textbox',{name:'Название пространственной сцены',exact:true}).fill('UI regression');await page.getByRole('button',{name:'Сохранить сцену',exact:true}).click();
  const scene=await wait('scene saved',async()=>(await studio()).scenes.find(s=>s.name==='UI regression'));assert.equal(scene.config.speed,10);assert.equal(scene.config.fps,120);assert.equal(scene.config.color,0x563412);assert(scene.layout.groups.some(g=>g.id===groupId));
 });
 await step('HTML Canvas preview, native virtual output and library save',async()=>{
  const lightingBefore=await studio();
  await nav('Создать эффект');await page.getByRole('textbox',{name:'Название Canvas-эффекта',exact:true}).fill('Canvas UI regression');await page.getByRole('textbox',{name:'HTML-код эффекта',exact:true}).fill(constantSource);
  await page.getByRole('button',{name:'Предпросмотр',exact:true}).click();const preview=await wait('HTML preview frames',async()=>{const s=await canvas();if(s.error)throw Error(s.error);return s.running&&s.frames>3&&s.preview&&s;});assert.equal(preview.output,false);assert.equal((await studio()).running,lightingBefore.running,'HTML preview preserves existing lighting');assert.deepEqual((await studio()).current,lightingBefore.current);await page.getByAltText('Последний кадр Canvas-эффекта').waitFor();
  await page.locator('.canvas-document-actions').getByRole('button',{name:'Сохранить',exact:true}).click();const list=await wait('Canvas library saved',async()=>{const items=await page.evaluate(()=>window.rayloom.canvas('list'));return items.find(i=>i.name==='Canvas UI regression');});canvasId=list.id;
  await ensureVirtual();await page.getByRole('button',{name:'Включить на устройствах',exact:true}).click();await wait('Canvas output reaches virtual LEDs',async()=>{const s=await canvas(),d=await snapshot();return s.output&&d.devices.some(device=>device.colors.includes(0x38220c));},15000);
  // 65% scene brightness maps #123456 to RGB (12,34,56), stored by OpenRGB as 0x38220c.
  const state=await studio();assert.equal(state.current.effect,'canvas:editor');assert.equal(state.current.group,groupId);
  await page.getByAltText('Последний кадр Canvas-эффекта').waitFor();
  await page.locator('.studio-scroll').evaluate(el=>el.scrollTo({top:0}));
  await page.getByRole('textbox',{name:'HTML-код эффекта',exact:true}).evaluate(el=>{el.scrollTop=0;el.scrollLeft=0;});
  await screenshot('05-canvas-editor');
 });
 await step('dirty layout identify resumes Canvas; static output yields to another scene safely',async()=>{
  const before=await studio();await nav('Моя подсветка');
  await fill(page.getByRole('spinbutton',{name:/^Положение X(?: |$)/}),5);
  await ensureVirtual();await page.getByRole('button',{name:'Какой это порт?',exact:true}).click();
  await wait('dirty identify persists pose and rebinds Canvas',async()=>{const s=await studio(),c=await canvas();return s.running&&s.current?.effect==='canvas:editor'&&s.canvasSession!==before.canvasSession&&s.layout.components.find(p=>p.id===componentId)?.pose.x===5&&c.output;},15000);
  await wait('resumed Canvas pixels',async()=>(await snapshot()).devices.some(d=>d.colors.includes(0x38220c)));
  await nav('Создать эффект');await page.getByRole('textbox',{name:'HTML-код эффекта',exact:true}).fill(constantSource.replace('requestAnimationFrame(draw)',''));
  await page.getByRole('button',{name:'Включить на устройствах',exact:true}).click();await wait('static Canvas output starts',async()=>(await canvas()).output);
  await nav('Моя подсветка');await page.getByRole('button',{name:'Применить изменения',exact:true}).click();await wait('wave takes ownership',async()=>(await studio()).current?.effect==='wave');
  await wait('static Canvas notices ownership loss without another paint',async()=>!(await canvas()).output);
  await nav('Создать эффект');const stopPreview=page.getByRole('button',{name:'Стоп',exact:true});
  if((await canvas()).running)await stopPreview.click();else{assert.equal(await stopPreview.isDisabled(),true,'released HTML host has no running preview');await page.evaluate(()=>window.rayloom.canvas('stop'));}
  await wait('Canvas preview stops',async()=>!(await canvas()).running);
  const wave=await studio();assert.equal(wave.running,true,'stopping an unowned Canvas preview must not stop another effect');assert.equal(wave.current.effect,'wave');
 });
 await step('Electron titlebar maximize, minimize and tray hide',async()=>{
  const state=()=>page.evaluate(()=>window.rayloom.window('state'));const original=(await state()).maximized;
  await page.getByRole('button',{name:'Развернуть или восстановить окно',exact:true}).click();await wait('window maximize toggle',async()=>(await state()).maximized!==original);
  await page.getByRole('button',{name:'Развернуть или восстановить окно',exact:true}).click();await wait('window restores original size',async()=>(await state()).maximized===original);
  await page.getByRole('button',{name:'Свернуть окно',exact:true}).click();await wait('window minimizes',async()=>(await state()).minimized);
  await app.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));main.restore();main.show();main.focus();});
  await page.getByRole('button',{name:'Скрыть в трей',exact:true}).click();await wait('window hides in tray',async()=>!(await state()).visible);
  await app.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));main.show();main.focus();});
 });
 await step('advanced effects use HeroUI tabs and preserve typed enum values',async()=>{
  const catalog=await page.evaluate(()=>window.rayloom.effects('catalog'));
  const description=catalog.find(effect=>effect.fields.some(field=>field.type==='enum'&&field.options?.length>1));assert(description,'native enum example');const field=description.fields.find(field=>field.type==='enum'&&field.options?.length>1);
  const runningBefore=(await studio()).running;await page.getByRole('button',{name:'Расширенные инструменты',exact:true}).click();assert.equal((await studio()).running,runningBefore,'navigation must not stop lighting');await page.getByRole('tab',{name:'Добавить эффект',exact:true}).click();await page.getByRole('tablist',{name:'Категории эффектов OpenRGB'}).waitFor();
  assert.equal(await page.locator('.advanced-content-scroll').evaluate(element=>element.contains(document.querySelector('.titlebar'))),false,'advanced titlebar stays outside the scroll mask');
  await page.getByRole('textbox',{name:'Поиск эффектов',exact:true}).fill(description.name);await page.locator('.catalog-card').filter({has:page.getByText(description.name,{exact:true})}).click();
  assert(await page.locator('.effect-settings [data-slot="select-trigger"]').count()>0,'HeroUI Select renders the interactive trigger; its hidden native select is for forms');
  const controls=page.locator('.effect-settings');await controls.getByRole('button',{name:new RegExp(field.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();await page.getByRole('option',{name:field.options[1].label,exact:true}).click();
  assert((await controls.getByRole('button',{name:new RegExp(field.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).innerText()).includes(field.options[1].label));
  await page.getByRole('listbox').waitFor({state:'hidden'});await screenshot('06-advanced-controls');await page.getByRole('button',{name:'← Моя подсветка',exact:true}).click();await wait('native effect continues after advanced UI inspection',async()=>{const state=await studio();return state.running&&state.current.effect==='wave'&&state.metrics.frames>3;});
  await page.getByRole('button',{name:'Расширенные инструменты',exact:true}).click();await page.getByRole('heading',{name:'Настройки · '+description.name,exact:true}).waitFor();
  assert((await page.locator('.effect-settings').getByRole('button',{name:new RegExp(field.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).innerText()).includes(field.options[1].label),'returning preserves unapplied effect draft');
  await page.locator('.advanced-content-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);assert.equal(await page.getByRole('button',{name:'Вернуться к подсветке',exact:true}).isVisible(),true,'persistent return stays visible while scrolled');await page.getByRole('button',{name:'Вернуться к подсветке',exact:true}).click();
 });
 await step('custom close and restart retain aliases, groups, scene and Canvas effect',async()=>{
  const originalRuntime=await page.evaluate(()=>window.rayloom.studio('runtime.state'));await closeViaTitlebar();
  const background=await connectRuntime(root,runtime,'virtual',{launch:false});try{const info=await background.call('runtime.state');assert.equal(info.pid,originalRuntime.pid);assert.equal(info.htmlRenderer,false,'native effects do not keep a Chromium host');const before=await background.call('studio',{method:'state'});assert.equal(before.running,true);await delay(300);const after=await background.call('studio',{method:'state'});assert(after.metrics.frames>before.metrics.frames,'native frames continue after Electron closes');report.backgroundMemory=info.memory;}finally{background.close();}
  await launch();const state=await studio(),component=state.layout.components.find(c=>c.id===componentId);
  assert.equal(component?.name,'Передние вентиляторы');assert.equal(state.layout.deviceAliases[report.deviceKey],'Тестовый контроллер');assert.equal(component.calibration.channelOrder,'RGB');assert(state.layout.groups.some(g=>g.id===groupId&&g.members.includes(componentId)));assert(state.scenes.some(s=>s.name==='UI regression'&&s.config.speed===10));
  const saved=await page.evaluate(id=>window.rayloom.canvas('read',{id}),canvasId);assert.equal(saved.source,constantSource);assert.equal(saved.name,'Canvas UI regression');
  assert.equal(await page.getByRole('tab',{name:'2D',exact:true}).getAttribute('aria-selected'),'true');await screenshot('06-restarted');
 });
 }
 if(process.env.RAYLOOM_UI_CLOSE_ONLY!=='1')await step('plugin read failure cannot trap navigation or interrupt lighting',async()=>{
  const before=await studio();
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('rayloom:effects');ipcMain.handle('rayloom:effects',()=>{throw Error("[json.exception.out_of_range.403] key 'UserColors' not found");});});
  await page.getByRole('button',{name:'Расширенные инструменты',exact:true}).click();
  await page.getByText('Не удалось загрузить настройки эффекта',{exact:true}).waitFor();
  await screenshot('07-plugin-error-recovery');
  await page.getByRole('button',{name:'Вернуться к подсветке',exact:true}).click();
  await page.getByRole('heading',{name:'Моя подсветка',exact:true}).waitFor();
  const after=await studio();assert.equal(after.running,before.running);assert.deepEqual(after.current,before.current);
 });
 assert.deepEqual(report.rendererErrors,[],'unhandled renderer exceptions');report.passed=true;
}catch(error){
 report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);
 if(page&&!page.isClosed()){await screenshot('failure').catch(()=>{});await fs.promises.writeFile(path.join(artifacts,'failure-dom.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));}
}finally{
 try{const client=await connectRuntime(root,runtime,'virtual',{launch:false});await client.call('shutdown');client.close();}catch(error){if(fs.existsSync(path.join(runtime,'runtime.json'))){report.runtimeCleanupError=error.message;process.exitCode=1;}}
 if(app)await app.close().catch(error=>{report.cleanupError=error.message;process.exitCode=1;});
 for(const previous of retiredApps)await previous.close().catch(error=>{report.cleanupError=error.message;process.exitCode=1;});
 report.finished=new Date().toISOString();fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));
 fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts','ui-integration.json'),JSON.stringify(report,null,2));
 console.log('UI report:',path.join(artifacts,'report.json'));
}
