import {Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode} from 'react';
import {Accordion, Alert, Badge, Button, Group, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Title} from '@mantine/core';
import {ArrowLeft, BookOpen, Code2, Download, Eye, Lightbulb, Save, Square, Upload} from 'lucide-react';
import {canvasTemplates} from '../../shared/canvas-templates.mjs';
import {type Layout} from '../studio-types';
import {BoundedNumber, RayloomColorInput, RayloomSwitch} from './StudioControls';
import {hex, rgb} from '../types';
import {CanvasEditorSession,cleanPanelError,normalizeCodePreferences,readUnchangedCanvasDocument,validateEditorSource} from '../../shared/panel-session.mjs';
import {normalizeAuthorHelp,openCanvasExample} from '../../shared/canvas-authoring.mjs';
import {CanvasAuthorHelp,type AuthorHelpContext} from './CanvasAuthorHelp';
import type {CanvasDiagnostic,CanvasReveal} from './CanvasCodeEditor';
import './panels.css';

const CanvasCodeEditor = lazy(() => import('./CanvasCodeEditor'));
type CanvasControl={key:string;label:string;type:'number'|'color'|'boolean';min?:number;max?:number;step?:number;default:any};
type Document={id?:string;name:string;source:string};
type Runtime={running?:boolean;output?:boolean|string;frames?:number;fps?:number;preview?:string;error?:string;name?:string;controls?:CanvasControl[];parameters?:Record<string,any>;target?:'preview'|'output'};
const draftKey='rayloom.canvas-editor.draft.v1',legacyDraftKey='lumenrgb.canvas-editor.draft.v1';
const navigationSession=new CanvasEditorSession(),preferencesKey='rayloom.canvas.preferences';
const helpKey='rayloom.canvas.author-help',recoveryKey='rayloom.canvas.before-example';
const errorText=cleanPanelError;
function initialDraft():Document {
  for(const key of [draftKey,legacyDraftKey])try {const draft=JSON.parse(localStorage.getItem(key)??'null');if(draft&&typeof draft.source==='string'&&typeof draft.name==='string'){if(key===legacyDraftKey)localStorage.setItem(draftKey,JSON.stringify(draft));return draft;}}catch{}
  const example=canvasTemplates[0];return {name:example?.name??'Мой эффект',source:example?.source??'<!doctype html>\n<canvas id="effect" width="128" height="128"></canvas>'};
}
class CodeBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}

