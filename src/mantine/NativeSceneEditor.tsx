import {useEffect, useRef, useState} from 'react';
import {ActionIcon, Alert, Badge, Button, Group, Modal, Paper, SimpleGrid, Stack, Tabs, Text, TextInput, Title} from '@mantine/core';
import {ArrowLeft, Copy, Download, Pause, Play, Plus, Save, Trash2, Upload} from 'lucide-react';
import {advancedDraftKey, readAdvancedDraft, backupAdvancedDraft, normalizeAdvancedScene} from '../../shared/advanced-draft.mjs';
import {migrateSessionDraft, editorViewKey, readEditorView, preserveReplacedDraft, readReplacedDraft} from '../../shared/advanced-editor-state.mjs';
import {type Description, type Effect, type Scene, type Snapshot, clone, hex, zone} from '../types';
import {EffectEditor, Fields, Numeric} from './EffectEditor';
import {EffectLibrary} from './EffectLibrary';
import {RayloomDisclosure, RayloomSelect, RayloomSwitch} from './StudioControls';
import {PluginPanel} from './PluginPanels';
import {VisualMapPanel} from './VisualMapPanel';

const sections = [
  {id: 'effects', label: 'Сцена'}, {id: 'scenes', label: 'Сохранённые сцены'}, {id: 'settings', label: 'Настройки новых эффектов'},
  {id: 'visual-map', label: 'Карта плагина'}, {id: 'hardware-sync', label: 'Датчики'}, {id: 'e131', label: 'E1.31'},
  {id: 'http-hook', label: 'Интеграции'}, {id: 'scheduler', label: 'Расписание'}, {id: 'devices', label: 'Устройства сцены'},
];
const emptyScene = (): Scene => ({version: 2, Effects: []});

