import {useEffect,useRef,useState} from 'react';
import {Accordion,Badge,Button,Group,Paper,ScrollArea,Stack,Text,TextInput,Title} from '@mantine/core';
import {Layers3,Lightbulb,Monitor,RefreshCw,Save,Search,Settings2} from 'lucide-react';
import type {StudioController} from './useStudio';
import type {Component} from '../studio-types';
import type {Device} from '../types';
import {deviceKey} from '../../shared/spatial.mjs';
import {isComponentAvailable} from '../../shared/device-visibility.mjs';
import {groupDevicePorts} from '../../shared/device-port-groups.mjs';
import {RayloomDisclosure,RayloomSwitch} from './StudioControls';
import {DeviceLayoutPreview} from './DeviceLayoutPreview';
import './devices.css';

type Props={s:StudioController;onGroups:()=>void;onInspect:(id:string)=>void;onLayout:(id:string)=>void};
type Port={zone:number;label:string;components:Component[];ledCount:number|null;configured:boolean;kind:string};
const plural=(count:number,one:string,few:string,many:string)=>count%100>=11&&count%100<=14?many:count%10===1?one:count%10>=2&&count%10<=4?few:many;
const componentName=(component:Component,device:Device,port:Port)=>component.name===device.name||component.name===`${device.name} · ${port.label}`?port.label:component.name;

function PortCard({port,device,liveDevice,s,onInspect,onLayout}:{port:Port;device:Device;liveDevice?:Device;s:StudioController;onInspect:Props['onInspect'];onLayout:Props['onLayout']}){
  const single=port.components.length===1?port.components[0]:undefined;
  const title=single?componentName(single,device,port):port.label;
  return <Paper component="section" withBorder radius="md" p="md" className="ray-port-card" data-port-zone={port.zone} aria-label={`Зона подсветки ${port.label}`}>
    <Group justify="space-between" align="start" wrap="nowrap" mb="sm">
      <div className="ray-port-heading"><Text fw={600}>{title}</Text>{title!==port.label&&<Text size="xs" c="dimmed">{port.label}</Text>}</div>
      {port.components.length>1&&<Badge variant="light" color="gray">{port.components.length} {plural(port.components.length,'компонент','компонента','компонентов')}</Badge>}
    </Group>
    <Stack gap="lg">{port.components.map(component=>{
      const available=isComponentAvailable(component,liveDevice),missingLayout=component.source==='OpenRGB LED order';
      const status=!liveDevice?'Не подключено':!available?'Порт изменился':!component.enabled?'Исключён из сцены':'В сцене';
      return <section key={component.id} className="ray-port-component" data-component-id={component.id} aria-label={`Компонент ${component.name}`}>
        {!single&&<Text fw={550} size="sm" mb="xs">{componentName(component,device,port)}</Text>}
        <DeviceLayoutPreview component={component} device={liveDevice} available={available}/>
        <Group justify="space-between" gap="xs" mt="sm"><Text size="xs" c="dimmed">{component.points.length} LED</Text><Text size="xs" c={!liveDevice||!available?'orange':'dimmed'}>{status}</Text></Group>
        {missingLayout&&component.points.length>1&&<Text size="xs" c="dimmed" mt="xs">Пока показан порядок LED. Выберите макет подключённого устройства.</Text>}
        {liveDevice&&!available&&<Text size="xs" c="dimmed" mt="xs">Сохранённый макет не совпадает с текущим портом. Проверьте диапазон LED в настройках.</Text>}
        <Group gap="xs" mt="md" className="ray-port-actions">
          <Button size="compact-sm" variant="light" disabled={s.busy||!component.points.length} leftSection={<Layers3 size={15}/>} aria-label={`Макет порта ${component.name}`} onClick={()=>onLayout(component.id)}>{missingLayout?'Выбрать макет':'Макет'}</Button>
          <Button size="compact-sm" variant="subtle" disabled={s.busy||!available||!component.points.length} leftSection={<Lightbulb size={15}/>} aria-label={`Подсветить порт ${component.name}`} onClick={()=>void s.run(()=>s.identify(component.id),'Освещение восстановлено после проверки')}>Подсветить</Button>
          <Button size="compact-sm" variant="subtle" color="gray" leftSection={<Settings2 size={14}/>} aria-label={`Настроить порт ${component.name}`} onClick={()=>onInspect(component.id)}>Настроить</Button>
        </Group>
      </section>;
    })}</Stack>
    {!port.configured&&<Stack className="ray-port-empty" align="center" gap="xs"><Layers3 size={25}/><Text size="sm">{port.ledCount===0?'LED не настроены':'Макет пока не создан'}</Text><Text size="xs" c="dimmed" ta="center">{port.ledCount===null?'Число LED появится после определения устройства.':port.ledCount===0?'Контроллер сообщает пустую зону подсветки.':`${port.ledCount} LED · дождитесь определения компонентов.`}</Text></Stack>}
  </Paper>;
}

