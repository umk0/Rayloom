import {Component as ReactComponent,Suspense,lazy,useEffect,useRef,useState,type ReactNode} from 'react';
import {ActionIcon,Accordion,Alert,Badge,Button,Divider,Group,Loader,Modal,NavLink,Notification,ScrollArea,SegmentedControl,Select,SimpleGrid,Stack,Text,TextInput,Title,Tooltip} from '@mantine/core';
import {ArrowLeft,ArrowRight,Boxes,Check,Code2,Download,Gamepad2,Layers3,Lightbulb,Monitor,Pause,Play,Plus,RefreshCw,Save,Search,Settings2,SlidersHorizontal,Sparkles,Timer,Waves,X} from 'lucide-react';
import {useStudio,type StudioController} from './useStudio';
import {WindowTitlebar} from './WindowTitlebar';
import {applyTheme} from './theme-preferences';
import {SpatialCanvas} from './SpatialCanvas';
import {PortInspector} from './PortInspector';
import {GroupsPanel} from './GroupsPanel';
import {EffectParameters} from './EffectParameters';
import {EffectLibrary} from './EffectLibrary';
import {ExtensionsScreen} from './ExtensionsScreen';
import {ScenesScreen} from './ScenesScreen';
import {DevicesScreen} from './DevicesScreen';
import {builtInExtensions} from '../../shared/extension-catalog.mjs';
import {RayloomDisclosure,RayloomSlider} from './StudioControls';
import {isComponentAvailable} from '../../shared/device-visibility.mjs';
import {normalizeSceneConfig} from '../../shared/scene-config.mjs';

const RuntimeSettings=lazy(()=>import('./RuntimeSettings').then(m=>({default:m.RuntimeSettings})));
const CanvasEffectEditor=lazy(()=>import('./CanvasEffectEditor').then(m=>({default:m.CanvasEffectEditor})));
const NativeSceneEditor=lazy(()=>import('./NativeSceneEditor').then(m=>({default:m.NativeSceneEditor})));
const PluginPanel=lazy(()=>import('./PluginPanels').then(m=>({default:m.PluginPanel})));
const VisualMapPanel=lazy(()=>import('./VisualMapPanel').then(m=>({default:m.VisualMapPanel})));
const DeviceLayoutDialog=lazy(()=>import('./DeviceLayoutDialog').then(m=>({default:m.DeviceLayoutDialog})));
type Tab='light'|'devices'|'groups'|'scenes'|'editor'|'extensions'|'settings'|'native'|'plugin'|'map';
const nav=[{id:'light',label:'Мой свет',icon:Lightbulb},{id:'devices',label:'Устройства',icon:Monitor},{id:'scenes',label:'Сцены',icon:Layers3},{id:'editor',label:'Создать',icon:Code2},{id:'extensions',label:'Расширения',icon:Boxes}] as const;
const integrationList:{id:string;title:string}[]=builtInExtensions;
class ScreenBoundary extends ReactComponent<{children:ReactNode;onBack:()=>void},{error:string}>{
 state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message};}
 render(){return this.state.error?<Alert color="red" title="Не удалось открыть этот раздел"><Text size="sm">Можно вернуться к подсветке. Ваш сохранённый профиль остаётся на месте.</Text><Button mt="md" variant="light" onClick={this.props.onBack}>Вернуться к моему свету</Button><Accordion mt="md"><Accordion.Item value="details"><Accordion.Control>Подробности</Accordion.Control><Accordion.Panel>{this.state.error}</Accordion.Panel></Accordion.Item></Accordion></Alert>:this.props.children;}
}

