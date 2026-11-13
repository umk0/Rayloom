import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Divider,Group,Modal,Stack,Text,TextInput,Title} from '@mantine/core';
import {useForm} from '@mantine/form';
import {Download,Gamepad2,Layers3,Save,Search} from 'lucide-react';
import {sceneFingerprint,sceneNameError} from '../../shared/scene-library.mjs';
import {RayloomDisclosure,RayloomSwitch} from './StudioControls';
import type {StudioController} from './useStudio';

const views=new Map<string,{name:string;query:string;savedFingerprint?:string}>();
export function ScenesScreen({s,onLoaded,onNative}:{s:StudioController;onLoaded:()=>void;onNative:()=>void}){
  const scope=s.state?.mode??s.snapshot.mode??'hardware';
  const remembered=useRef(views.get(scope)??{name:'Моя сцена',query:''});
  const [query,setQuery]=useState(remembered.current.query),[confirm,setConfirm]=useState<{kind:'replace'|'load';name:string}|null>(null);
  const [pending,setPending]=useState(''),[error,setError]=useState('');
  const mounted=useRef(true),working=useRef(false),latest=useRef(s);latest.current=s;
  const form=useForm({mode:'uncontrolled',initialValues:{name:remembered.current.name},validate:{name:sceneNameError},onValuesChange:values=>{
    remembered.current={...remembered.current,name:values.name};views.set(scope,remembered.current);
  }});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const scenes=s.state?.scenes??[];
  const visible=scenes.filter((scene:any)=>scene.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const blocked=!!pending||s.busy||!s.ready;
  const save=async(name:string,replace=false)=>{
    if(working.current||latest.current.busy||!latest.current.ready)return;
    working.current=true;setPending('save');setError('');
    try{
      const saved=await latest.current.saveScene(name,replace);
      if(saved){remembered.current={...remembered.current,savedFingerprint:sceneFingerprint(saved.layout,saved.config)};views.set(scope,remembered.current);if(mounted.current)setConfirm(null);}
      else if(mounted.current)setError('Не удалось сохранить сцену. Проверьте сообщение Rayloom и повторите попытку.');
    }catch(error){if(mounted.current)setError(String(error));}
    finally{working.current=false;if(mounted.current)setPending('');}
  };
  const submit=({name}:{name:string})=>{
    if(working.current||latest.current.busy)return;
    const clean=name.trim();
    if((latest.current.state?.scenes??[]).some((scene:any)=>scene.name===clean)){setConfirm({kind:'replace',name:clean});return;}
    return save(clean);
  };
  const load=async(name:string)=>{
    if(working.current||latest.current.busy||!latest.current.ready)return;
    working.current=true;setPending('load:'+name);setError('');
    try{const loaded=await latest.current.loadScene(name);if(mounted.current){if(loaded){setConfirm(null);onLoaded();}else setError('Сцена не открыта в редакторе. Проверьте сообщение Rayloom; ваши новые правки сохранены.');}}
    catch(error){if(mounted.current)setError(String(error));}
    finally{working.current=false;if(mounted.current)setPending('');}
  };
  const requestLoad=(name:string)=>{
    const current=latest.current;
    if(working.current||current.busy||!current.ready)return;
    if(current.hasChanges&&sceneFingerprint(current.layout,current.config)!==remembered.current.savedFingerprint){setConfirm({kind:'load',name});return;}
    void load(name);
  };
  return <Stack gap="xl">
    <Text size="sm" c="dimmed">Сцена хранит эффект, его настройки, группы и расположение устройств. Сохранение не меняет текущую подсветку.</Text>
    <form onSubmit={form.onSubmit(submit)}><Group align="start"><TextInput label="Название сцены" aria-label="Название пространственной сцены" placeholder="Например, вечер за столом" key={form.key('name')} {...form.getInputProps('name')} maxLength={100} disabled={blocked} style={{flex:1}} maw={420}/><Button type="submit" mt={25} leftSection={<Save size={16}/>} disabled={blocked} loading={pending==='save'}>Сохранить текущую сцену</Button></Group></form>
    {error&&<Alert color="red" role="alert" withCloseButton onClose={()=>setError('')}>{error}</Alert>}
    {!!scenes.length&&<TextInput aria-label="Поиск сохранённых сцен" placeholder="Найти сцену…" leftSection={<Search size={16}/>} value={query} onChange={e=>{const value=e.currentTarget.value;setQuery(value);remembered.current={...remembered.current,query:value};views.set(scope,remembered.current);}}/>}
    <Stack gap="sm" className="ray-scene-list">{visible.map((scene:any)=><Group key={scene.name} justify="space-between" className="ray-scene-row" wrap="wrap"><Group wrap="nowrap" style={{minWidth:0,flex:1}}><Layers3 size={21} style={{flexShrink:0}}/><div style={{minWidth:0}}><Text fw={550} style={{overflowWrap:'anywhere'}}>{scene.name}</Text><Text size="xs" c="dimmed">{scene.layout.components.length} компонентов · {scene.layout.groups.length} групп</Text></div></Group><Button variant="light" disabled={blocked} loading={pending==='load:'+scene.name} onClick={()=>requestLoad(scene.name)}>Загрузить</Button></Group>)}</Stack>
    {!visible.length&&<Stack align="center" py="lg"><Layers3 size={28}/><Text c="dimmed" ta="center">{scenes.length?'Нет сцен с таким названием.':'Сохраните первую сцену, чтобы возвращаться к ней одним действием.'}</Text>{scenes.length>0&&<Button variant="subtle" onClick={()=>{setQuery('');remembered.current={...remembered.current,query:''};views.set(scope,remembered.current);}}>Очистить поиск</Button>}</Stack>}
    <Button variant="subtle" leftSection={<Layers3 size={16}/>} onClick={onNative} style={{alignSelf:'flex-start'}}>Сцены из слоёв, пресеты и импорт</Button>
    <Divider/><GameIntegration s={s}/>
    <Modal opened={confirm!==null} onClose={()=>{if(!working.current)setConfirm(null);}} closeOnEscape={!pending} closeOnClickOutside={!pending} closeButtonProps={{disabled:!!pending}} title={confirm?.kind==='replace'?'Заменить сохранённую сцену?':'Загрузить другую сцену?'} centered classNames={{root:'rayloom'}}>
      <Text size="sm">{confirm?.kind==='replace'?`Сцена «${confirm.name}» уже существует. Заменить её текущими настройками?`:`В редакторе есть изменения. Сцена «${confirm?.name}» заменит их. Сохраните текущую сцену перед загрузкой, если хотите вернуться к ней позже.`}</Text>
      {error&&<Text c="red" size="sm" mt="md" role="alert">{error}</Text>}
      <Group justify="flex-end" mt="xl"><Button variant="default" disabled={!!pending} onClick={()=>setConfirm(null)}>{confirm?.kind==='load'?'Остаться':'Отмена'}</Button><Button disabled={blocked} loading={!!pending} onClick={()=>{if(confirm)void (confirm.kind==='replace'?save(confirm.name,true):load(confirm.name));}}>{confirm?.kind==='replace'?'Заменить сцену':'Загрузить без сохранения'}</Button></Group>
    </Modal>
  </Stack>;
}

function GameIntegration({s}:{s:StudioController}){
  return <RayloomDisclosure title="Игры и события"><Stack gap="md"><Group><Gamepad2 size={22}/><Title order={3}>Реакция на игру</Title></Group><Text c="dimmed" size="sm">Свет может реагировать на здоровье и события игры, которая поддерживает передачу состояния.</Text><RayloomSwitch label="Реагировать на события игры" selected={s.config.gameReactive} onChange={value=>s.setField('gameReactive',value)}/><Text size="xs" c="dimmed">Изменение применяется вместе с эффектом на экране «Мой свет».</Text><Group><Button variant="light" disabled={s.busy||!s.ready} onClick={()=>void s.run(()=>window.rayloom.studio(s.state?.gameService?.enabled?'game.stop':'game.start'))}>{s.state?.gameService?.enabled?'Отключить приём событий':'Включить приём событий'}</Button><Button variant="default" disabled={s.busy||!s.ready} leftSection={<Download size={15}/>} onClick={()=>void s.run(async()=>{if(await window.rayloom.studio('game.export'))s.setNotice('Конфигурация подготовлена для игры');})}>Конфигурация игры</Button></Group><RayloomDisclosure title="Проверить реакцию и подключение"><Stack gap="md"><Text size="sm">{s.state?.gameService?.enabled?'Приёмник: 127.0.0.1:'+s.state.gameService.port:'Приём событий выключен'}</Text><Text size="sm">Здоровье: {Math.round((s.state?.events?.health??1)*100)}% · Боезапас: {Math.round((s.state?.events?.ammo??1)*100)}%</Text><Group><Button variant="default" disabled={s.busy||!s.ready} onClick={()=>void s.run(()=>window.rayloom.studio('game.demo',{event:{name:'health',value:.15}}))}>Здоровье 15%</Button><Button variant="default" disabled={s.busy||!s.ready} onClick={()=>void s.run(()=>window.rayloom.studio('game.demo',{event:{name:'health',value:1}}))}>Здоровье 100%</Button></Group></Stack></RayloomDisclosure></Stack></RayloomDisclosure>;
}
