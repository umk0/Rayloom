// Real Electron regression: local Monaco, Canvas ownership and explicit plugin drafts.
// Uses an isolated virtual runtime. No physical devices or Windows settings are changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';
import {discoverLayout} from '../shared/spatial.mjs';

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
function playwright(){
  if(process.env.LUMEN_PLAYWRIGHT_MODULE)return require(process.env.LUMEN_PLAYWRIGHT_MODULE);
  try{return require('playwright');}catch{}
  for(const base of [process.env.npm_config_cache,process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'npm-cache'),path.join(os.homedir(),'AppData/Local/npm-cache'),path.join(os.homedir(),'.npm')].filter(Boolean)){
    const dir=path.join(base,'_npx');if(!fs.existsSync(dir))continue;
    for(const item of fs.readdirSync(dir)){const candidate=path.join(dir,item,'node_modules/playwright');if(fs.existsSync(path.join(candidate,'package.json')))return require(candidate);}
  }
  throw Error('Use LUMEN_PLAYWRIGHT_MODULE to select an installed Playwright package.');
}
const {_electron}=playwright(),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'rayloom-authoring-'));
const output=path.join(root,'output/playwright/authoring-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(output,{recursive:true});
const report={physicalHardwareTested:false,checks:[],pageErrors:[],consoleErrors:[],externalRequests:[]};let app,page;
const wait=async(label,fn,timeout=15000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await fn();if(value)return value;await delay(70);}throw Error('Timeout: '+label);};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
const canvas=(method,args={})=>page.evaluate(([method,args])=>window.rayloom.canvas(method,args),[method,args]);
const studio=()=>page.evaluate(()=>window.rayloom.studio('state'));
const snapshot=()=>page.evaluate(()=>window.rayloom.snapshot());
const source=color=>`<!doctype html><meta property="color" label="Цвет" type="color" default="${color}"><meta property="speed" label="Скорость" type="number" min="0" max="10" default="1"><canvas width="128" height="128" id="c"></canvas><script>const context=c.getContext('2d');function draw(){context.fillStyle=window.rayloomEffect.getState().parameters.color;context.fillRect(0,0,128,128);requestAnimationFrame(draw)}draw();</script>`;
const nav=name=>page.locator('.ray-navigation').getByRole('button',{name,exact:true}).click();
const editCode=async(value)=>{
  const input=page.locator('.monaco-editor').getByRole('textbox').first();await input.focus();await input.press('ControlOrMeta+A');
  // Use the editor's real paste handler, not CDP insertText: native EditContext
  // treats the latter as one typing event and can apply automatic bracket pairs.
  await input.evaluate((element,text)=>{const data=new DataTransfer();data.setData('text/plain',text);element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},value);
};