export function RayloomApp(){
 const s=useStudio();const [tab,setTab]=useState<Tab>('light'),[plugin,setPlugin]=useState(''),[nativeTab,setNativeTab]=useState('effects'),[expanded,setExpanded]=useState(false),[inspectorMode,setInspectorMode]=useState('effect'),[devicesOpen,setDevicesOpen]=useState(false);
 const [layoutTarget,setLayoutTarget]=useState('');
 const mode=s.state?.mode??s.snapshot.mode??'hardware';
 useEffect(()=>{setLayoutTarget('');},[mode]);
 const viewport=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!s.ready)return;let active=true;void window.rayloom.plugin('skin','config.get').then(config=>{if(active&&config?.load_at_startup)applyTheme(config);}).catch(()=>{});return()=>{active=false;};},[s.ready,s.state?.mode]);
 useEffect(()=>{if(!s.notice)return;const timeout=setTimeout(()=>s.setNotice(''),7000);return()=>clearTimeout(timeout);},[s.notice]);
 const choose=(next:Tab)=>{setTab(next);s.setNotice('');viewport.current?.scrollTo({top:0});};
 const chooseComponent=(id:string)=>{s.setSelected(id);setInspectorMode(id?'device':'effect');};
 const openNative=(section='effects')=>{setNativeTab(section);choose('native');};
 const selected=s.layout.components.find(c=>c.id===s.selected),device=selected?s.liveDevices.get(selected.deviceKey):undefined;
 const layoutComponent=s.layout.components.find(c=>c.id===layoutTarget),layoutDevice=layoutComponent?s.liveDevices.get(layoutComponent.deviceKey):undefined;
 const inspector=selected?<PortInspector key={selected.id} component={selected} device={isComponentAvailable(selected,device)?device:undefined} layout={s.layout} onCalibrationApplied={s.adoptLayout} onChange={s.update} onGroupsChange={groups=>s.edit({...s.layout,groups})} onSplit={part=>s.split(selected,part)} onBack={()=>chooseComponent('')} onIdentify={(led,color)=>s.identify(selected.id,led,color)} onEditLayout={()=>setLayoutTarget(selected.id)} onSaveTemplate={async()=>{await window.rayloom.studio('template.save',{component:selected.id,layout:s.layout,points:selected.points,name:selected.name,replace:false});}} templates={s.templates} run={s.run} busy={s.busy}/>:null;
 const activeNav=tab==='groups'?'devices':['native','plugin','map'].includes(tab)?'extensions':tab;
 const title=tab==='light'?'Мой стол':tab==='groups'?'Группы':tab==='native'?'Сцена из эффектов':tab==='plugin'?(integrationList.find(p=>p.id===plugin)?.title??'Настройки расширения'):tab==='map'?'Карты и градиенты':nav.find(n=>n.id===tab)?.label??'Настройки';
 const status=s.snapshot.error?'Нет связи с устройствами':!s.ready?'Ищем устройства…':s.running?'Подсветка работает':'Подсветка на паузе';
 return <div className="rayloom studio" data-ui="mantine">
  <WindowTitlebar onError={s.setNotice}/>
  <aside className="ray-navigation studio-nav" aria-label="Основная навигация">
   <div className="ray-wordmark"><img src="./brand/rayloom-lightscore-wordmark.png" alt="Rayloom"/></div>
   <Stack gap={6} className="ray-nav-items">{nav.map(n=><NavLink component="button" key={n.id} label={n.label} leftSection={<n.icon size={20}/>} active={activeNav===n.id} onClick={()=>choose(n.id)}/>)}</Stack>
   <div className="ray-nav-bottom"><NavLink component="button" label="Настройки" leftSection={<Settings2 size={19}/>} active={tab==='settings'} onClick={()=>choose('settings')}/></div>
  </aside>
  <ScrollArea className="ray-content" viewportRef={viewport} type="auto" scrollbarSize={5} offsetScrollbars={false}>
   <main className={'ray-main'+(tab==='light'?' is-workspace':'')}>
    <Group justify="space-between" gap="md" className="ray-page-heading"><Group gap="xl"><Title order={1}>{title}</Title>{tab==='light'&&<Text className="ray-live-status" size="sm"><span className={s.running?'live-dot active':'live-dot'}/>{status}</Text>}</Group>{tab==='light'&&<Button variant="subtle" color="gray" leftSection={<Monitor size={17}/>} onClick={()=>setDevicesOpen(true)}>{s.devices.length} устройств</Button>}{['native','plugin','map'].includes(tab)&&<Button variant="subtle" leftSection={<ArrowLeft size={16}/>} onClick={()=>choose('extensions')}>К расширениям</Button>}</Group>
    {(s.snapshot.error||s.state?.error)&&<Alert color="red" mb="md" role="alert">{s.snapshot.error||s.state.error}</Alert>}
    {s.state?.mode==='virtual'&&<Text className="ray-virtual-note" size="xs" mb="md">Виртуальная студия · тестовое оборудование <Button variant="transparent" size="compact-xs" onClick={()=>choose('settings')}>Изменить</Button></Text>}
    {!!s.state?.warnings?.length&&<Alert color="yellow" mb="md" title="Некоторые порты недоступны"><Text size="sm">{s.state.warnings[0]}</Text><Button variant="subtle" size="compact-sm" onClick={()=>choose('devices')}>Проверить устройства</Button></Alert>}
    <ScreenBoundary key={tab+plugin} onBack={()=>choose('light')}><Suspense fallback={<Group justify="center" mih={220}><Loader size="sm"/><Text c="dimmed">Открываем раздел…</Text></Group>}>
    {tab==='light'&&<>
     <div className="ray-workspace-grid">
      <section className="ray-space-column" aria-label="Пространство устройств">
       <Group className="ray-space-toolbar" gap="lg" wrap="nowrap"><div className="ray-target"><Select aria-label="Группа подсветки" value={s.config.group} onChange={value=>value&&s.setField('group',value)} data={s.layout.groups.map(g=>({value:g.id,label:g.name}))} leftSection={<Layers3 size={16}/>} allowDeselect={false}/><Button variant="transparent" size="compact-xs" onClick={()=>choose('groups')}>Настроить группы</Button></div><div className="ray-brightness"><RayloomSlider label="Яркость" value={s.config.brightness} suffix="%" onChange={value=>s.setField('brightness',value)}/></div></Group>
       <SpatialCanvas layout={s.layout} selected={s.selected} onSelect={chooseComponent} onChange={s.update} devices={s.snapshot.devices} inspector={inspector} onExpandedChange={setExpanded} onSave={()=>void s.run(s.save,'Расположение сохранено')} dirty={s.dirty} busy={s.busy} feedback={s.notice?{text:s.notice}:undefined}/>
       <Group justify="space-between" className="ray-space-save"><Text size="xs" c="dimmed">{s.dirty?'Расположение изменено':'Расположение сохранено'} · {s.layout.components.length} компонентов</Text><Button variant="subtle" size="compact-sm" disabled={!s.dirty||s.busy} leftSection={<Save size={14}/>} onClick={()=>void s.run(s.save,'Расположение сохранено')}>Сохранить расположение</Button></Group>
      </section>
      {!expanded&&<aside className="ray-inspector" aria-label="Свойства выбранного объекта">
       {selected&&<SegmentedControl fullWidth mb="lg" value={inspectorMode} onChange={setInspectorMode} data={[{value:'effect',label:'Эффект'},{value:'device',label:'Устройство'}]}/>}
       <ScrollArea className="ray-inspector-scroll" type="auto" scrollbarSize={4}><div className="ray-inspector-body">{selected&&inspectorMode==='device'?inspector:<EffectParameters effectId={s.config.effect} config={s.config} catalog={s.catalog} plugins={s.state?.plugins??[]} onChange={s.editConfig} onAdvanced={()=>openNative()}/>}</div></ScrollArea>
       <div className="ray-apply-panel"><Text size="xs" c="dimmed" mb={10}>{s.nativeRunning?'Сейчас работает сцена из эффектов':s.busy?'Применяем настройки…':s.hasChanges&&s.state?.running?'Есть неприменённые изменения':'Изменения применяются по кнопке'}</Text><Group wrap="nowrap" gap="xs"><Button className="ray-primary-apply" fullWidth size="md" leftSection={<Play size={19}/>} disabled={!s.ready||s.busy||!s.groupComponents.length} loading={s.busy} onClick={()=>void s.play()}>Применить</Button><Tooltip label="Приостановить подсветку"><ActionIcon size={44} variant="light" color="gray" aria-label="Остановить подсветку" disabled={!s.running||s.busy} onClick={()=>void s.stop()}><Pause size={20}/></ActionIcon></Tooltip></Group></div>
      </aside>}
     </div>
     <div className="ray-effect-dock"><EffectLibrary compact value={s.config.effect} onChange={value=>{s.setField('effect',value);setInspectorMode('effect');}} catalog={s.catalog} plugins={s.state?.plugins??[]} config={s.config}/></div>
    </>}
    {tab==='devices'&&<DevicesScreen key={mode} s={s} onGroups={()=>choose('groups')} onLayout={setLayoutTarget} onInspect={id=>{chooseComponent(id);choose('light');}}/>}
    {tab==='groups'&&<><Button variant="subtle" mb="lg" leftSection={<ArrowLeft size={15}/>} onClick={()=>choose('devices')}>К устройствам</Button><GroupsPanel key={s.state?.mode??s.snapshot.mode??'hardware'} draftScope={s.state?.mode??s.snapshot.mode??'hardware'} layout={s.layout} onChange={s.edit} onSave={s.save} onRemove={s.removeGroup} activeGroup={s.config.group} onActivate={id=>{s.setField('group',id);choose('light');}} busy={s.busy}/></>}
    {tab==='scenes'&&<ScenesScreen key={s.state?.mode??s.snapshot.mode??'hardware'} s={s} onLoaded={()=>choose('light')} onNative={()=>openNative('scenes')}/>}
    {tab==='editor'&&<CanvasEffectEditor layout={s.layout} config={normalizeSceneConfig(s.config)} onBack={()=>choose('light')}/>}
     {tab==='extensions'&&<ExtensionsScreen s={s} onOpen={id=>{if(id==='effects')openNative();else if(id==='visual-map')choose('map');else{setPlugin(id);choose('plugin');}}} onCreate={()=>choose('editor')} onEffects={()=>choose('light')}/>}
    {tab==='plugin'&&<PluginPanel key={plugin} id={plugin} devices={s.snapshot.devices} notify={s.setNotice}/>}
    {tab==='map'&&<VisualMapPanel key={s.state?.mode??s.snapshot.mode??'hardware'} draftScope={s.state?.mode??s.snapshot.mode??'hardware'} devices={s.snapshot.devices} notify={s.setNotice}/>}
    {tab==='native'&&<NativeSceneEditor key={nativeTab} initialTab={nativeTab} onBack={()=>choose('light')}/>}
    {tab==='settings'&&<SettingsScreen s={s} onTheme={()=>{setPlugin('skin');choose('plugin');}} onNativeSettings={()=>openNative('settings')}/>}
    </Suspense></ScreenBoundary>
   </main>
  </ScrollArea>
  <Modal opened={devicesOpen} onClose={()=>setDevicesOpen(false)} title="Устройства в пространстве" size="md" className="rayloom"><Stack gap={0}>{s.layout.components.filter(c=>isComponentAvailable(c,s.liveDevices.get(c.deviceKey))).map(c=><Button key={c.id} variant="subtle" color="gray" justify="space-between" h="auto" py="sm" rightSection={<ArrowRight size={16}/>} onClick={()=>{chooseComponent(c.id);setDevicesOpen(false);choose('light');}}>{c.name}</Button>)}<Divider my="sm"/><Button variant="light" onClick={()=>{setDevicesOpen(false);choose('devices');}}>Все устройства и порты</Button></Stack></Modal>
  {layoutComponent&&<Suspense fallback={<Modal opened onClose={()=>setLayoutTarget('')} title="Макет устройства" classNames={{root:'rayloom'}} zIndex={1300}><Loader size="sm"/></Modal>}><DeviceLayoutDialog key={mode+':'+layoutComponent.id} component={layoutComponent} device={isComponentAvailable(layoutComponent,layoutDevice)?layoutDevice:undefined} templates={s.templates} busy={s.busy} onClose={()=>setLayoutTarget('')} onApply={(points,expected,source)=>s.applyDeviceLayout(layoutComponent.id,points,expected,source)} onSaveTemplate={async(name,points,replace)=>{await window.rayloom.studio('template.save',{component:layoutComponent.id,layout:s.layout,points,name,replace});void s.refresh().catch(()=>{});}} onIdentify={isComponentAvailable(layoutComponent,layoutDevice)?led=>s.identify(layoutComponent.id,led):undefined}/></Suspense>}
  {s.notice&&!expanded&&<Notification className="ray-notice" role="status" title="Rayloom" onClose={()=>s.setNotice('')} withBorder>{s.notice}</Notification>}
 </div>;
}



