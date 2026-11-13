import {useEffect,useRef,useState} from 'react';
import {Accordion,Alert,Badge,Button,Group,Loader,Modal,ScrollArea,Stack,Tabs,Text,TextInput,UnstyledButton} from '@mantine/core';
import {Check,Save,Search} from 'lucide-react';
import type {Component,Point} from '../studio-types';
import type {Device} from '../types';
import {compatibleTemplates,makeUserTemplate,nativeLayoutTemplate,remapTemplatePoints} from '../../shared/device-layouts.mjs';
import {DeviceLayoutEditor} from './DeviceLayoutEditor';
import './device-layout-dialog.css';

type Props={component:Component;device?:Device;templates:any[];busy?:boolean;onApply:(points:Point[],expected:Point[],source:string)=>Promise<void>;onSaveTemplate:(name:string,points:Point[],replace:boolean)=>Promise<void>;onIdentify?:(led:number)=>Promise<void>;onClose:()=>void};
const copy=(points:Point[])=>points.map(point=>({...point}));
const signature=(points:Point[])=>JSON.stringify([...points].sort((a,b)=>a.led-b.led));
const binding=(component:Component)=>JSON.stringify([component.id,component.deviceKey,component.zone]);
const message=(error:unknown)=>error&&typeof error==='object'&&'message' in error?String(error.message):String(error);

function LayoutThumbnail({points}:{points:Point[]}){
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys),width=Math.max(10,Math.max(...xs)-left),height=Math.max(10,Math.max(...ys)-top),pad=Math.max(5,Math.max(width,height)*.08);
  return <svg className="ray-layout-thumbnail" viewBox={`${left-pad} ${top-pad} ${width+pad*2} ${height+pad*2}`} aria-hidden="true">{points.map(p=><circle key={p.led} cx={p.x} cy={p.y} r={Math.max(width,height)/70+1}/>)}</svg>;
}