export function DevicesScreen({s,onGroups,onInspect,onLayout}:Props){
  const allDevices=[...s.devices,...s.rememberedDevices],keys=allDevices.map(device=>String(deviceKey(device))),keySignature=JSON.stringify(keys);
  const [opened,setOpened]=useState<string[]>(()=>keys),seen=useRef(new Set(keys));
  const [database,setDatabase]=useState<any>(null),[query,setQuery]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  // Discovery can finish after this screen opens. Reveal each new controller
  // once, while respecting controllers the user explicitly collapsed.
  useEffect(()=>{
    const currentKeys:string[]=JSON.parse(keySignature),added=currentKeys.filter(key=>!seen.current.has(key));
    for(const key of currentKeys)seen.current.add(key);
    setOpened(current=>[...current.filter(key=>currentKeys.includes(key)),...added]);
  },[keySignature]);
  return <Stack gap="xl" className="ray-devices-screen">
    <Group justify="space-between"><Text c="dimmed">Каждый порт и компонент — со своим макетом подсветки.</Text><Group><Button variant="default" leftSection={<Layers3 size={16}/>} onClick={onGroups}>Группы</Button><Button variant="light" disabled={!s.ready||s.busy||s.state?.mode==='virtual'} leftSection={<RefreshCw size={16}/>} onClick={()=>void s.run(()=>window.rayloom.studio('rescan'),'Поиск устройств запущен')}>Найти устройства</Button></Group></Group>
    <Accordion multiple value={opened} onChange={setOpened} className="ray-device-list">{allDevices.map(device=>{
      const key=deviceKey(device),liveDevice=s.liveDevices.get(key),ports:Port[]=groupDevicePorts(device,s.layout.components),parts=ports.flatMap(port=>port.components),enabled=parts.some(component=>component.enabled);
      return <Accordion.Item key={key} value={key}>
        <Accordion.Control icon={<Monitor size={20}/>}><Group justify="space-between" pr="md" gap="xs"><Text fw={550} className="ray-device-name">{s.alias(device)}</Text><Text size="xs" c={liveDevice?'dimmed':'orange'}>{liveDevice?`${ports.length} ${plural(ports.length,'зона','зоны','зон')} подсветки`:'Не подключено'}</Text></Group></Accordion.Control>
        <Accordion.Panel><Stack gap="lg">
          <div className="ray-device-port-grid">{ports.map(port=><PortCard key={port.zone} port={port} device={device} liveDevice={liveDevice} s={s} onInspect={onInspect} onLayout={onLayout}/>)}</div>
          {!ports.length&&<Text size="sm" c="dimmed">Зоны подсветки появятся после определения устройства.</Text>}
          <RayloomDisclosure title="Настройки устройства"><Stack gap="md"><Group align="end" justify="space-between"><TextInput label="Название устройства" aria-label={`Название устройства ${device.name}`} maw={420} style={{flex:1}} maxLength={120} value={s.alias(device)} onChange={event=>s.edit({...s.layout,deviceAliases:{...s.layout.deviceAliases,[key]:event.currentTarget.value}})}/><RayloomSwitch label={`Вся подсветка: ${s.alias(device)}`} selected={enabled} disabled={s.busy||!s.ready||!parts.length} onChange={value=>void s.toggleDevice(key,value)}/></Group><Text size="xs" c="dimmed">{device.name}{!liveDevice?' · макеты и настройки сохранены':''}</Text><Text size="xs" c="dimmed">{device.metrics?`${Number(device.metrics.driverFps??0).toFixed(1)} отправок/с · ${Number(device.metrics.lastMs??0).toFixed(1)} мс`:'Диагностика появится после подключения.'}</Text></Stack></RayloomDisclosure>
        </Stack></Accordion.Panel>
      </Accordion.Item>;
    })}</Accordion>
    {!allDevices.length&&<div className="ray-empty"><Monitor size={32}/><Title order={3}>{s.ready?'Устройства пока не найдены':'Ищем оборудование…'}</Title><Text c="dimmed">Подключённые к плате устройства появятся внутри её портов.</Text></div>}
    {s.dirty&&<Group className="ray-save-bar" justify="space-between"><Text size="sm">Есть изменения названий или расположения.</Text><Button disabled={s.busy} leftSection={<Save size={15}/>} onClick={()=>void s.run(s.save,'Названия и настройки сохранены')}>Сохранить</Button></Group>}
    <RayloomDisclosure title="Каталог совместимых устройств" onExpandedChange={open=>{if(open&&!database)void s.run(async()=>{const result=await window.rayloom.studio('catalog');if(mounted.current)setDatabase(result);});}}><Stack gap="md"><Text size="sm" c="dimmed">Справочник помогает найти модель. Макет каждого порта настраивается в его карточке.</Text><TextInput aria-label="Поиск в базе устройств" placeholder="Производитель или модель" leftSection={<Search size={15}/>} value={query} onChange={event=>setQuery(event.currentTarget.value)}/><ScrollArea.Autosize mah={300}>{database?.devices?.filter((device:any)=>JSON.stringify(device).toLowerCase().includes(query.toLowerCase())).slice(0,40).map((device:any,index:number)=><Group key={index} justify="space-between" py="xs"><Text size="sm">{device.Name||device.detectorName||device.RGBController}</Text><Text size="xs" c="dimmed">{device.Category} · {device.Type}</Text></Group>)}</ScrollArea.Autosize><Text size="xs" c="dimmed">До 40 совпадений · {database?.devices?.length??0} моделей · {database?.layouts?.length??0} матриц</Text>{database?.sources?.map((source:any)=><Text key={source.id} size="xs" c="dimmed">{source.name} · {source.license} · {source.use==='reference-only'?'справочный источник':'локальный каталог'}</Text>)}</Stack></RayloomDisclosure>
  </Stack>;
}