try{
  const env={...process.env,LUMEN_MODE:'virtual',LUMEN_USER_DATA:runtime};delete env.ELECTRON_RUN_AS_NODE;delete env.LUMEN_UI;delete env.LUMEN_SCREENSHOT;
  app=await _electron.launch({executablePath:process.platform==='win32'?path.join(root,'node_modules/electron/dist/electron.exe'):require('electron'),args:[root],cwd:root,env,timeout:60000});
  page=await app.firstWindow();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text().slice(0,800));});
  page.on('request',request=>{if(/^https?:/.test(request.url()))report.externalRequests.push(request.url());});
  await wait('virtual devices',async()=>{const state=await snapshot();return state.mode==='virtual'&&state.status?.virtual&&state.status?.pluginsReady&&!state.starting;},60000);
  assert.equal(path.resolve(await app.evaluate(({app})=>app.getPath('userData'))),path.resolve(runtime));
  await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('rayloom:canvas');globalThis.__authoringCalls=[];ipcMain.removeHandler('rayloom:canvas');ipcMain.handle('rayloom:canvas',(event,method,args)=>{if(method!=='state')globalThis.__authoringCalls.push({method,args});return original(event,method,args);});});
  const devices=(await snapshot()).devices,{layout}=discoverLayout(devices);
  await page.evaluate(layout=>window.rayloom.studio('save',{layout}),layout);
  const config={effect:'canvas:editor',group:'all',brightness:100,speed:1,scale:350,fps:30,color:255};

  await check('Canvas preview B never takes ownership of output A',async()=>{
    await canvas('play',{name:'Output A',source:source('#ff0000'),config});
    await wait('output A running',async()=>{const state=await canvas('state',{target:'output'});return state.running&&state.output&&state.frames>2;});
    const before=await studio();assert(before.canvasSession);
    await canvas('preview',{name:'Preview B',source:source('#00ff00'),config});
    await wait('preview B renders',async()=>{const state=await canvas('state',{target:'preview'});return state.running&&state.name==='Preview B'&&state.frames>2;});
    const [preview,playing]=await Promise.all([canvas('state',{target:'preview'}),canvas('state',{target:'output'})]);
    assert.equal(preview.output,false);assert.equal(preview.target,'preview');assert.equal(playing.name,'Output A');assert.equal(playing.output,true);assert.equal((await studio()).canvasSession,before.canvasSession);
    await canvas('parameters',{target:'preview',parameters:{color:'#0000ff',speed:2}});
    assert.equal((await canvas('state',{target:'preview'})).parameters.color,'#0000ff');assert.equal((await canvas('state',{target:'output'})).parameters.color,'#ff0000');
    await canvas('stop',{target:'preview'});assert.equal((await canvas('state',{target:'preview'})).running,false);assert.equal((await canvas('state',{target:'output'})).output,true);assert.equal((await studio()).canvasSession,before.canvasSession);
    assert((await snapshot()).devices.some(device=>device.colors.includes(255)),'virtual LEDs retain red output A');
  });

  await check('Monaco edits HTML offline, saves with Ctrl+S and previews with Ctrl+Enter',async()=>{
    await nav('Создать');await page.locator('.monaco-editor').waitFor();
    assert.equal(await page.locator('.rayloom-code-fallback').count(),0,'real Monaco must load');
    await editCode('<html><body><div>Rayloom</div></body></html>');
    await page.locator('.monaco-editor').getByRole('textbox').first().press('Shift+Alt+f');
    await wait('local HTML language worker formats document',()=>page.evaluate(()=>JSON.parse(localStorage.getItem('rayloom.canvas-editor.draft.v1')??'{}').source?.includes('\n')));
    await page.getByRole('textbox',{name:'Название Canvas-эффекта',exact:true}).fill('Monaco regression');
    await editCode(source('#123456'));
    const edited=await wait('pasted source reaches draft',()=>page.evaluate(()=>{const draft=JSON.parse(localStorage.getItem('rayloom.canvas-editor.draft.v1')??'{}');return draft.source?.includes('#123456')?draft.source:null;}));
    assert(edited.trimEnd().endsWith('</script>'),'paste preserves complete HTML without extra bracket pairs');
    await page.locator('.monaco-editor').getByRole('textbox').first().press('ControlOrMeta+s');
    await wait('saved exact editor document',async()=>{const items=await canvas('list');return items.some(item=>item.name==='Monaco regression'&&item.source===edited);});
    await page.locator('.monaco-editor').getByRole('textbox').first().press('ControlOrMeta+Enter');
    await wait('editor preview selected',async()=>{const state=await canvas('state',{target:'preview'});return state.name==='Monaco regression'&&state.frames>3;});
    await delay(900);assert.equal((await canvas('state',{target:'output'})).name,'Output A');
    await page.getByText('Только экран',{exact:true}).waitFor();await page.getByAltText('Последний кадр Canvas-эффекта').waitFor();
    await page.getByRole('textbox',{name:'Цвет',exact:true}).fill('#abcdef');
    await wait('preview parameter applied',async()=>(await canvas('state',{target:'preview'})).parameters.color==='#abcdef');
    assert.equal((await canvas('state',{target:'output'})).parameters.color,'#ff0000');
    await page.getByRole('button',{name:'Стоп',exact:true}).click();
    await wait('only UI preview stopped',async()=>!(await canvas('state',{target:'preview'})).running);
    assert.equal((await canvas('state',{target:'output'})).output,true);
    assert.deepEqual(report.externalRequests,[],'Monaco and workers must load locally');
    await page.screenshot({path:path.join(output,'monaco.png')});
  });

  await check('a slow Canvas save cannot bind its id to another template',async()=>{
    await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('rayloom:canvas');ipcMain.removeHandler('rayloom:canvas');ipcMain.handle('rayloom:canvas',async(event,method,args)=>{if(method==='save')await new Promise(resolve=>setTimeout(resolve,600));return original(event,method,args);});});
    await page.locator('.rayloom-canvas-document').getByRole('button',{name:'Сохранить',exact:true}).click();
    assert(await page.getByRole('combobox',{name:'Шаблон Canvas-эффекта',exact:true}).isDisabled());
    await wait('save complete',async()=>!(await page.locator('.rayloom-canvas-document').getByRole('button',{name:'Сохранить',exact:true}).isDisabled()));
  });

  await check('a stale Canvas poll cannot erase a newer parameter edit',async()=>{
    await page.getByRole('button',{name:'Предпросмотр',exact:true}).click();await wait('preview restarted',async()=>(await canvas('state',{target:'preview'})).running);
    await app.evaluate(({ipcMain})=>{
      const original=ipcMain._invokeHandlers.get('rayloom:canvas');globalThis.__canvasRace={hold:true,release:null};
      ipcMain.removeHandler('rayloom:canvas');ipcMain.handle('rayloom:canvas',async(event,method,args)=>{
        if(method==='state'&&args?.target==='preview'&&globalThis.__canvasRace.hold){globalThis.__canvasRace.hold=false;const old=await original(event,method,args);return new Promise(resolve=>{globalThis.__canvasRace.release=()=>resolve(old);});}
        return original(event,method,args);
      });
    });
    await wait('held poll',()=>app.evaluate(()=>!!globalThis.__canvasRace.release));
    await page.getByRole('textbox',{name:'Цвет',exact:true}).fill('#203040');
    await app.evaluate(()=>globalThis.__canvasRace.release());
    const speed=page.getByRole('textbox',{name:'Скорость',exact:true});await speed.fill('4');await speed.press('Tab');
    await wait('both edits retained',async()=>{const state=await canvas('state',{target:'preview'});return state.parameters.color==='#203040'&&state.parameters.speed===4;});
    assert.equal((await canvas('state',{target:'output'})).parameters.color,'#ff0000');
  });

  await check('plugin fields remain drafts across polls and Stop; only Apply persists',async()=>{
    await app.evaluate(({ipcMain})=>{
      const original=ipcMain._invokeHandlers.get('rayloom:plugin');
      globalThis.__pluginDraft={calls:[],state:{running:false,profiles:[],config:{ip:'127.0.0.1',port:18765,auto_start:false,hooks:[]}}};
      ipcMain.removeHandler('rayloom:plugin');ipcMain.handle('rayloom:plugin',async(event,id,method,args)=>{
        if(id!=='http-hook')return original(event,id,method,args);
        const mock=globalThis.__pluginDraft;mock.calls.push(method);
        if(method==='config.set'){await new Promise(resolve=>setTimeout(resolve,250));mock.state.config=structuredClone(args.config);}
        if(method==='stop')mock.state.running=false;
        if(method==='config.get')await new Promise(resolve=>setTimeout(resolve,150));
        return structuredClone(mock.state);
      });
    });
    await nav('Расширения');await page.getByRole('button',{name:/События приложений/}).click();
    const ip=page.getByRole('textbox',{name:'Адрес сервера',exact:true});await ip.fill('127.0.0.2');await delay(1300);
    assert.equal(await ip.inputValue(),'127.0.0.2');assert.equal(await app.evaluate(()=>globalThis.__pluginDraft.calls.filter(method=>method==='config.set').length),0);
    await page.getByRole('button',{name:'Стоп',exact:true}).click();await wait('stop finished',async()=>!(await ip.isDisabled()));assert.equal(await ip.inputValue(),'127.0.0.2');
    const apply=page.getByRole('button',{name:'Применить и сохранить',exact:true});await apply.evaluate(element=>{element.click();element.click();});
    await wait('config applied',()=>app.evaluate(()=>globalThis.__pluginDraft.state.config.ip==='127.0.0.2'));
    assert.equal(await app.evaluate(()=>globalThis.__pluginDraft.calls.filter(method=>method==='config.set').length),1);
    await wait('apply finished',async()=>!(await ip.isDisabled()));await ip.fill('127.0.0.3');
    await page.getByRole('button',{name:'Отменить изменения',exact:true}).click();assert(await ip.isDisabled());
    await wait('explicit discard completed',async()=>!(await ip.isDisabled()));assert.equal(await ip.inputValue(),'127.0.0.2');
    await page.screenshot({path:path.join(output,'plugin-drafts.png')});
  });
  assert.deepEqual(report.pageErrors,[]);assert(!report.consoleErrors.some(message=>/worker|monaco|content security|unsafe-eval/i.test(message)),report.consoleErrors.join('\n'));
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);if(page&&!page.isClosed()){report.canvasCalls=await app.evaluate(()=>globalThis.__authoringCalls).catch(()=>[]);report.canvasStates=await Promise.all([canvas('state',{target:'preview'}),canvas('state',{target:'output'})]).catch(()=>[]);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure-dom.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));}}
finally{
  try{const client=await connectRuntime(root,runtime,'virtual',{launch:false});await client.call('shutdown');client.close();}catch(error){if(fs.existsSync(path.join(runtime,'runtime.json'))){report.cleanupError=error.message;process.exitCode=1;}}
  if(app)await app.close().catch(error=>{report.closeError=error.message;process.exitCode=1;});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('Report:',path.join(output,'report.json'));
}