/** The dialog owns a draft. Selection and template storage never apply it to a port. */
export function DeviceLayoutDialog({component,device,templates,busy=false,onApply,onSaveTemplate,onIdentify,onClose}:Props){
  const [base,setBase]=useState(()=>({points:copy(component.points),binding:binding(component)})),[points,setPoints]=useState(()=>copy(component.points));
  const [source,setSource]=useState(component.source),[selection,setSelection]=useState('current'),[tab,setTab]=useState<string|null>('mine'),[query,setQuery]=useState('');
  const [catalog,setCatalog]=useState<any[]|null>(null),[catalogLoading,setCatalogLoading]=useState(false),[catalogError,setCatalogError]=useState(''),[retry,setRetry]=useState(0);
  const [name,setName]=useState(component.name.slice(0,100)+' — мой макет'),[pending,setPending]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmReplace,setConfirmReplace]=useState(false),[confirmDiscard,setConfirmDiscard]=useState(false),[savedTemplates,setSavedTemplates]=useState<any[]>([]);
  const mounted=useRef(true),working=useRef(false),latest=useRef({component,busy,onApply,onSaveTemplate,onIdentify,onClose});latest.current={component,busy,onApply,onSaveTemplate,onIdentify,onClose};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(tab!=='catalog'||catalog!==null)return;
    let active=true;setCatalogLoading(true);setCatalogError('');
    void window.rayloom.studio('catalog').then(value=>{if(active)setCatalog(Array.isArray(value?.layouts)?value.layouts:[]);}).catch(reason=>{if(active)setCatalogError(message(reason));}).finally(()=>{if(active)setCatalogLoading(false);});
    return()=>{active=false;};
  },[tab,catalog,retry]);
  const conflict=binding(component)!==base.binding||signature(component.points)!==signature(base.points);
  const changed=signature(points)!==signature(base.points),blocked=!!pending||busy||conflict;
  const zone=device?.zones?.find(item=>item.index===component.zone),native=nativeLayoutTemplate(zone,component);
  const allTemplates=[...templates.filter(item=>!savedTemplates.some(saved=>saved.name===item.name)),...savedTemplates];
  const suitable=component.points.length?compatibleTemplates(allTemplates,component).sort((a:any,b:any)=>Number(b.deviceKey===component.deviceKey&&b.zone===component.zone)-Number(a.deviceKey===component.deviceKey&&a.zone===component.zone)):[];
  const catalogTemplates=catalog&&component.points.length?compatibleTemplates(catalog,component):[];
  const shownCatalog=catalogTemplates.filter((item:any)=>`${item.name} ${item.controllerFamily??''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const safe=()=>mounted.current&&!working.current&&!latest.current.busy&&binding(latest.current.component)===base.binding&&signature(latest.current.component.points)===signature(base.points);
  const choose=(item:any,key:string)=>{
    if(!safe())return;
    try{setPoints(remapTemplatePoints(item,base.points));setSource(item.name);setSelection(key);setError('');setNotice(Array.isArray(item.matrix)&&new Set(item.matrix.flat().filter((id:any)=>Number.isInteger(id)&&id>=0)).size<base.points.length?'Часть позиций не описана в каталоге. Для этих LED сохранены текущие координаты.':'');setConfirmDiscard(false);setConfirmReplace(false);}
    catch(reason){setError(message(reason));}
  };
  const requestClose=()=>{if(!mounted.current||working.current)return;if(changed){setConfirmDiscard(true);return;}onClose();};
  const apply=async()=>{
    if(!safe())return;
    working.current=true;setPending('apply');setError('');
    try{await latest.current.onApply(copy(points),copy(base.points),source||'Свой макет');if(mounted.current)latest.current.onClose();}
    catch(reason){if(mounted.current)setError(message(reason));}
    finally{working.current=false;if(mounted.current)setPending('');}
  };
  const saveTemplate=async(replace=false)=>{
    if(!safe())return;
    let template:any;
    try{template=makeUserTemplate({name,points,component:latest.current.component});}catch(reason){setError(message(reason));return;}
    if(!replace&&allTemplates.some(item=>item.name===template.name)){setConfirmReplace(true);return;}
    working.current=true;setPending('save');setError('');
    try{await latest.current.onSaveTemplate(template.name,copy(points),replace);if(mounted.current){setSavedTemplates(previous=>[...previous.filter(item=>item.name!==template.name),template]);setNotice('Макет сохранён в «Мои макеты». Чтобы включить его на устройстве, нажмите «Применить макет».');setConfirmReplace(false);}}
    catch(reason){if(mounted.current)setError(message(reason));}
    finally{working.current=false;if(mounted.current)setPending('');}
  };
  const identify=async(led:number)=>{
    if(!safe()||!latest.current.onIdentify)return;
    working.current=true;setPending('identify');
    try{await latest.current.onIdentify(led);}finally{working.current=false;if(mounted.current)setPending('');}
  };
  const card=(item:any,key:string,description:string)=>{
    let preview:Point[];try{preview=key==='current'?base.points:remapTemplatePoints(item,base.points);}catch{return null;}
    return <UnstyledButton key={key} className="ray-layout-card" data-selected={selection===key||undefined} aria-pressed={selection===key} disabled={blocked} onClick={()=>choose(item,key)}><LayoutThumbnail points={preview}/><span><Text component="span" size="sm" fw={550}>{item.name}</Text><Text component="span" size="xs" c="dimmed">{description}</Text></span>{selection===key&&<Check size={15}/>}</UnstyledButton>;
  };
  return <Modal opened onClose={requestClose} title={`Макет · ${component.name}`} size="min(1120px, 96vw)" yOffset="3vh" classNames={{root:'rayloom ray-layout-modal'}} scrollAreaComponent={ScrollArea.Autosize} zIndex={1100} closeOnClickOutside={false} closeOnEscape={!pending} closeButtonProps={{disabled:!!pending,'aria-label':'Закрыть редактор макета'}}>
    <Stack gap="md">
      <Group justify="space-between"><Text size="sm" c="dimmed">Расположите LED так, как они установлены в этом компоненте.</Text><Badge variant="light">{component.points.length} LED</Badge></Group>
      {conflict&&<Alert color="orange" title="Компонент изменился, пока редактор был открыт"><Text size="sm">Новые настройки устройства сохранены. Загрузите их, чтобы продолжить редактирование макета.</Text><Button mt="sm" size="sm" variant="light" disabled={!!pending} onClick={()=>{setBase({points:copy(component.points),binding:binding(component)});setPoints(copy(component.points));setSource(component.source);setSelection('current');setError('');setNotice('');setConfirmDiscard(false);}}>Загрузить текущий макет</Button></Alert>}
      {error&&<Alert color="red" role="alert" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
      {notice&&<Alert color="teal" role="status" withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
      {component.points.length>0?<div className="ray-layout-columns">
        <section className="ray-layout-picker" aria-label="Выбор макета"><Tabs value={tab} onChange={setTab} keepMounted={false}>
          <Tabs.List grow><Tabs.Tab value="mine">Мои макеты</Tabs.Tab><Tabs.Tab value="catalog">Каталог</Tabs.Tab></Tabs.List>
          <Tabs.Panel value="mine" pt="md"><ScrollArea.Autosize mah={460} scrollbarSize={4}><Stack gap="xs">
            {card({name:'Текущий макет',points:base.points},'current','Как сейчас настроен компонент')}
            {native&&card(native,'native','Из данных подключённого устройства')}
            {suitable.map((item:any,index:number)=>card(item,'saved:'+index,item.deviceKey===component.deviceKey&&item.zone===component.zone?'Сохранён для этого компонента':item.source==='user'?'Ваш сохранённый макет':'Готовая форма'))}
            {!suitable.length&&<Text size="xs" c="dimmed" p="xs">Здесь появятся сохранённые макеты с таким же числом LED.</Text>}
            <Button variant="light" disabled={blocked} onClick={()=>{if(safe()){setSelection('custom');setSource('Свой макет');setConfirmDiscard(false);}}}>Создать свой макет</Button>
          </Stack></ScrollArea.Autosize></Tabs.Panel>
          <Tabs.Panel value="catalog" pt="md"><Stack gap="sm"><Text size="xs" c="dimmed">Схемы с таким же числом LED. Проверьте порядок точек: совпадение количества ещё не означает совпадение модели.</Text><TextInput aria-label="Найти макет в каталоге" placeholder="Модель или производитель" leftSection={<Search size={14}/>} value={query} onChange={event=>setQuery(event.currentTarget.value)}/>
            {catalogLoading&&<Group gap="xs"><Loader size="xs"/><Text size="sm">Загружаем схемы…</Text></Group>}
            {catalogError&&<Alert color="orange">{catalogError}<Button variant="subtle" size="xs" onClick={()=>setRetry(value=>value+1)}>Повторить загрузку</Button></Alert>}
            <ScrollArea.Autosize mah={360} scrollbarSize={4}><Stack gap="xs">{shownCatalog.map((item:any,index:number)=>card(item,'catalog:'+(item.id??index),'Нужно проверить расположение'))}</Stack></ScrollArea.Autosize>
            {catalog&&!shownCatalog.length&&<Text size="sm" c="dimmed">Подходящей схемы нет. Создайте свою форму в редакторе справа.</Text>}
          </Stack></Tabs.Panel>
        </Tabs></section>
        <section className="ray-layout-custom" aria-label="Редактор своего макета"><Text fw={550} mb="xs">{selection==='custom'?'Свой макет':'Предпросмотр и настройка'}</Text><DeviceLayoutEditor key={component.id} points={points} disabled={blocked} onChange={next=>{if(safe()){setPoints(next);setSource('Свой макет');setSelection('custom');setConfirmReplace(false);setConfirmDiscard(false);setNotice('');}}} onIdentify={onIdentify?identify:undefined}/>
          <Accordion mt="md" variant="separated"><Accordion.Item value="save"><Accordion.Control>Сохранить в мои макеты</Accordion.Control><Accordion.Panel><Stack gap="sm"><Text size="xs" c="dimmed">Этот макет можно будет выбрать снова, в том числе для других компонентов с тем же числом LED.</Text><TextInput label="Название макета" value={name} maxLength={120} disabled={blocked} onChange={event=>{setName(event.currentTarget.value);setConfirmReplace(false);}}/><Button variant="light" leftSection={<Save size={15}/>} loading={pending==='save'} disabled={blocked||!name.trim()} onClick={()=>void saveTemplate()}>Сохранить макет</Button>{confirmReplace&&<Alert color="orange" title="Такое название уже есть"><Group mt="sm"><Button size="xs" disabled={blocked} onClick={()=>void saveTemplate(true)}>Заменить сохранённый макет</Button><Button size="xs" variant="subtle" disabled={blocked} onClick={()=>setConfirmReplace(false)}>Оставить прежний</Button></Group></Alert>}</Stack></Accordion.Panel></Accordion.Item></Accordion>
        </section>
      </div>:<Alert color="orange">В этом компоненте пока нет светодиодов. Сначала настройте количество LED на порту.</Alert>}
      {confirmDiscard&&<Alert color="orange" title="Закрыть без применения макета?"><Text size="sm">Изменения в этом окне будут отменены. Уже сохранённые макеты останутся в библиотеке.</Text><Group mt="sm"><Button size="sm" color="gray" disabled={!!pending} onClick={onClose}>Отменить изменения и закрыть</Button><Button size="sm" variant="subtle" onClick={()=>setConfirmDiscard(false)}>Продолжить редактирование</Button></Group></Alert>}
      <Group className="ray-layout-footer" justify="space-between"><Text size="xs" c="dimmed">{changed?'Макет ещё не применён к устройству.':'Выберите схему или измените форму в редакторе.'}</Text><Group><Button variant="default" disabled={!!pending} onClick={requestClose}>Отмена</Button><Button loading={pending==='apply'} disabled={blocked||!changed||!points.length} onClick={()=>void apply()}>Применить макет</Button></Group></Group>
    </Stack>
  </Modal>;
}