function UpdateSettings(){
 const [status,setStatus]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const action=async(method:'check'|'download'|'install')=>{setBusy(true);setError('');try{setStatus(await window.rayloom.update(method));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 useEffect(()=>{void action('check');return window.rayloom.onUpdateAvailable(value=>setStatus(value));},[]);
 const message=status?.status==='available'?`Доступна версия ${status.latest}`:status?.status==='downloaded'?`Версия ${status.version} загружена и проверена`:status?.status==='no-release'?'Релизов пока нет':status?.status==='current'?'У вас последняя версия':'Проверяем обновления…';
 return <section><Group justify="space-between" align="center"><div><Title order={2}>Обновления</Title><Text size="sm" c="dimmed" mt="xs">Проверяем релизы Rayloom на GitHub при запуске и каждые 6 часов.</Text></div><Button variant="default" leftSection={<RefreshCw size={16}/>} loading={busy} onClick={()=>void action('check')}>Проверить</Button></Group><Text size="sm" mt="md">{message}</Text>{error&&<Alert color="red" mt="sm">{error}</Alert>}<Group mt="md">{status?.status==='available'&&<Button loading={busy} onClick={()=>void action('download')}>Загрузить обновление</Button>}{status?.status==='downloaded'&&<Button onClick={()=>void action('install')}>Установить и перезапустить</Button>}</Group></section>;
}
function SettingsScreen({s,onTheme,onNativeSettings}:{s:StudioController;onTheme:()=>void;onNativeSettings:()=>void}){
 return <Stack gap="xl"><RuntimeSettings/><Divider/><UpdateSettings/><Divider/><section><Title order={2} mb="lg">Интерфейс и оборудование</Title><Group align="end"><Select label="Режим оборудования" aria-label="Режим оборудования" value={s.state?.mode??'hardware'} onChange={value=>value&&void s.changeMode(value)} disabled={s.busy||s.snapshot.starting} allowDeselect={false} data={[{value:'hardware',label:'Моё оборудование'},{value:'virtual',label:'Виртуальная студия'}]}/><Button variant="default" onClick={onTheme}>Оформление</Button></Group><RayloomDisclosure title="Качество воспроизведения"><Select label="Целевая частота" aria-label="Целевая частота кадров" value={String(s.config.fps)} onChange={value=>value&&s.setField('fps',Number(value))} data={[...new Set<number>([30,60,90,120,s.config.fps])].sort((a,b)=>a-b).map(fps=>({value:String(fps),label:fps+' FPS'}))}/><Text size="sm" c="dimmed" my="md">Скорость эффекта меняет движение, частота — плавность. Изменение применяется вместе с эффектом.</Text><Text size="xs" c="dimmed">Сейчас: {Number(s.state?.metrics?.achievedFps??0).toFixed(1)} отправок/с</Text></RayloomDisclosure><RayloomDisclosure title="Общие настройки библиотеки эффектов"><Button variant="light" onClick={onNativeSettings}>Настроить библиотеку</Button></RayloomDisclosure></section><Divider/><section><Title order={2}>О Rayloom</Title><Text size="sm" c="dimmed" mt="sm">Свет компьютера и пространства вокруг вас. Программа с открытым исходным кодом.</Text><RayloomDisclosure title="Благодарности и лицензии"><Text size="sm">Rayloom основан на OpenRGB. Спасибо авторам драйверов, Plugin API, Effects Plugin и сообществу за эту основу.</Text><Text size="sm" c="dimmed" mt="sm">Ядро: {s.snapshot.status?.upstream??'OpenRGB'} · Plugin API {s.snapshot.status?.pluginApi??'—'} · Qt {s.snapshot.status?.qt??'—'}. Основной код: GPL-2.0-or-later. Интерфейс: Electron, React, Mantine, Monaco, Inter и Lucide. Лицензии и уведомления сохранены в проекте.</Text></RayloomDisclosure></section></Stack>;
}