export function CanvasEffectEditor({layout,config,onBack}:{layout:Layout;config:any;onBack?:()=>void}) {
  const [document,setDocument]=useState<Document>(initialDraft),[saved,setSaved]=useState<Document[]>([]);
  const [runtime,setRuntime]=useState<Runtime>({}),[parameters,setParameters]=useState<Record<string,any>>({});
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[noticeError,setNoticeError]=useState(false);
  const [outputGroup,setOutputGroup]=useState(config.group??'all'),[view,setView]=useState('split');
  const [compiledSource,setCompiledSource]=useState('');
  const [sessionReady,setSessionReady]=useState(false);
  const [helpOpened,setHelpOpened]=useState(false),[helpContext,setHelpContext]=useState<AuthorHelpContext>(()=>{try{return normalizeAuthorHelp(JSON.parse(localStorage.getItem(helpKey)??'null'));}catch{return normalizeAuthorHelp();}});
  const [exampleRecovery,setExampleRecovery]=useState<Document|null>(()=>{try{const value=JSON.parse(localStorage.getItem(recoveryKey)??'null');return value&&typeof value.name==='string'&&typeof value.source==='string'?value:null;}catch{return null;}});
  const [diagnostics,setDiagnostics]=useState<{source:string;items:CanvasDiagnostic[]}>({source:'',items:[]}),[reveal,setReveal]=useState<CanvasReveal>();
  const helpContextRef=useRef(helpContext),pendingReveal=useRef<{source:string;item:CanvasDiagnostic}|null>(null),revealRequest=useRef(0);
  const [codePreferences,setCodePreferences]=useState(()=>{try{return normalizeCodePreferences(JSON.parse(localStorage.getItem(preferencesKey)??'{}'));}catch{return normalizeCodePreferences();}});
  const sessionScope=useRef(''),documentRevision=useRef(0);
  const polling=useRef(false),parameterTimer=useRef<ReturnType<typeof setTimeout>|null>(null),busyRef=useRef(false),revision=useRef(0),active=useRef(false);
  const runtimeTarget=useRef<'preview'|'output'|undefined>(undefined),parametersRef=useRef<Record<string,any>>({}),parameterRevision=useRef(0),parameterEditing=useRef(false),parameterQueue=useRef<Promise<void>>(Promise.resolve());
  const api=async(method:string,args:Record<string,unknown>={})=>{
    if(!window.rayloom.canvas)throw Error('Перезапустите приложение, чтобы подключить редактор эффектов.');
    return window.rayloom.canvas(method,args);
  };
  const adoptRuntime=(value:Runtime)=>{
    if(!value)return;setRuntime(value);if(value.target){runtimeTarget.current=value.target;navigationSession.write(sessionScope.current,{target:value.target});}
    if(value.controls&&!parameterEditing.current){const next=Object.fromEntries(value.controls.map(control=>[control.key,value.parameters?.[control.key]??parametersRef.current[control.key]??control.default]));parametersRef.current=next;setParameters(next);}
  };
  const cancelParameterUpdate=()=>{parameterRevision.current++;parameterEditing.current=false;if(parameterTimer.current){clearTimeout(parameterTimer.current);parameterTimer.current=null;}};
  useEffect(()=>{
    active.current=true;let current=true,initialized=false;
    void api('list').then(items=>{if(current)setSaved(items);}).catch(e=>{if(current){setNotice(errorText(e));setNoticeError(true);}});
    const poll=async()=>{
      if(!initialized||polling.current||busyRef.current)return;polling.current=true;const token=revision.current;
      const parameterToken=parameterRevision.current;
      try{const value=await api('state',{target:runtimeTarget.current});if(current&&token===revision.current&&parameterToken===parameterRevision.current)adoptRuntime(value);}
      catch(e){if(current&&token===revision.current){setNotice(errorText(e));setNoticeError(true);}}
      finally{polling.current=false;}
    };
    void window.rayloom.studio('state').then(state=>{if(!current)return;sessionScope.current=state.mode;const remembered=navigationSession.read(state.mode);runtimeTarget.current=remembered.target;setCompiledSource(remembered.compiledSource??'');if(remembered.view)setView(remembered.view);if(remembered.outputGroup&&layout.groups.some(group=>group.id===remembered.outputGroup))setOutputGroup(remembered.outputGroup);initialized=true;setSessionReady(true);void poll();}).catch(error=>{if(current){setNotice(errorText(error));setNoticeError(true);initialized=true;setSessionReady(true);void poll();}});
    const timer=setInterval(()=>void poll(),400);
    return()=>{current=false;active.current=false;revision.current++;clearInterval(timer);cancelParameterUpdate();};
  },[]);
  useEffect(()=>{
    const persist=()=>{try{localStorage.setItem(draftKey,JSON.stringify(document));}catch{}};
    const timer=setTimeout(persist,250);return()=>{clearTimeout(timer);persist();};
  },[document]);
  const action=async(fn:()=>Promise<any>,message?:string)=>{
    if(busyRef.current||!sessionReady)return;busyRef.current=true;revision.current++;setBusy(true);setNotice('');setNoticeError(false);
    try{await fn();if(message&&active.current)setNotice(message);}
    catch(e){if(active.current){setNotice(errorText(e));setNoticeError(true);}}
    finally{busyRef.current=false;if(active.current)setBusy(false);}
  };
  const useDocument=(next:Document)=>{documentRevision.current++;cancelParameterUpdate();setDocument({id:next.id,name:next.name,source:next.source});parametersRef.current={};setParameters({});setNoticeError(false);setNotice('Код загружен. Проверьте его в предпросмотре.');};
  const updateHelp=(patch:Partial<AuthorHelpContext>)=>{const next=normalizeAuthorHelp({...helpContextRef.current,...patch});helpContextRef.current=next;setHelpContext(next);try{localStorage.setItem(helpKey,JSON.stringify(next));}catch{}};
  const rememberRecovery=(next:Document|null)=>{setExampleRecovery(next);try{if(next)localStorage.setItem(recoveryKey,JSON.stringify(next));else localStorage.removeItem(recoveryKey);}catch{setNotice('Возврат к черновику доступен до закрытия редактора: не удалось сохранить копию на диске.');setNoticeError(true);}};
  const openExample=(id:string)=>{if(busyRef.current||!sessionReady)return;const template=canvasTemplates.find((item:any)=>item.id===id);if(!template)return;const next=openCanvasExample(document,template,exampleRecovery);useDocument(next.document);rememberRecovery(next.previous);setView('split');navigationSession.write(sessionScope.current,{view:'split'});updateHelp({step:1});setHelpOpened(false);};
  const openHelp=(topic?:AuthorHelpContext['topic'])=>{if(topic)updateHelp({topic});setHelpOpened(true);};
  const closeHelp=()=>{pendingReveal.current=null;setHelpOpened(false);};
  const finishHelpClose=()=>{const pending=pendingReveal.current;pendingReveal.current=null;if(pending&&pending.source===document.source)setReveal({...pending.item,request:++revealRequest.current});};
  const revealDiagnostic=(item:CanvasDiagnostic)=>{pendingReveal.current={source:document.source,item};setView('split');navigationSession.write(sessionScope.current,{view:'split'});setHelpOpened(false);};
  const loadDocument=(load:()=>Promise<Document|null>)=>action(async()=>{const next=await readUnchangedCanvasDocument(load,()=>documentRevision.current);if(next&&active.current)useDocument(next);});
  const launch=(output:boolean)=>action(async()=>{
    const sourceError=validateEditorSource(document.source);if(sourceError)throw Error(sourceError);
    cancelParameterUpdate();
    await parameterQueue.current;runtimeTarget.current=output?'output':'preview';
    if(output)await window.rayloom.studio('save',{layout});
    const value=await api(output?'play':'preview',{name:document.name,source:document.source,config:{...config,group:outputGroup},parameters:document.source===compiledSource?parametersRef.current:{}});
    navigationSession.write(sessionScope.current,{compiledSource:document.source,target:output?'output':'preview'});
    if(active.current){adoptRuntime(value);setCompiledSource(document.source);if(!output)updateHelp({step:2});}
  },output?'Эффект включён на выбранной группе.':'Предпросмотр запущен. Новые кадры на устройства не отправляются.');
  const save=()=>void action(async()=>{
    if(!document.name.trim())throw Error('Укажите название эффекта.');
    const sourceError=validateEditorSource(document.source);if(sourceError)throw Error(sourceError);
    const item=await api('save',{...document,name:document.name.trim()});
    if(item?.id&&active.current)setDocument(current=>current.source===document.source&&current.name===document.name?{...current,id:item.id}:current);
    const items=await api('list');if(active.current)setSaved(items);
  },'Эффект сохранён в библиотеку.');
  const updateParameter=(key:string,value:any)=>{
    if(busyRef.current||!runtime.running)return;
    const next={...parametersRef.current,[key]:value};parametersRef.current=next;setParameters(next);cancelParameterUpdate();parameterEditing.current=true;
    const parameterToken=parameterRevision.current,target=runtimeTarget.current;
    parameterTimer.current=setTimeout(()=>{
      parameterTimer.current=null;
      parameterQueue.current=parameterQueue.current.then(async()=>{
        if(parameterToken!==parameterRevision.current||runtimeTarget.current!==target)return;
        try{const result=await api('parameters',{parameters:next,target});if(active.current&&runtimeTarget.current===target&&parameterToken===parameterRevision.current){parameterEditing.current=false;adoptRuntime(result);}}
        catch(e){if(active.current&&runtimeTarget.current===target&&parameterToken===parameterRevision.current){parameterEditing.current=false;setNotice(errorText(e));setNoticeError(true);}}
      });
    },100);
  };
  const output=runtime.output===true||runtime.output==='devices'||runtime.output==='hardware';
  const changed=compiledSource!==document.source;
  const sourceError=validateEditorSource(document.source);
  const currentDiagnostics=diagnostics.source===document.source?diagnostics.items:[];
  const updatePreferences=(patch:Record<string,unknown>)=>{const next=normalizeCodePreferences({...codePreferences,...patch});setCodePreferences(next);try{localStorage.setItem(preferencesKey,JSON.stringify(next));}catch{setNotice('Настройки редактора действуют до закрытия окна: не удалось сохранить их на диске.');setNoticeError(true);}};
  const sourceFallback=<Stack p="md" h="100%"><Alert color="yellow">Редактор кода не загрузился. Ваш черновик доступен ниже.</Alert><Textarea aria-label="HTML-код эффекта" className="rayloom-code-fallback" value={document.source} onChange={e=>{documentRevision.current++;setDocument({...document,source:e.currentTarget.value});}} spellCheck={false} autosize minRows={15}/></Stack>;
  return <Stack className="rayloom-canvas-editor" gap="lg">
    <Group justify="space-between"><Text c="dimmed" size="sm">Создайте свет из готового примера или своего HTML.</Text><Button variant="light" leftSection={<BookOpen size={16}/>} onClick={()=>openHelp()}>Помощь и примеры</Button></Group>
    <Group justify="space-between" align="flex-end" className="rayloom-canvas-document">
      <TextInput label="Название эффекта" aria-label="Название Canvas-эффекта" value={document.name} maxLength={100} onChange={e=>{documentRevision.current++;setDocument({...document,name:e.currentTarget.value});}} description="Черновик сохраняется автоматически" className="rayloom-canvas-name"/>
      <Group gap="xs"><Button variant="default" disabled={!sessionReady||busy} leftSection={<Download size={15}/>} onClick={()=>void loadDocument(async()=>{const item=await api('import');return item?.source?item:null;})}>Импорт HTML</Button><Button variant="default" disabled={!sessionReady||busy} leftSection={<Upload size={15}/>} onClick={()=>void action(async()=>{if(await api('export',document))setNotice('Экспорт завершён.');})}>Экспорт</Button><Button disabled={!sessionReady||busy||!!sourceError||!document.name.trim()} leftSection={<Save size={15}/>} onClick={save}>Сохранить</Button></Group>
    </Group>
    <Group align="flex-end" className="rayloom-canvas-library">
      <Select label="Начать с шаблона" aria-label="Шаблон Canvas-эффекта" value={null} placeholder="Выбрать пример" data={canvasTemplates.map((item:any)=>({value:item.id,label:item.name}))} disabled={!sessionReady||busy} onChange={value=>{if(typeof value==='string')openExample(value);}} searchable/>
      <Select label="Мои эффекты" aria-label="Сохранённый Canvas-эффект" value={document.id??null} placeholder={saved.length?'Выбрать сохранённый':'Пока нет сохранённых эффектов'} disabled={!saved.length||busy} data={saved.map(item=>({value:item.id!,label:item.name}))} onChange={id=>{if(id)void loadDocument(async()=>{const item=await api('read',{id});if(!item)throw Error('Эффект больше не найден в библиотеке.');return item;});}} searchable/>
      <SegmentedControl aria-label="Вид редактора" value={view} onChange={next=>{setView(next);navigationSession.write(sessionScope.current,{view:next});}} data={[{value:'code',label:'Код'},{value:'split',label:'Код и просмотр'},{value:'preview',label:'Просмотр'}]}/>
    </Group>
    {exampleRecovery&&<Alert color="gray" title="Ваш предыдущий черновик сохранён"><Group justify="space-between" gap="sm"><Text size="sm">«{exampleRecovery.name}» можно вернуть после знакомства с примерами.</Text><Button size="xs" variant="default" disabled={!sessionReady||busy} onClick={()=>{if(busyRef.current)return;useDocument(exampleRecovery);rememberRecovery(null);}}>Вернуть черновик</Button></Group></Alert>}
    <div className="rayloom-canvas-workspace" data-view={view}>
      <Paper withBorder radius="lg" className="rayloom-canvas-source">
        <Group justify="space-between" className="rayloom-canvas-panel-heading"><Group gap="xs"><Code2 size={17}/><Text fw={600}>Код эффекта</Text></Group>{changed&&<Badge color="gray" variant="light">Не применён</Badge>}</Group>
        <div className="rayloom-canvas-monaco"><CodeBoundary fallback={sourceFallback}><Suspense fallback={<div className="rayloom-code-loading" role="status">Открываем редактор кода…</div>}><CanvasCodeEditor value={document.source} onChange={source=>{documentRevision.current++;setDocument(current=>({...current,source}));}} onPreview={()=>void launch(false)} onSave={save} fontSize={codePreferences.fontSize} wordWrap={codePreferences.wordWrap} onDiagnostics={setDiagnostics} reveal={reveal}/></Suspense></CodeBoundary></div>
        <Text className="rayloom-code-shortcuts" c="dimmed" size="xs">{window.rayloom.platform==='darwin'?'⌘':'Ctrl'}+Enter — предпросмотр · {window.rayloom.platform==='darwin'?'⌘':'Ctrl'}+S — сохранить</Text>
      </Paper>
      <Paper withBorder radius="lg" className="rayloom-canvas-preview">
        <Group justify="space-between" className="rayloom-canvas-panel-heading"><Group gap="xs"><Eye size={17}/><Text fw={600}>Предпросмотр</Text></Group><Badge color={output?'ray':'gray'} variant="light">{output?'На устройствах':runtime.running?'Только экран':'Остановлен'}</Badge></Group>
        <div className="rayloom-canvas-frame">{runtime.preview?<img src={runtime.preview} alt="Последний кадр Canvas-эффекта"/>:<Stack align="center" gap="sm" p="xl"><Code2 size={34}/><Text fw={600}>Ваш свет начинается здесь</Text><Text c="dimmed" ta="center" size="sm">Напишите код или выберите шаблон, затем нажмите «Предпросмотр».</Text></Stack>}</div>
        <Stack gap="md" p="md"><Group grow><Button variant="default" disabled={!sessionReady||busy||!!sourceError||!document.source.trim()} leftSection={<Eye size={15}/>} onClick={()=>void launch(false)}>Предпросмотр</Button><Button variant="subtle" color="gray" disabled={!sessionReady||busy||!runtime.running} leftSection={<Square size={14}/>} onClick={()=>void action(async()=>{cancelParameterUpdate();await parameterQueue.current;adoptRuntime(await api('stop',{target:runtimeTarget.current}));},runtimeTarget.current==='preview'?'Предпросмотр остановлен. Текущая подсветка продолжает работать.':'Эффект остановлен.')}>Стоп</Button></Group>
          <Select label="Куда отправлять эффект" aria-label="Группа Canvas-эффекта" value={outputGroup} onChange={value=>{if(value){setOutputGroup(value);navigationSession.write(sessionScope.current,{outputGroup:value});}}} data={layout.groups.map(group=>({value:group.id,label:group.name}))}/>
          <Button disabled={!sessionReady||busy||!!sourceError||!document.source.trim()||!layout.components.length} leftSection={<Lightbulb size={16}/>} onClick={()=>void launch(true)}>Включить на устройствах</Button>
          <Text size="sm" c="dimmed">Заменит текущую сцену. Расположение, калибровка и яркость сохраняются.</Text>
        </Stack>
      </Paper>
    </div>
    {sourceError&&<Alert color="yellow" role="alert">{sourceError}</Alert>}
    {(notice||runtime.error)&&<Alert color={runtime.error||noticeError?'red':'ray'} role={runtime.error||noticeError?'alert':'status'}>{runtime.error||notice}{(runtime.error||noticeError)&&<Button display="block" variant="subtle" size="xs" mt="xs" onClick={()=>openHelp('errors')}>Помощь с ошибками</Button>}</Alert>}
    {currentDiagnostics.length>0&&<Button variant="subtle" color="yellow" style={{alignSelf:'flex-start'}} onClick={()=>openHelp('errors')}>Сообщения редактора: {currentDiagnostics.length}</Button>}
    {!!runtime.controls?.length&&<Paper component="fieldset" disabled={!sessionReady||busy||!runtime.running} m={0} style={{minWidth:0}} withBorder p="lg" radius="lg"><Group justify="space-between" mb="md"><Title order={3}>Параметры эффекта</Title>{changed&&<Text c="dimmed" size="sm">Настройки «{runtime.name||'последнего запуска'}»</Text>}</Group><SimpleGrid cols={{base:1,sm:2,lg:3}} spacing="lg">{runtime.controls.map(control=>control.type==='boolean'?<RayloomSwitch key={control.key} label={control.label} selected={!!parameters[control.key]} disabled={!sessionReady||busy} onChange={value=>updateParameter(control.key,value)}/>:control.type==='color'?<RayloomColorInput key={control.key} label={control.label} value={typeof parameters[control.key]==='string'?rgb(parameters[control.key]):parameters[control.key]??0xffffff} onChange={color=>updateParameter(control.key,hex(color))}/>:<BoundedNumber key={control.key} label={control.label} min={control.min??0} max={control.max??100} step={control.step??.1} value={Number(parameters[control.key]??control.default??0)} onChange={value=>updateParameter(control.key,value)}/>)}</SimpleGrid></Paper>}
    <Accordion variant="separated" radius="lg"><Accordion.Item value="editor-preferences"><Accordion.Control>Настройки редактора</Accordion.Control><Accordion.Panel><Stack gap="md"><NumberInput label="Размер шрифта кода" min={12} max={22} value={codePreferences.fontSize} onChange={value=>updatePreferences({fontSize:Number(value)})}/><Switch label="Переносить длинные строки" checked={codePreferences.wordWrap} onChange={event=>updatePreferences({wordWrap:event.currentTarget.checked})}/></Stack></Accordion.Panel></Accordion.Item><Accordion.Item value="diagnostics"><Accordion.Control>Статистика эффекта</Accordion.Control><Accordion.Panel><Text size="sm">{Number(runtime.fps??0).toFixed(1)} FPS · {runtime.frames??0} кадров. Снимок предпросмотра обновляется до 5 раз в секунду.</Text></Accordion.Panel></Accordion.Item></Accordion>
    <CanvasAuthorHelp opened={helpOpened} context={helpContext} onClose={closeHelp} onClosed={finishHelpClose} onContext={updateHelp} onTemplate={openExample} onPreview={()=>{setHelpOpened(false);void launch(false);}} onSave={()=>{setHelpOpened(false);save();}} disabled={!sessionReady||busy} canRun={!sourceError&&!!document.source.trim()} canSave={!sourceError&&!!document.name.trim()} diagnostics={currentDiagnostics} runtimeError={runtime.error} onDiagnostic={revealDiagnostic}/>
    {onBack&&<div><Button variant="subtle" color="gray" leftSection={<ArrowLeft size={15}/>} onClick={onBack}>Вернуться к моей подсветке</Button></div>}
  </Stack>;
}
