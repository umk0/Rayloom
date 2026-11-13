// Real Electron acceptance for the default Mantine renderer.
// Run after npm run build: node scripts/test-mantine-ui.mjs
// Uses a new virtual runtime; never opens the user's profile or physical RGB devices.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {connectRuntime} from '../desktop/runtime-client.mjs';

const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..');
function playwrightPath() {
  if (process.env.LUMEN_PLAYWRIGHT_MODULE) return process.env.LUMEN_PLAYWRIGHT_MODULE;
  try { return require.resolve('playwright'); } catch {}
  const caches = [process.env.npm_config_cache, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'npm-cache'), path.join(os.homedir(), 'AppData', 'Local', 'npm-cache'), path.join(os.homedir(), '.npm')].filter(Boolean);
  for (const cache of new Set(caches)) {
    const directory = path.join(cache, '_npx'); if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).filter(item => item.isDirectory())) {
      const candidate = path.join(directory, entry.name, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    }
  }
  throw Error('Set LUMEN_PLAYWRIGHT_MODULE to an existing Playwright package. This test does not install dependencies.');
}

const {_electron} = require(playwrightPath());
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'rayloom-mantine-ui-'));
const artifacts = path.join(root, 'artifacts', 'mantine-ui', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(artifacts, {recursive: true});
const report = {started: new Date().toISOString(), runtime, artifacts, physicalHardwareTested: false, checks: [], rendererErrors: [], consoleErrors: []};
let app, retiredApp, page, componentId, groupId, catalog;
const networkResources = new Map();
const wait = async (name, read, timeout = 15000) => {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) { try { const result = await read(); if (result) return result; } catch (error) { last = error; } await delay(100); }
  throw Error(`Timed out: ${name}${last ? ` (${last.message})` : ''}`);
};
const step = async (name, action) => { const started = Date.now(); await action(); report.checks.push({name, ms: Date.now() - started}); console.log('PASS', name); };
const screenshot = name => page.screenshot({path: path.join(artifacts, `${name}.png`)});
const studio = () => page.evaluate(() => window.rayloom.studio('state'));
const snapshot = () => page.evaluate(() => window.rayloom.snapshot());
const nav = name => page.getByRole('complementary', {name: 'Основная навигация', exact: true}).getByRole('button', {name, exact: true}).click();
const fill = async (field, value) => { await field.fill(String(value)); await field.press('Tab'); };
const toggle = async (scope, name, role = 'switch') => { const field = scope.getByRole(role, {name, exact: true}); await field.focus(); await field.press('Space'); };
const library = () => page.getByRole('dialog', {name: 'Все эффекты', exact: true});
const fullscreen = () => page.getByRole('dialog', {name: 'Редактор пространства', exact: true});
const portInspector = () => fullscreen().getByRole('complementary', {name: 'Настройка выбранного компонента', exact: true});
const windowState = () => page.evaluate(() => window.rayloom.window('state'));
const resources = () => page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({name: entry.name.split('/').at(-1), type: entry.initiatorType, bytes: entry.transferSize, duration: Math.round(entry.duration)})));
const observedResources = () => [...networkResources.values()];
const memory = () => app.evaluate(({app}) => ({units: 'KiB', capturedAt: new Date().toISOString(), processes: app.getAppMetrics().map(({pid, type, memory}) => ({pid, type, memory}))}));
const isAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function openLibrary() { await page.getByRole('button', {name: 'Все эффекты', exact: true}).click(); await library().waitFor(); }
async function closeLibrary() { await page.keyboard.press('Escape'); await library().waitFor({state: 'hidden'}); }
async function chooseEffect(id) {
  await openLibrary(); await library().getByRole('tab', {name: 'Все', exact: true}).click();
  await library().getByRole('textbox', {name: 'Поиск эффектов', exact: true}).fill('');
  await library().locator(`[data-effect="${id}"]`).click(); await library().waitFor({state: 'hidden'});
}
async function openNative() { await nav('Расширения'); await page.getByRole('button', {name: /Слои эффектов/}).click(); await page.getByRole('heading', {name: 'Редактор сцены', exact: true}).waitFor(); }
const assertVirtual = async () => { const state = await snapshot(); assert.equal(state.mode, 'virtual'); assert.equal(state.status?.virtual, true); assert.equal((await studio()).mode, 'virtual'); };

