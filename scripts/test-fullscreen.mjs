// Real Electron regression using an isolated runtime and virtual LEDs only.
// Run after npm run build. No profile, startup task or physical light is changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';
import {deviceKey} from '../shared/spatial.mjs';

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
function playwrightPath(){
 if(process.env.LUMEN_PLAYWRIGHT_MODULE)return process.env.LUMEN_PLAYWRIGHT_MODULE;
 try{return require.resolve('playwright');}catch{}
 for(const cache of [...new Set([process.env.npm_config_cache,process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'npm-cache'),path.join(os.homedir(),'AppData','Local','npm-cache'),path.join(os.homedir(),'.npm')].filter(Boolean))]){
  const folder=path.join(cache,'_npx');if(!fs.existsSync(folder))continue;
  for(const entry of fs.readdirSync(folder,{withFileTypes:true}).filter(item=>item.isDirectory())){
   const candidate=path.join(folder,entry.name,'node_modules','playwright');if(fs.existsSync(path.join(candidate,'package.json')))return candidate;
  }
 }
 throw Error('Set LUMEN_PLAYWRIGHT_MODULE to an existing Playwright installation.');
}
const {_electron}=require(playwrightPath()),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-fullscreen-'));
const artifacts=path.join(root,'output','playwright','fullscreen-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(artifacts,{recursive:true});
const report={started:new Date().toISOString(),runtime,artifacts,physicalHardwareTested:false,checks:[],rendererErrors:[]};
let app,page,componentId,groupId,processes=[];
const wait=async(label,read,timeout=15000)=>{const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await read();if(value)return value;}catch(error){last=error;}await delay(80);}throw Error('Timed out: '+label+(last?' '+last.message:''));};
const check=async(name,action)=>{const started=Date.now();await action();report.checks.push({name,ms:Date.now()-started});console.log('PASS',name);};
const studio=()=>page.evaluate(()=>window.rayloom.studio('state'));
const windowState=()=>page.evaluate(()=>window.rayloom.window('state'));
const nav=name=>page.locator('.studio-nav').getByRole('button',{name:new RegExp('^'+name)}).click();
const screenshot=name=>page.screenshot({path:path.join(artifacts,name+'.png')});
const dialog=()=>page.getByRole('dialog',{name:'Редактор пространства',exact:true});
const inspector=()=>dialog().locator('.spatial-expanded-inspector');
const selected=()=>studio().then(state=>state.layout.components.find(item=>item.id===componentId));
const toggle=async(scope,name)=>{const field=scope.getByRole('switch',{name,exact:true});await field.focus();await field.press('Space');};
const open=async()=>{await page.getByRole('button',{name:'Развернуть редактор пространства',exact:true}).click();await dialog().waitFor();assert.equal((await windowState()).fullscreen,true);};
const save=async()=>{await inspector().getByRole('button',{name:'Сохранить расположение',exact:true}).click();await wait('fullscreen save completes',async()=>await inspector().getByRole('button',{name:'Сохранить расположение',exact:true}).isDisabled()&&await inspector().getByRole('button',{name:'Какой это порт?',exact:true}).isEnabled());};
const fullScreenRemains=async()=>{assert.equal(await dialog().isVisible(),true);assert.equal((await windowState()).fullscreen,true);};
const isAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};