/** Embedded native scene editor: this scene is independent of the main spatial scene. */
export function NativeSceneEditor({onBack, initialTab = 'effects'}: {onBack: () => void; initialTab?: string}) {
  const [tab, setTabValue] = useState(initialTab), [snapshot, setSnapshot] = useState<Snapshot>({devices: [], plugins: []});
  const [catalog, setCatalog] = useState<Description[]>([]), [blends, setBlends] = useState<string[]>([]), [scene, setScene] = useState<Scene>(emptyScene);
  const [selected, setSelected] = useState(0), [dirty, setDirty] = useState(false), [running, setRunning] = useState(false), [library, setLibrary] = useState(true);
  const [sceneError, setSceneError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<any>(null), [draftReady, setDraftReady] = useState(false), [sceneName, setSceneName] = useState('Моя сцена');
  const [saved, setSaved] = useState<string[]>([]), [presets, setPresets] = useState<string[]>([]), [globals, setGlobals] = useState<any>(null);
  const [replacement, setReplacement] = useState<{title: string; run: () => void} | null>(null), [previousDraft, setPreviousDraft] = useState<any>(null);
  const mode = snapshot.mode ?? (snapshot.status ? snapshot.status.virtual ? 'virtual' : 'hardware' : null);
  const revision = useRef(0), sceneRef = useRef(scene), catalogRef = useRef<Description[]>([]), draftMode = useRef(''), actionBusy = useRef(false), dirtyRef = useRef(false);
  const draftStorage = useRef<Storage>(localStorage);
  const mounted = useRef(true), actionEpoch = useRef(0), viewRevision = useRef(0), globalsRevision = useRef(0), sceneNameRef = useRef(sceneName);
  sceneNameRef.current = sceneName;
  const capture = (includeView = true) => {
    const r = revision.current, m = draftMode.current, v = viewRevision.current, g = globalsRevision.current;
    return () => mounted.current && revision.current === r && draftMode.current === m && (!includeView || (viewRevision.current === v && globalsRevision.current === g));
  };
  const notify = (message: string) => { if (mounted.current) setNotice(message); };
  const setTab = (next: string) => { if (next !== tab) viewRevision.current++; setTabValue(next); };
  const context = {catalog, blends, notify, capture};
  const online = Boolean(snapshot.status) && !snapshot.error;
  const current = scene.Effects[selected];
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; viewRevision.current++; }; }, []);

  useEffect(() => {
    if (!mode || !draftReady || draftMode.current !== mode || recovery) return;
    try { const key = advancedDraftKey(mode); if (dirty) draftStorage.current.setItem(key, JSON.stringify(scene)); else draftStorage.current.removeItem(key); }
    catch { setNotice('Не удалось сохранить черновик в этом окне. Экспортируйте сцену перед закрытием.'); }
  }, [scene, dirty, mode, draftReady, recovery]);
  useEffect(() => {
    if (!mode || !draftReady || draftMode.current !== mode) return;
    try { localStorage.setItem(editorViewKey(mode), JSON.stringify({selected, library, sceneName})); } catch {}
  }, [selected, library, sceneName, mode, draftReady]);

  const refreshSaved = async () => {
    const pendingMode = draftMode.current;
    const [scenes, presets] = await Promise.all([window.rayloom.scenes('list'), window.rayloom.scenes('list', {kind: 'preset'})]);
    if (mounted.current && (!pendingMode || draftMode.current === pendingMode)) { setSaved(scenes); setPresets(presets); }
  };
  useEffect(() => {
    let active = true, inflight = false;
    const refresh = async () => {
      if (inflight || actionBusy.current) return; inflight = true;
      const unchanged = capture(false), pendingAction = actionEpoch.current;
      try {
        const nextSnapshot = await window.rayloom.snapshot(); if (active) setSnapshot(nextSnapshot);
        const profile = await window.rayloom.effects('scene.get');
        const responseMode = nextSnapshot.mode ?? (nextSnapshot.status ? nextSnapshot.status.virtual ? 'virtual' : 'hardware' : null);
        if (active && unchanged() && pendingAction === actionEpoch.current && responseMode === draftMode.current && catalogRef.current.length) {
          const live = normalizeAdvancedScene(profile, catalogRef.current) as Scene;
          setSceneError(''); setRunning(live.Effects.some(effect => effect.AutoStart));
          if (!dirtyRef.current && !actionBusy.current && JSON.stringify(sceneRef.current) !== JSON.stringify(live)) {
            revision.current++; sceneRef.current = live; setScene(live);
          }
        }
      } catch (error) { if (active && unchanged() && pendingAction === actionEpoch.current) setSceneError(String(error)); } finally { inflight = false; }
    };
    void refresh(); const timer = setInterval(refresh, 500);
    return () => { active = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      window.rayloom.effects('catalog').then(value => { if (active) { catalogRef.current = value; setCatalog(value); } }),
      window.rayloom.effects('blendModes').then(value => { if (active) setBlends(value); }),
      window.rayloom.effects('globals.get').then(value => { if (active) setGlobals(value); }),
      refreshSaved(),
    ]).then(results => { const failure = results.find(result => result.status === 'rejected'); if (active && failure?.status === 'rejected') setSceneError(String(failure.reason)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!mode || !catalog.length || draftMode.current === mode) return;
    draftMode.current = mode; revision.current++; viewRevision.current++; setReplacement(null);
    try {
      draftStorage.current = localStorage;
      try { migrateSessionDraft(sessionStorage, localStorage, mode); }
      catch { draftStorage.current = sessionStorage; setNotice('Не удалось сохранить черновик между запусками. Экспортируйте сцену перед закрытием окна.'); }
      const draft = readAdvancedDraft(draftStorage.current, mode, catalog), next = (draft.scene ?? emptyScene()) as Scene;
      const view = readEditorView(localStorage, mode), hadView = localStorage.getItem(editorViewKey(mode)) !== null;
      setPreviousDraft(readReplacedDraft(draftStorage.current, mode));
      setRecovery(draft.recovery); sceneRef.current = next; setScene(next); dirtyRef.current = Boolean(draft.scene);
      setDirty(Boolean(draft.scene)); setSelected(view.selected); setLibrary(view.library || (!draft.scene && !hadView)); setSceneName(view.sceneName); setDraftReady(true);
    } catch (error) { setSceneError(String(error)); }
  }, [mode, catalog]);

  const action = async (fn: () => Promise<unknown>, message = '') => {
    if (actionBusy.current || !mounted.current) return; actionBusy.current = true; actionEpoch.current++; setBusy(true); setNotice('');
    const pendingMode = draftMode.current;
    try { await fn(); if (message && mounted.current && draftMode.current === pendingMode) setNotice(message); } catch (error) { if (mounted.current && draftMode.current === pendingMode) setNotice(String(error)); }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false); }
  };
  const normalize = (profile: Scene): Scene => normalizeAdvancedScene(profile, catalogRef.current) as Scene;
  const edit = (effects: Effect[]) => {
    revision.current++; dirtyRef.current = true; const next: Scene = {version: 2, Effects: effects};
    sceneRef.current = next; setScene(next); setDirty(true);
  };
  const update = (effect: Effect) => edit(sceneRef.current.Effects.map((item, index) => index === selected ? effect : item));
  const load = (profile: Scene) => {
    if (recovery) throw Error('Сначала сохраните копию черновика, который требует восстановления.');
    edit(normalize(profile).Effects); setSelected(0); setLibrary(false);
  };
  const replaceScene = (title: string, read: () => Promise<Scene | null>, nextName?: string) => {
    if (actionBusy.current || !draftReady || recovery) return;
    const unchanged = capture();
    const run = () => void action(async () => {
      const profile = await read();
      if (!profile) return;
      if (!unchanged()) { notify('Сцена не заменена: вы уже перешли дальше или изменили черновик. Откройте её ещё раз.'); return; }
      const next = normalize(profile);
      if (dirtyRef.current) setPreviousDraft(preserveReplacedDraft(draftStorage.current, draftMode.current, sceneRef.current, sceneNameRef.current));
      load(next); if (nextName) setSceneName(nextName); setTab('effects');
    });
    if (dirtyRef.current) setReplacement({title, run}); else run();
  };
  const add = (description: Description) => {
    if (!draftReady || recovery) return;
    if (sceneRef.current.Effects.length >= 64) { notify('В сцене может быть до 64 эффектов. Удалите один, чтобы добавить новый.'); return; }
    const effect = clone(description.defaults), globalSettings = globals?.value;
    if (globalSettings) {
      effect.FPS = globalSettings.fps; effect.Brightness = globalSettings.brightness; effect.Temperature = globalSettings.temperature; effect.Tint = globalSettings.tint; effect.RandomColors = Boolean(globalSettings.prefer_random);
      if (globalSettings.use_prefered_colors) effect.UserColors = (effect.UserColors ?? []).map((color, index) => globalSettings.prefered_colors?.[index] ?? color);
      if (effect.CustomSettings.audio_settings) effect.CustomSettings.audio_settings = clone(globalSettings.audio_settings);
    }
    effect.ControllerZones = snapshot.devices.flatMap(device => Array.from({length: device.zoneCount}, (_, index) => zone(device, index)));
    const effects = sceneRef.current.Effects; edit([...effects, effect]); setSelected(effects.length); setLibrary(false);
  };
  const apply = () => void action(async () => {
    const pendingRevision = revision.current, pendingMode = draftMode.current, pending = normalize(sceneRef.current);
    const result = dirtyRef.current ? await window.rayloom.effects('scene.apply', {profile: pending}) : (await window.rayloom.effects('start'), await window.rayloom.effects('scene.get'));
    const applied = normalize(result);
    if (!mounted.current || draftMode.current !== pendingMode) return;
    if (revision.current === pendingRevision && draftMode.current === pendingMode) { sceneRef.current = applied; setScene(applied); dirtyRef.current = false; setDirty(false); setNotice('Сцена применена'); }
    else setNotice('Сцена применена. Новые правки остаются в черновике.');
    setRunning(applied.Effects.some(effect => effect.AutoStart));
  });
  const recoverDraft = (restore: boolean) => void action(async () => {
    if (!recovery || !mode) return;
    const restored = restore ? normalize(JSON.parse(recovery.raw)) : null;
    backupAdvancedDraft(draftStorage.current, recovery); draftStorage.current.removeItem(recovery.sourceKey); setRecovery(null);
    edit(restored?.Effects ?? []); setSelected(0); setLibrary(!restored);
    setNotice(restore ? 'Черновик восстановлен. Проверьте устройства перед применением.' : 'Копия прежнего черновика сохранена в этом окне. Можно создать новую сцену.');
  });
  const exportRecovery = () => void action(async () => {
    if (!recovery) return; let profile;
    try { profile = JSON.parse(recovery.raw); } catch { profile = {unparsedDraft: recovery.raw}; }
    await window.rayloom.scenes('export', {name: 'Rayloom черновик восстановления', profile});
  });

  const scenesPanel = <Stack gap="lg"><Paper p="lg" withBorder><Stack gap="md"><Title order={3}>Сохранить текущую сцену</Title><Text size="sm" c="dimmed">{scene.Effects.length} эффектов. Сохранение не запускает подсветку.</Text><Group align="end"><TextInput className="rayloom-grow" label="Имя сцены" value={sceneName} onChange={event => { viewRevision.current++; setSceneName(event.currentTarget.value); }}/><Button disabled={busy || !sceneName.trim() || !draftReady || Boolean(recovery)} leftSection={<Save size={16}/>} onClick={() => void action(async () => { await window.rayloom.scenes('save', {name: sceneName, profile: normalize(sceneRef.current)}); await refreshSaved(); }, 'Сцена сохранена')}>Сохранить</Button></Group><Group><Button variant="default" leftSection={<Upload size={15}/>} onClick={() => void action(() => window.rayloom.scenes('export', {name: sceneName, profile: sceneRef.current}))}>Экспортировать</Button><Button variant="default" leftSection={<Download size={15}/>} disabled={busy || Boolean(recovery) || !draftReady} onClick={() => replaceScene('Импортировать другую сцену?', () => window.rayloom.scenes('import'))}>Импортировать</Button></Group></Stack></Paper>
    <SimpleGrid cols={{base: 1, sm: 2, lg: 3}}>{saved.map(name => <Paper key={name} p="lg" withBorder><Stack gap="md"><Text fw={600}>{name}</Text><Group justify="space-between"><Button aria-label={`Открыть сцену ${name}`} variant="light" disabled={busy || Boolean(recovery) || !draftReady} onClick={() => replaceScene(`Открыть сцену «${name}»?`, () => window.rayloom.scenes('load', {name}), name)}>Открыть</Button><ActionIcon variant="subtle" color="red" aria-label={`Удалить сцену ${name}`} disabled={busy} onClick={() => void action(async () => { await window.rayloom.scenes('delete', {name}); await refreshSaved(); })}><Trash2 size={16}/></ActionIcon></Group></Stack></Paper>)}</SimpleGrid>{!saved.length && <Text c="dimmed">Сохранённых сцен пока нет.</Text>}
    <RayloomDisclosure title="Сцены старой версии"><Button variant="default" disabled={Boolean(recovery) || !draftReady || busy} onClick={() => replaceScene('Импортировать сцену прежней версии?', async () => { const profile = await window.rayloom.scenes('legacy'); if (!profile) throw Error('Сцена старой версии не найдена'); return profile; })}>Импортировать сцену прежней версии</Button></RayloomDisclosure>
  </Stack>;

  const assignment = current && <Stack gap="lg"><Paper p="lg" withBorder><Stack gap="md"><Title order={4}>Устройства эффекта</Title><Text size="sm" c="dimmed">Выберите порты и зоны, которыми управляет этот эффект.</Text>{snapshot.devices.map(device => <RayloomDisclosure key={device.index} title={device.name} defaultExpanded={snapshot.devices.length === 1}>{Array.from({length: device.zoneCount}, (_, index) => {
    const assigned = (current.ControllerZones ?? []).find(item => item.location === device.location && item.zone_idx === index);
    return <Stack key={index} gap="sm" className="rayloom-native-zone"><RayloomSwitch label={device.zones?.[index]?.name || `Зона ${index + 1}`} selected={Boolean(assigned)} onChange={enabled => update({...current, ControllerZones: enabled ? [...current.ControllerZones, zone(device, index)] : current.ControllerZones.filter(item => item !== assigned)})}/>{assigned && <><RayloomSwitch label="Обратное направление" selected={Boolean(assigned.reverse)} onChange={reverse => update({...current, ControllerZones: current.ControllerZones.map(item => item === assigned ? {...item, reverse} : item)})}/><Numeric label="Яркость зоны" min={0} max={100} value={assigned.self_brightness} onChange={next => update({...current, ControllerZones: current.ControllerZones.map(item => item === assigned ? {...item, self_brightness: next} : item)})}/></>}</Stack>;
  })}</RayloomDisclosure>)}<RayloomSwitch label="Автовыбор всех зон" selected={current.SelectAll} onChange={SelectAll => update({...current, SelectAll})}/></Stack></Paper>
    <Paper p="lg" withBorder><Stack gap="sm"><Title order={4}>Эффект в сцене</Title><Button variant="default" disabled={scene.Effects.length >= 64} leftSection={<Copy size={15}/>} onClick={() => { const effects = sceneRef.current.Effects; if (effects.length >= 64) return; edit([...effects, clone(current)]); setSelected(effects.length); }}>Дублировать</Button><Button variant="default" leftSection={<Save size={15}/>} onClick={() => void action(async () => { await window.rayloom.scenes('save', {kind: 'preset', name: current.CustomName || current.EffectClassName, profile: current}); await refreshSaved(); }, 'Пресет сохранён')}>Сохранить пресет</Button>
      <RayloomSelect ariaLabel="Загрузить пресет" value="" placeholder="Пресеты эффекта…" onChange={name => void action(async () => { const unchanged = capture(); const preset = await window.rayloom.scenes('load', {kind: 'preset', name}); if (!unchanged()) { notify('Пресет не загружен: выбранный эффект или его параметры уже изменились.'); return; } if (preset.EffectClassName !== current.EffectClassName) throw Error('Этот пресет относится к другому эффекту'); const normalized = normalize({version: 2, Effects: [preset]}).Effects[0]; update({...normalized, ControllerZones: current.ControllerZones}); notify('Пресет загружен'); })} options={presets.map(name => ({value: name, label: name}))}/>
      <Button variant="light" color="red" leftSection={<Trash2 size={15}/>} onClick={() => { edit(sceneRef.current.Effects.filter((_, index) => index !== selected)); setSelected(Math.max(0, selected - 1)); }}>Удалить из сцены</Button>
    </Stack></Paper></Stack>;

  return <Stack gap="lg" className="rayloom-native-editor"><Modal opened={replacement !== null} onClose={() => setReplacement(null)} title={replacement?.title ?? 'Заменить сцену?'} centered className="rayloom"><Text size="sm" mb="lg">В текущей сцене есть изменения. При замене сохранится резервная копия — её можно будет восстановить в редакторе.</Text><Group justify="flex-end"><Button variant="default" onClick={() => setReplacement(null)}>Остаться</Button><Button onClick={() => { const next = replacement; setReplacement(null); next?.run(); }}>Заменить сцену</Button></Group></Modal><Group justify="space-between" align="start"><Stack gap={6}><Button variant="subtle" size="sm" leftSection={<ArrowLeft size={16}/>} onClick={() => { viewRevision.current++; onBack(); }} className="rayloom-back-button">К моей подсветке</Button><Title order={2}>Редактор сцены</Title><Text size="sm" c="dimmed">Слои, аудио, захват экрана и отдельные эффекты для разных устройств.</Text></Stack><Badge variant="light" color={dirty ? 'yellow' : 'gray'}>{dirty ? 'Есть изменения' : 'Черновик готов'}</Badge></Group>
    <Alert variant="light" color="gray">Это отдельная сцена Effects Plugin. При запуске она заменяет текущую подсветку; расположение устройств в «Моём свете» сохраняется.</Alert>
    <Tabs value={tab} onChange={next => { if (next) setTab(next); }}><Tabs.List aria-label="Разделы редактора сцены">{sections.map(section => <Tabs.Tab key={section.id} value={section.id}>{section.label}</Tabs.Tab>)}</Tabs.List></Tabs>
    {notice && <Alert withCloseButton onClose={() => setNotice('')} role="status">{notice}</Alert>}
    {previousDraft && <Alert color="gray" title="Предыдущий черновик сохранён"><Group justify="space-between"><Text size="sm">{previousDraft.name || 'Сцена до замены'}</Text><Button variant="subtle" disabled={busy || !draftReady || Boolean(recovery)} onClick={() => replaceScene('Восстановить предыдущий черновик?', async () => previousDraft.scene, previousDraft.name)}>Восстановить предыдущий</Button></Group></Alert>}
    {recovery && <Alert color="yellow" title="Черновик требует восстановления"><Stack gap="sm"><Text size="sm">{recovery.error}</Text><Text size="sm">Исходный текст сохранён. Можно экспортировать его или оставить резервную копию и создать новую сцену.</Text><Group><Button variant="default" disabled={busy} onClick={exportRecovery}>Экспортировать черновик</Button>{recovery.legacy && <Button variant="default" disabled={busy} onClick={() => recoverDraft(true)}>Импортировать в текущий режим</Button>}<Button variant="light" disabled={busy} onClick={() => recoverDraft(false)}>Создать новый черновик</Button></Group></Stack></Alert>}
    {sceneError && <Alert color="red" title="Не удалось загрузить настройки эффекта"><Stack gap="sm"><Text size="sm">Вы можете вернуться к подсветке или открыть другой раздел.</Text><RayloomDisclosure title="Подробности ошибки"><Text size="xs" className="rayloom-code-log">{sceneError}</Text></RayloomDisclosure></Stack></Alert>}
    {snapshot.error && <Alert color="red">{snapshot.error}</Alert>}{snapshot.status?.virtual && <Text size="xs" c="dimmed">Виртуальная студия: физические устройства не изменяются.</Text>}
    {tab === 'effects' ? <Stack gap="lg"><Group justify="space-between"><Group><Badge variant="dot" color={running ? 'lime' : 'gray'}>{running ? 'Сцена работает' : 'Остановлена'}</Badge><Text c="dimmed" size="sm">{scene.Effects.length} эффектов</Text></Group><Group><Button variant="default" leftSection={<Save size={15}/>} onClick={() => setTab('scenes')}>Сохранить</Button><Button variant="default" aria-label="Остановить сцену" leftSection={<Pause size={15}/>} disabled={!online || busy} onClick={() => void action(async () => { await window.rayloom.effects('stop'); setRunning(false); }, 'Сцена остановлена')}>Стоп</Button><Button leftSection={<Play size={15}/>} disabled={!online || busy || Boolean(recovery) || !draftReady || !scene.Effects.length} loading={busy} onClick={apply}>{dirty ? 'Применить изменения' : 'Запустить сцену'}</Button></Group></Group>
      <RayloomDisclosure title="Текущие цвета устройств"><Stack gap="sm">{snapshot.devices.map(device => <div key={device.index}><Text size="xs" c="dimmed" mb={5}>{device.name}</Text><div className="rayloom-native-leds">{device.colors.map((color, index) => <i key={index} style={{background: hex(color)}}/>)}</div></div>)}<Text size="xs" c="dimmed">Живые цвета из движка.</Text></Stack></RayloomDisclosure>
      <fieldset className="rayloom-native-fieldset" disabled={Boolean(recovery) || !draftReady}><Stack gap="lg"><Tabs value={library || !current ? 'library' : String(selected)} onChange={next => { viewRevision.current++; if (next === 'library') setLibrary(true); else if (next !== null) { setSelected(Number(next)); setLibrary(false); } }}><Tabs.List aria-label="Эффекты текущей сцены">{scene.Effects.map((effect, index) => <Tabs.Tab key={index} value={String(index)}>{effect.CustomName || catalog.find(item => item.id === effect.EffectClassName)?.name || effect.EffectClassName}</Tabs.Tab>)}<Tabs.Tab value="library" leftSection={<Plus size={14}/>}>Добавить эффект</Tabs.Tab></Tabs.List></Tabs>
      {library || !current ? <Stack gap="md"><Group justify="space-between"><Title order={3}>Библиотека эффектов</Title><Text size="sm" c="dimmed">{catalog.length} эффектов</Text></Group><Text size="sm" c="dimmed">Выберите эффект, затем настройте его параметры и устройства.</Text><EffectLibrary value="" onChange={id => { const effect = catalog.find(item => item.id === id.slice(8)); if (effect) add(effect); }} catalog={catalog} plugins={[]} config={{color: 0xffffff, speed: 1, scale: 350, fps: 60, effectParameters: {}}} nativeOnly/></Stack> : <Stack gap="md"><Group justify="space-between"><Title order={3}>Настройки выбранного эффекта</Title><Button variant="default" leftSection={<ArrowLeft size={15}/>} onClick={() => { viewRevision.current++; setLibrary(true); }}>К библиотеке</Button></Group><div className="rayloom-native-editor-grid"><Paper p="lg" withBorder><EffectEditor key={`${mode}:${selected}:${current.EffectClassName}`} value={current} onChange={update} context={context}/></Paper>{assignment}</div></Stack>}
      </Stack></fieldset>
    </Stack> : tab === 'scenes' ? scenesPanel : tab === 'settings' ? <Paper p="lg" withBorder><Stack gap="lg"><Title order={3}>Настройки новых эффектов</Title><Text size="sm" c="dimmed">Эти значения используются, когда вы добавляете эффект в сцену.</Text>{globals && <><Fields fields={globals.fields} value={globals.value} onChange={value => { globalsRevision.current++; setGlobals({...globals, value}); }} context={context}/><Button disabled={busy} onClick={() => void action(async () => { const pendingRevision = globalsRevision.current, pendingMode = draftMode.current; const result = await window.rayloom.effects('globals.set', {settings: globals.value}); if (!mounted.current || draftMode.current !== pendingMode) return; if (globalsRevision.current === pendingRevision) { setGlobals(result); notify('Настройки сохранены'); } else notify('Настройки сохранены. Более новые правки ещё не применены.'); })}>Сохранить настройки</Button></>}</Stack></Paper> : tab === 'devices' ? <SimpleGrid cols={{base: 1, sm: 2, lg: 3}}>{snapshot.devices.map(device => <Paper p="lg" withBorder key={device.index}><Stack gap="sm"><Text fw={600}>{device.name}</Text><Text size="sm" c="dimmed">{device.ledCount} светодиодов · {device.zoneCount} зон</Text><div className="rayloom-native-leds">{device.colors.map((color, index) => <i key={index} style={{background: hex(color)}}/>)}</div></Stack></Paper>)}</SimpleGrid> : tab === 'visual-map' ? (mode ? <VisualMapPanel key={mode} draftScope={mode} devices={snapshot.devices} notify={setNotice}/> : <Text c="dimmed">Подключаем редактор карт…</Text>) : <PluginPanel key={tab} id={tab} devices={snapshot.devices} notify={setNotice}/>}
  </Stack>;
}