try {
  await step('default Mantine renderer opens an isolated virtual agent', async () => {
    const env = {...process.env, LUMEN_MODE: 'virtual', LUMEN_USER_DATA: runtime};
    for (const key of ['ELECTRON_RUN_AS_NODE', 'LUMEN_SCREENSHOT', 'LUMEN_LEGACY_UI', 'LUMEN_UI']) delete env[key];
    const executablePath = process.platform === 'win32' ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe') : require(path.join(root, 'node_modules', 'electron'));
    app = await _electron.launch({executablePath, args: [root], cwd: root, env, timeout: 60000});
    page = await app.firstWindow({timeout: 30000}); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 1500)); });
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1487, 1058));
    // Resource Timing may be empty for file://. Observe actual network events and
    // reload the fresh profile before any user edits, so lazy-loading assertions
    // cannot pass merely because Chromium omitted local resources from timing.
    const cdp = await app.context().newCDPSession(page); await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', event => networkResources.set(event.request.url, {name: event.request.url.split('/').at(-1), type: event.type}));
    await page.reload({waitUntil: 'domcontentloaded'});
    assert.equal(path.resolve(await app.evaluate(({app}) => app.getPath('userData'))), path.resolve(runtime));
    await page.locator('[data-ui="mantine"]').waitFor();
    await wait('virtual core and plugin discovery', async () => { const state = await snapshot(); assert.equal(state.mode, 'virtual'); if (state.error) throw Error(state.error); return state.status?.virtual && state.status.pluginsReady && state.status.detectionPercent >= 100; }, 60000);
    await assertVirtual(); await wait('visible discovered components', () => page.locator('.spatial-component').count());
    catalog = await page.evaluate(() => window.rayloom.effects('catalog')); assert(catalog.length >= 58);
    await page.getByRole('heading', {name: 'Мой стол', exact: true}).waitFor();
    report.deviceCount = (await snapshot()).devices.length; report.nativeEffectCount = catalog.length;
    report.memoryAtStartup = await memory(); report.startupResources = await resources(); report.startupObservedResources = observedResources();
    assert(report.startupObservedResources.some(resource => resource.type === 'Script'), 'CDP must observe the loaded renderer script');
    assert(report.startupObservedResources.some(resource => resource.type === 'Stylesheet'), 'CDP must observe the loaded stylesheet');
    assert.equal(report.startupObservedResources.some(resource => /CanvasCodeEditor|monaco|(?:editor|html|css|json|ts)\.worker/i.test(resource.name)), false, 'the initial workspace must not load Monaco or its workers');
    assert.equal(report.startupObservedResources.some(resource => /^legacy[-.].*\.(?:css|js)$/.test(resource.name)), false, 'legacy UI assets must not load in the Mantine entry');
    report.stylesheets = await page.evaluate(() => [...document.styleSheets].map(sheet => {
      let rules = ''; try { rules = [...sheet.cssRules].map(rule => rule.cssText).join('\n'); } catch {}
      return {href: sheet.href?.split('/').at(-1), legacyMarkers: /@layer\s+heroui|--heroui-|\.heroui-/.test(rules)};
    }));
    assert(report.stylesheets.every(sheet => !sheet.legacyMarkers), 'legacy HeroUI styles must not leak into the new renderer');
    report.componentDom = await page.evaluate(() => {
      const describe = element => element && ({tag: element.tagName, className: element.className, attributes: [...element.attributes].filter(attribute => attribute.name.startsWith('data-')).map(attribute => [attribute.name, attribute.value]), color: getComputedStyle(element).color, overflowY: getComputedStyle(element).overflowY});
      return {apply: describe([...document.querySelectorAll('button')].find(element => element.textContent.trim() === 'Применить')), scrollRoot: describe(document.querySelector('.ray-content')), scrollChildren: [...document.querySelectorAll('.ray-content > *')].slice(0, 5).map(describe), select: describe(document.querySelector('[role="combobox"]'))};
    });
  });

  await step('window chrome stays outside scrolling and the default workspace fits', async () => {
    const dimensions = await page.evaluate(() => {
      const bar = document.querySelector('.ray-window-bar'), rect = bar.getBoundingClientRect();
      return {documentY: document.documentElement.scrollHeight - innerHeight, documentX: document.documentElement.scrollWidth - innerWidth, barTop: rect.top, barHeight: rect.height, barCount: document.querySelectorAll('.ray-window-bar').length, barInScrollArea: Boolean(bar.closest('[data-scrollbars]'))};
    });
    assert(dimensions.documentY <= 2 && dimensions.documentX <= 2, JSON.stringify(dimensions));
    assert.equal(dimensions.barTop, 0); assert(dimensions.barHeight >= 30 && dimensions.barHeight <= 48); assert.equal(dimensions.barCount, 1); assert.equal(dimensions.barInScrollArea, false);
    assert.equal(await page.getByRole('tab', {name: '2D', exact: true}).getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('.rayloom-effect-strip [data-effect]').count(), 4);
    await screenshot('01-quiet-workspace');
  });

  await step('complete library supports search, sources and real animated native previews', async () => {
    const before = await snapshot(), beforeState = await studio();
    const aurora = page.locator('.rayloom-effect-strip [data-effect="aurora"]');
    await aurora.hover(); await wait('built-in pixels ready', async () => await aurora.locator('canvas').getAttribute('data-preview-status') === 'ready');
    const bitmap = locator => locator.locator('canvas').evaluate(canvas => canvas.toDataURL());
    const initial = await bitmap(aurora); await wait('built-in animation advances', async () => (await bitmap(aurora)) !== initial);
    await openLibrary(); await library().getByRole('tab', {name: 'Effects Plugin', exact: true}).click();
    assert.equal(await library().locator('[data-effect^="openrgb:"]').count(), catalog.length);
    const search = library().getByRole('textbox', {name: 'Поиск эффектов', exact: true});
    const wave = catalog.find(effect => effect.id === 'RainbowWave'); assert(wave);
    await search.fill(wave.name); const card = library().locator('[data-effect="openrgb:RainbowWave"]');
    await card.hover(); await wait('native thumbnail receives real frame', async () => await card.locator('canvas').getAttribute('data-preview-status') === 'ready', 25000);
    const first = await bitmap(card); await wait('native algorithm animates', async () => (await bitmap(card)) !== first);
    await page.emulateMedia({reducedMotion: 'reduce'}); await delay(200); const still = await bitmap(card); await delay(180); assert.equal(await bitmap(card), still);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    const gif = catalog.find(effect => /gif/i.test(effect.id)); assert(gif);
    await search.fill(gif.name); const gifCard = library().locator(`[data-effect="openrgb:${gif.id}"]`); await gifCard.hover();
    await wait('missing input is explained without invented pixels', async () => await gifCard.locator('canvas').getAttribute('data-preview-status') === 'needs-input');
    assert.match(await gifCard.innerText(), /GIF|изображение/);
    await search.fill(''); await screenshot('02-full-effect-library');
    await closeLibrary(); await page.mouse.move(10, 10);
    assert.deepEqual((await snapshot()).devices.map(device => device.colors), before.devices.map(device => device.colors), 'hover must not output to devices');
    assert.equal((await studio()).running, beforeState.running);
  });

  await step('all native catalog entries return actual pixels or an explicit input requirement', async () => {
    const before = await snapshot();
    const samples = await page.evaluate(async catalog => {
      const results = [];
      for (const effect of catalog) {
        const frame = await window.rayloom.effectPreview('frame', {effectId: effect.id, color: 0x80ff20, speed: 4, animate: false});
        let hash = 2166136261;
        for (const color of frame.colors ?? []) hash = Math.imul(hash ^ color, 16777619) >>> 0;
        results.push({id: effect.id, source: frame.source, status: frame.status, reason: frame.reason, count: frame.colors?.length, valid: frame.colors?.every(color => Number.isInteger(color) && color >= 0 && color <= 0xffffff), hash: frame.colors ? hash : null});
      }
      return results;
    }, catalog);
    for (const sample of samples) { assert.equal(sample.source, 'native'); assert(['ready', 'needs-input'].includes(sample.status), JSON.stringify(sample)); if (sample.status === 'ready') { assert.equal(sample.count, 512); assert(sample.valid); } else assert(sample.reason && sample.count === undefined); }
    assert(new Set(samples.filter(sample => sample.status === 'ready').map(sample => sample.hash)).size > 30, 'native previews must not collapse to one generic animation');
    report.nativePreviews = samples;
    assert.deepEqual((await snapshot()).devices.map(device => device.colors), before.devices.map(device => device.colors));
  });

  await step('each effect exposes its own settings and applies only on request', async () => {
    await chooseEffect('prism'); const prism = page.getByRole('region', {name: 'Настройки эффекта Призма', exact: true}); await prism.waitFor();
    assert.equal(await prism.getByRole('textbox', {name: /цвет/i}).count(), 0, 'fixed palette must not show a fake color control');
    const prismSpeed = prism.getByRole('slider', {name: 'Скорость', exact: true}); await prismSpeed.waitFor();
    await prismSpeed.focus(); await prismSpeed.press('Home'); for (let step = 0; step < 50; step++) await prismSpeed.press('ArrowRight');
    const brightness = page.getByRole('slider', {name: 'Яркость', exact: true}); await brightness.focus(); await brightness.press('End'); for (let step = 0; step < 20; step++) await brightness.press('ArrowLeft');
    await page.getByRole('button', {name: 'Применить', exact: true}).click();
    await wait('reference Prism workspace is really playing', async () => { const state = await studio(); return state.running && state.current.effect === 'prism' && state.current.speed === 5 && state.current.brightness === 80 && state.metrics.frames > 3; });
    await page.getByRole('heading', {name: 'Мой стол', exact: true}).scrollIntoViewIfNeeded(); await page.getByRole('heading', {name: 'Мой стол', exact: true}).click();
    await screenshot('02-prism-workspace');
    await chooseEffect('wave'); const wave = page.getByRole('region', {name: 'Настройки эффекта Волна', exact: true});
    await wave.getByRole('textbox', {name: 'Цвет эффекта', exact: true}).waitFor();
    await fill(wave.getByRole('textbox', {name: 'Цвет эффекта', exact: true}), '#38a6d2');
    const slider = wave.getByRole('slider', {name: 'Скорость', exact: true}); await slider.focus(); await slider.press('End');
    await page.getByRole('button', {name: 'Применить', exact: true}).click();
    const state = await wait('selected effect starts in virtual agent', async () => { const current = await studio(); return current.running && current.current.effect === 'wave' && current.current.speed === 10 && current; });
    assert.equal(state.current.color, 0xd2a638); assert(state.current.brightness > 0);
    await wait('output frames advance', async () => (await studio()).metrics.frames > state.metrics.frames);
  });

  await step('device and port names persist through normal UI save', async () => {
    await nav('Устройства'); await page.getByRole('heading', {name: 'Устройства', exact: true}).waitFor();
    const name = page.getByRole('textbox', {name: /^Название устройства /}).first(); await name.fill('Mantine тестовый контроллер');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    await wait('device alias persists', async () => Object.values((await studio()).layout.deviceAliases ?? {}).includes('Mantine тестовый контроллер'));
    await page.getByRole('button', {name: /^Настроить порт /}).first().click();
    await page.getByRole('textbox', {name: 'Название компонента', exact: true}).fill('Mantine передние вентиляторы');
    componentId = await page.locator('.spatial-component.selected').getAttribute('data-component'); assert(componentId);
    await page.getByRole('button', {name: 'Сохранить расположение', exact: true}).click();
    await wait('port alias persists', async () => (await studio()).layout.components.find(component => component.id === componentId)?.name === 'Mantine передние вентиляторы');
    await screenshot('03-port-inspector');
  });

  await step('groups explain validation and persist selected members', async () => {
    await nav('Устройства'); await page.getByRole('button', {name: 'Группы', exact: true}).click();
    await page.getByRole('textbox', {name: 'Название группы', exact: true}).fill('Mantine корпус');
    await page.getByRole('button', {name: 'Сохранить группу', exact: true}).click();
    await page.getByText('Отметьте хотя бы одно устройство или порт.', {exact: true}).waitFor();
    await toggle(page, 'Добавить в группу: Mantine передние вентиляторы', 'checkbox');
    await page.getByRole('button', {name: 'Сохранить группу', exact: true}).click();
    groupId = (await wait('saved group contains selected port', async () => (await studio()).layout.groups.find(group => group.name === 'Mantine корпус' && group.members.includes(componentId)))).id;
    await screenshot('04-groups');
    await page.getByRole('button', {name: 'Назначить эффект', exact: true}).click(); await page.getByRole('heading', {name: 'Мой стол', exact: true}).waitFor();
    assert.equal(await page.getByRole('combobox', {name: 'Группа подсветки', exact: true}).inputValue(), 'Mantine корпус');
  });

  await step('fullscreen is monitor fullscreen with one complete editable inspector', async () => {
    await page.getByRole('button', {name: 'Развернуть редактор пространства', exact: true}).click(); await fullscreen().waitFor();
    assert.equal((await windowState()).fullscreen, true);
    const bounds = await fullscreen().boundingBox(), size = await page.evaluate(() => ({width: innerWidth, height: innerHeight}));
    assert.equal(bounds.x, 0); assert.equal(bounds.y, 0); assert(Math.abs(bounds.width - size.width) <= 1); assert(Math.abs(bounds.height - size.height) <= 1);
    assert.equal(await page.getByRole('textbox', {name: 'Название компонента', exact: true}).count(), 1);
    await portInspector().getByRole('textbox', {name: 'Название компонента', exact: true}).fill('Mantine порт из fullscreen');
    const position = portInspector().getByRole('textbox', {name: 'Положение X', exact: true});
    await fill(position, 125.5); await position.fill(''); await position.press('Tab'); assert.equal(Number(await position.inputValue()), 125.5, 'empty numeric input must not commit zero');
    await position.fill('999'); await position.press('Escape'); assert.equal(Number(await position.inputValue()), 125.5, 'Escape restores the numeric draft');
    assert.equal(await fullscreen().isVisible(), true, 'input Escape must not exit fullscreen');
    await portInspector().getByRole('button', {name: 'Сохранить расположение', exact: true}).click();
    await wait('fullscreen edits persist', async () => { const component = (await studio()).layout.components.find(item => item.id === componentId); return component.name === 'Mantine порт из fullscreen' && component.pose.x === 125.5; });
    await fullscreen().getByRole('tab', {name: '3D', exact: true}).click(); await fullscreen().getByRole('application', {name: 'Трёхмерное расположение светодиодов', exact: true}).waitFor();
    await screenshot('05-fullscreen-3d');
  });

  await step('calibration modal owns focus and Escape without closing fullscreen', async () => {
    await portInspector().getByRole('button', {name: 'Калибровать цвета', exact: true}).click();
    const wizard = page.getByRole('dialog', {name: 'Настроим цвета', exact: true}); await wizard.waitFor();
    await wizard.getByRole('button', {name: 'Начать проверку', exact: true}).click(); await wizard.getByText('Вопрос 1 из 3', {exact: true}).waitFor();
    await wait('calibration cancellation ready', () => wizard.getByRole('button', {name: 'Отменить и вернуть подсветку', exact: true}).isEnabled());
    assert.equal(await wizard.evaluate(element => element.contains(document.activeElement)), true);
    await screenshot('06-fullscreen-calibration'); await page.keyboard.press('Escape'); await wizard.waitFor({state: 'hidden'});
    assert.equal((await windowState()).fullscreen, true); assert.equal(await fullscreen().isVisible(), true);
    await wait('calibration restores previous scene', async () => (await studio()).running);
    assert.equal(await page.evaluate(() => window.rayloom.studio('calibration.state')), null);
    await fullscreen().getByRole('button', {name: 'Закрыть большой редактор', exact: true}).click(); await fullscreen().waitFor({state: 'hidden'});
    await wait('monitor fullscreen exits', async () => !(await windowState()).fullscreen);
  });

  await step('scene save and reload preserve the configured group', async () => {
    await nav('Сцены'); await page.getByRole('textbox', {name: 'Название пространственной сцены', exact: true}).fill('Mantine acceptance');
    await page.getByRole('button', {name: 'Сохранить текущую сцену', exact: true}).click();
    await wait('named scene persisted', async () => (await studio()).scenes.some(scene => scene.name === 'Mantine acceptance' && scene.config.group === groupId));
    await page.getByRole('button', {name: 'Загрузить', exact: true}).click(); await page.getByRole('heading', {name: 'Мой стол', exact: true}).waitFor();
  });

  await step('native layers editor preserves draft and has an obvious return path', async () => {
    const before = await studio(); await openNative(); assert.equal((await studio()).running, before.running, 'opening settings must not stop lighting');
    assert.equal(await page.locator('.ray-window-bar').count(), 1); assert.equal(await page.getByRole('complementary', {name: 'Основная навигация', exact: true}).count(), 1);
    await page.getByRole('tab', {name: 'Добавить эффект', exact: true}).click();
    const layers = catalog.find(effect => effect.id === 'Layers'); assert(layers);
    await page.getByRole('textbox', {name: 'Поиск эффектов', exact: true}).fill(layers.name);
    await page.locator('[data-effect="openrgb:Layers"]').click();
    await page.getByRole('heading', {name: 'Композиция слоёв', exact: true}).waitFor();
    await page.getByRole('textbox', {name: 'Название эффекта', exact: true}).fill('Mantine слои');
    await page.getByRole('button', {name: 'Добавить группу слоёв', exact: true}).click();
    const choices = page.getByRole('combobox', {name: 'Добавить эффект в группу', exact: true}); await choices.last().click();
    const wave = catalog.find(effect => effect.id === 'RainbowWave'); await page.getByRole('option', {name: wave.name, exact: true}).click();
    await wait('native draft persists nested layer', () => page.evaluate(() => { const draft = JSON.parse(localStorage.getItem('rayloom.advanced-scene-draft.virtual')); return draft?.Effects.some(effect => effect.CustomName === 'Mantine слои' && effect.CustomSettings.groups.some(group => group.layers.some(layer => layer.effect_settings.EffectClassName === 'RainbowWave'))); }));
    await screenshot('07-native-layers'); await page.getByRole('button', {name: 'К моей подсветке', exact: true}).click(); await page.getByRole('heading', {name: 'Мой стол', exact: true}).waitFor();
    await openNative(); await page.getByRole('textbox', {name: 'Название эффекта', exact: true}).waitFor();
    assert.equal(await page.getByRole('textbox', {name: 'Название эффекта', exact: true}).inputValue(), 'Mantine слои');
    assert.equal((await studio()).running, before.running);
    await page.getByRole('button', {name: 'К моей подсветке', exact: true}).click();
  });

  await step('Canvas studio loads an editor and previews without taking over lights', async () => {
    const before = await studio(); await nav('Создать'); await page.getByRole('textbox', {name: 'Название Canvas-эффекта', exact: true}).waitFor();
    await page.locator('.monaco-editor').first().waitFor({timeout: 30000});
    report.memoryAfterMonaco = await memory(); report.resourcesAfterMonaco = await resources(); report.observedResourcesAfterMonaco = observedResources();
    assert(report.observedResourcesAfterMonaco.some(resource => /^CanvasCodeEditor-.*\.js$/.test(resource.name)), 'the code editor chunk is loaded on first authoring visit');
    await page.getByRole('button', {name: 'Предпросмотр', exact: true}).click();
    await wait('Canvas renders actual frames', async () => { const state = await page.evaluate(() => window.rayloom.canvas('state')); return state.running && state.frames > 2 && state.preview; }, 30000);
    await page.getByRole('img', {name: 'Последний кадр Canvas-эффекта', exact: true}).waitFor();
    assert.equal((await studio()).running, before.running); assert.deepEqual((await studio()).current, before.current);
    await screenshot('08-canvas-editor'); await page.getByRole('button', {name: 'Стоп', exact: true}).click();
  });

  await step('extensions and settings remain understandable and safe in virtual mode', async () => {
    await nav('Расширения'); await page.getByRole('heading', {name: 'Расширения', exact: true}).waitFor();
    for (const name of ['Слои эффектов', 'Карты и градиенты', 'Свет по датчикам', 'Расписание', 'События приложений', 'Световая сеть', 'Оформление']) assert.equal(await page.getByRole('button', {name: new RegExp(name)}).count(), 1);
    await screenshot('09-extensions'); await nav('Настройки'); await page.getByRole('heading', {name: 'Работа после закрытия окна', exact: true}).waitFor();
    const startup = page.getByRole('switch', {name: /Запускать подсветку/}); await wait('runtime settings hydrated', () => startup.count()); assert.equal(await startup.isDisabled(), true);
    assert.equal(await page.getByRole('heading', {name: 'О Rayloom', exact: true}).count(), 1);
    for (const text of await page.getByText(/SMBus|PawnIO|Доступные шины/).all()) assert.equal(await text.isVisible(), false);
    await screenshot('10-settings');
  });

  await step('plugin read failure does not trap the user or stop the active light', async () => {
    await nav('Мой свет'); await page.getByRole('button', {name: 'Применить', exact: true}).click(); await wait('light active before failure', async () => (await studio()).running);
    const before = await studio();
    await app.evaluate(({ipcMain}) => { ipcMain.removeHandler('rayloom:effects'); ipcMain.handle('rayloom:effects', () => { throw Error("[json.exception.out_of_range.403] key 'UserColors' not found"); }); });
    await openNative(); await page.getByText('Не удалось загрузить настройки эффекта', {exact: true}).waitFor();
    await screenshot('11-error-recovery'); await page.getByRole('button', {name: 'К моей подсветке', exact: true}).click(); await page.getByRole('heading', {name: 'Мой стол', exact: true}).waitFor();
    const after = await studio(); assert.equal(after.running, before.running); assert.deepEqual(after.current, before.current);
  });

  await step('closing the editor releases Electron while the same agent continues lighting', async () => {
    await assertVirtual(); const runtimeBefore = await page.evaluate(() => window.rayloom.studio('runtime.state'));
    const processes = await app.evaluate(({app}) => app.getAppMetrics().map(({pid, type}) => ({pid, type})));
    await page.getByRole('button', {name: 'Закрыть редактор, оставить подсветку', exact: true}).click();
    await wait('all Electron UI processes exit', () => processes.every(process => !isAlive(process.pid)), 15000);
    report.closedElectron = processes.map(process => ({...process, alive: isAlive(process.pid)}));
    retiredApp = app; app = null; page = null;
    const client = await connectRuntime(root, runtime, 'virtual', {launch: false});
    try {
      const info = await client.call('runtime.state'); assert.equal(info.pid, runtimeBefore.pid); assert.equal(info.htmlRenderer, false);
      const before = await client.call('studio', {method: 'state'}); assert.equal(before.running, true); await delay(300);
      const after = await client.call('studio', {method: 'state'}); assert(after.metrics.frames > before.metrics.frames, 'native lighting frames continue after Chromium exits');
      report.backgroundAfterClose = {pid: info.pid, memory: info.memory, framesBefore: before.metrics.frames, framesAfter: after.metrics.frames};
    } finally { client.close(); }
  });
  assert.deepEqual(report.rendererErrors, [], 'unhandled renderer exceptions'); assert.deepEqual(report.consoleErrors, [], 'renderer console errors'); report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1; console.error(error);
  if (page && !page.isClosed()) { await screenshot('failure').catch(() => {}); fs.writeFileSync(path.join(artifacts, 'failure-dom.txt'), await page.locator('body').ariaSnapshot().catch(() => '')); }
} finally {
  // The agent belongs to this freshly created directory; no user runtime is contacted.
  try { const client = await connectRuntime(root, runtime, 'virtual', {launch: false}); try { await client.call('shutdown'); } finally { client.close(); } }
  catch (error) { if (fs.existsSync(path.join(runtime, 'runtime.json'))) { report.runtimeCleanupError = error.message; process.exitCode = 1; } }
  if (app) await app.close().catch(error => { report.cleanupError = error.message; process.exitCode = 1; });
  if (retiredApp) await retiredApp.close().catch(error => { report.cleanupError = error.message; process.exitCode = 1; });
  report.finished = new Date().toISOString(); fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, 'artifacts', 'mantine-ui', 'latest.json'), JSON.stringify(report, null, 2));
  console.log('Mantine UI report:', path.join(artifacts, 'report.json'));
}