try{
 await check('isolated virtual runtime and initial user workflow',async()=>{
  const env={...process.env,LUMEN_MODE:'virtual',LUMEN_USER_DATA:runtime,LUMEN_UI:'legacy'};delete env.ELECTRON_RUN_AS_NODE;delete env.LUMEN_SCREENSHOT;
  app=await _electron.launch({executablePath:path.join(root,'node_modules','electron','dist','electron.exe'),args:[root],cwd:root,env,timeout:60000});
  page=await app.firstWindow({timeout:30000});page.setDefaultTimeout(15000);page.on('pageerror',error=>report.rendererErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  assert.equal(path.resolve(await app.evaluate(({app})=>app.getPath('userData'))),path.resolve(runtime));
  await wait('virtual discovery',async()=>{const snap=await page.evaluate(()=>window.rayloom.snapshot());assert.equal(snap.mode,'virtual');if(snap.error)throw Error(snap.error);return snap.status?.virtual&&snap.status?.pluginsReady&&snap.status.detectionPercent>=100;},60000);
  await wait('visible components',()=>page.locator('.spatial-component').count());
  await page.locator('.studio-inspector .component-list button').first().click();
  componentId=await page.locator('.spatial-component.selected').getAttribute('data-component');assert(componentId);
  await page.getByRole('textbox',{name:'Название компонента',exact:true}).fill('Передние вентиляторы');
  await nav('Группы');await page.getByRole('textbox',{name:'Название группы',exact:true}).fill('Корпус');
  const member=page.getByRole('checkbox',{name:'Добавить в группу: Передние вентиляторы',exact:true});await member.focus();await member.press('Space');
  await page.getByRole('button',{name:'Сохранить группу',exact:true}).click();
  groupId=(await wait('group saved',async()=>(await studio()).layout.groups.find(group=>group.name==='Корпус'))).id;
  await nav('Моя подсветка');await page.getByRole('button',{name:'Включить',exact:true}).click();await wait('effect running',async()=>(await studio()).running);
 });
 await check('fullscreen has one complete inspector with persisted name and save',async()=>{
  await open();assert.equal(await page.getByRole('textbox',{name:'Название компонента',exact:true}).count(),1,'only one mounted editor');
  const before=await studio();assert.equal(before.running,true);
  await inspector().getByRole('textbox',{name:'Название компонента',exact:true}).fill('Фронтальные вентиляторы');
  await save();assert.equal((await selected()).name,'Фронтальные вентиляторы');
  const resumed=await studio();assert.equal(resumed.running,true,'saving from fullscreen must resume the active effect');assert.deepEqual(resumed.current,before.current);
  await wait('frames advance after fullscreen save',async()=>(await studio()).metrics.frames>resumed.metrics.frames);
  assert.equal(await inspector().getByRole('button',{name:'Какой это порт?',exact:true}).isEnabled(),true);
  assert.equal(await inspector().getByRole('button',{name:'Калибровать цвета',exact:true}).isEnabled(),true);
  await screenshot('01-fullscreen-controls');
 });
 await check('identify inside fullscreen restores active scene and shows feedback',async()=>{
  const before=await studio();assert.equal(before.running,true);
  await inspector().getByRole('button',{name:'Какой это порт?',exact:true}).click();
  await inspector().getByText('Порт определён: три красных импульса. Предыдущее освещение восстановлено.',{exact:true}).waitFor();
  const after=await studio();assert.equal(after.running,true);assert.deepEqual(after.current,before.current);await fullScreenRemains();
 });
 await check('calibration overlay owns Escape and restores light without leaving fullscreen',async()=>{
  await inspector().getByRole('button',{name:'Калибровать цвета',exact:true}).click();
  const wizard=page.getByRole('dialog',{name:'Настроим цвета',exact:true});await wizard.waitFor();
  await wizard.getByRole('button',{name:'Начать проверку',exact:true}).click();await wizard.getByText('Вопрос 1 из 3',{exact:true}).waitFor();
  await wait('calibration ready for cancellation',()=>wizard.getByRole('button',{name:'Отменить и вернуть подсветку',exact:true}).isEnabled());
  report.calibrationFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,160),insideWizard:!!document.activeElement?.closest('.calibration-wizard')}));
  assert.equal(report.calibrationFocus.insideWizard,true,'phase change must retain modal focus');
  await screenshot('02-fullscreen-calibration');
  await page.keyboard.press('Escape');await wizard.waitFor({state:'hidden'});await fullScreenRemains();
  await wait('calibration cancellation restores scene',async()=>(await studio()).running);
  assert.equal(await page.evaluate(()=>window.rayloom.studio('calibration.state')),null);
 });
 await check('group membership edits are available and saved in fullscreen',async()=>{
  await inspector().getByRole('button',{name:'Группы компонента',exact:true}).click();
  assert.equal(await inspector().getByRole('switch',{name:'Корпус',exact:true}).isChecked(),true);
  await toggle(inspector(),'Корпус');await save();
  assert.equal((await studio()).layout.groups.find(group=>group.id===groupId).members.includes(componentId),false);
  await toggle(inspector(),'Корпус');await save();
  assert.equal((await studio()).layout.groups.find(group=>group.id===groupId).members.includes(componentId),true);
 });
 await check('disabled component stays editable in list and returns to scene',async()=>{
  const before=await selected();
  await toggle(inspector(),'Участвует в подсветке');
  assert.equal(await dialog().locator('.spatial-component[data-component="'+componentId+'"]').count(),0);
  assert.equal(await dialog().locator('.spatial-component-list button.selected').count(),1);
  await inspector().getByRole('textbox',{name:'Название компонента',exact:true}).fill('Выключенный порт');
  await save();assert.equal((await selected()).enabled,false);assert.equal((await selected()).name,'Выключенный порт');
  await wait('disabled component LEDs are black',async()=>{const snap=await page.evaluate(()=>window.rayloom.snapshot()),device=snap.devices.find(device=>deviceKey(device)===before.deviceKey);return device&&before.points.every(point=>device.colors[point.led]===0);});
  await toggle(inspector(),'Участвует в подсветке');await save();
  await dialog().locator('.spatial-component[data-component="'+componentId+'"]').waitFor();
  assert.equal((await selected()).enabled,true);
 });
 await check('HeroUI RGB selection popover owns Escape and accepts values',async()=>{
  await inspector().getByRole('button',{name:'Ручная коррекция цветов',exact:true}).click();
  const select=inspector().getByRole('button',{name:/Порядок цветовых каналов/});
  await select.click();await page.getByRole('option',{name:'BGR',exact:true}).waitFor();
  await page.keyboard.press('Escape');await page.getByRole('listbox').waitFor({state:'hidden'});await fullScreenRemains();
  await select.click();await page.getByRole('option',{name:'BGR',exact:true}).click();await save();
  assert.equal((await selected()).calibration.channelOrder,'BGR');await fullScreenRemains();
 });
 await check('input typing and numeric arrows never move or pan the canvas',async()=>{
  const before=(await selected()).pose,name=inspector().getByRole('textbox',{name:'Название компонента',exact:true});
  await name.fill('Порт');await name.press('End');await name.press('Space');await name.press('ArrowLeft');await name.press('ArrowRight');
  assert.equal(await name.inputValue(),'Порт ');await fullScreenRemains();
  const x=inspector().getByRole('spinbutton',{name:/^Положение X(?: |$)/});
  await x.fill('42');await x.press('Tab');await x.focus();await x.press('ArrowUp');
  assert.equal(Number(await x.inputValue()),42.1);
  await x.press('Escape');await fullScreenRemains();
  await name.fill('Тихие вентиляторы');await name.press('Control+s');
  await wait('Ctrl+S persists name and number',async()=>{const c=await selected();return c.name==='Тихие вентиляторы'&&c.pose.x===42.1;});
  assert.equal((await selected()).pose.y,before.y);assert.equal((await selected()).pose.z,before.z);
 });
 await check('matrix and 3D controls fit the full inspector without page overflow',async()=>{
  await inspector().getByRole('button',{name:'Глубина и наклон в 3D',exact:true}).click();
  const z=inspector().getByRole('spinbutton',{name:/^Положение Z(?: |$)/});await z.fill('50');await z.press('Tab');
  await inspector().getByRole('button',{name:'Форма и порядок светодиодов',exact:true}).click();
  await inspector().getByRole('button',{name:'Форма компонента'}).waitFor();await save();
  await dialog().getByRole('tab',{name:'3D',exact:true}).click();
  const metrics=await page.evaluate(()=>{const inspector=document.querySelector('.spatial-expanded-inspector'),scroll=document.querySelector('.spatial-inspector-scroll'),footer=document.querySelector('.spatial-expanded-footer');return {overflow:document.documentElement.scrollWidth-innerWidth,inspectorOverflow:inspector.scrollWidth-inspector.clientWidth,footerBottom:footer.getBoundingClientRect().bottom,height:innerHeight,scrollable:scroll.scrollHeight>scroll.clientHeight};});
  assert(metrics.overflow<=1&&metrics.inspectorOverflow<=1,JSON.stringify(metrics));assert(metrics.footerBottom<=metrics.height+1);assert(metrics.scrollable);
  await inspector().locator('.spatial-inspector-scroll').evaluate(el=>el.scrollTo({top:0}));await screenshot('03-fullscreen-saved');
 });
 await check('Escape leaves fullscreen; reopen retains all selected edits',async()=>{
  await dialog().getByRole('application').focus();await page.keyboard.press('Escape');
  await dialog().waitFor({state:'hidden'});assert.equal((await windowState()).fullscreen,false);
  assert.equal(await page.getByRole('textbox',{name:'Название компонента',exact:true}).inputValue(),'Тихие вентиляторы');
  await open();assert.equal(await inspector().getByRole('textbox',{name:'Название компонента',exact:true}).inputValue(),'Тихие вентиляторы');
  assert.equal(await inspector().getByRole('switch',{name:'Участвует в подсветке',exact:true}).isChecked(),true);
  const component=await selected();assert.equal(component.pose.x,42.1);assert.equal(component.pose.z,50);assert.equal(component.calibration.channelOrder,'BGR');
  await dialog().getByRole('button',{name:'Закрыть большой редактор',exact:true}).click();await dialog().waitFor({state:'hidden'});
 });
 assert.deepEqual(report.rendererErrors,[]);report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);if(page&&!page.isClosed()){await screenshot('failure').catch(()=>{});fs.writeFileSync(path.join(artifacts,'failure-dom.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));}}
finally{
 if(app)processes=await app.evaluate(({app})=>app.getAppMetrics().map(process=>process.pid)).catch(()=>[]);
 try{const client=await connectRuntime(root,runtime,'virtual',{launch:false});await client.call('shutdown');client.close();await wait('test runtime removed',()=>!fs.existsSync(path.join(runtime,'runtime.json')),15000);}catch(error){if(fs.existsSync(path.join(runtime,'runtime.json'))){report.cleanupError=error.message;process.exitCode=1;}}
 if(app)await app.close().catch(error=>{report.cleanupError=error.message;process.exitCode=1;});
 await wait('test Electron processes closed',()=>processes.every(pid=>!isAlive(pid)),12000).catch(error=>{report.cleanupError=error.message;process.exitCode=1;});
 report.processes=processes.map(pid=>({pid,alive:isAlive(pid)}));report.finished=new Date().toISOString();fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(artifacts,'report.json'));
}
