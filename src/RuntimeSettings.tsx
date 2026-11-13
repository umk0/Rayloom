import {useEffect,useRef,useState} from 'react';
import {Button,Spinner} from '@heroui/react';
import {RayloomDisclosure,RayloomSwitch} from './StudioControls';
import {CheckCircle2,Cpu,Power,MemoryStick,RefreshCw} from 'lucide-react';
import './runtime-settings.css';

type RuntimeState={ready:boolean;changing?:boolean;error?:string;mode:string;settings:{autoStart:boolean;elevatedStartup?:boolean};hardware?:{starting?:boolean;elevated?:boolean;i2cBusCount?:number};memory?:{rss:number};pid?:number;htmlRenderer?:boolean};
const cleanError=(value:unknown)=>String(value instanceof Error?value.message:value).replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^Error:\s*/,'');

export function RuntimeSettings(){
 const windows=window.rayloom.platform==='win32';
 const [runtime,setRuntime]=useState<RuntimeState|null>(null),[loadError,setLoadError]=useState(''),[actionError,setActionError]=useState(''),[pending,setPending]=useState(''),[notice,setNotice]=useState('');
 const mounted=useRef(false),revision=useRef(0),changing=useRef(false),refreshing=useRef(false);
 const refresh=async(required=false)=>{
  if(!required&&(changing.current||refreshing.current))return;
  const token=revision.current;refreshing.current=true;
  try{
   const next=await window.rayloom.studio('runtime.status') as RuntimeState;
   if(mounted.current&&token===revision.current){setRuntime(next);setLoadError('');}
   return next;
  }catch(error){
   if(mounted.current&&token===revision.current)setLoadError(cleanError(error));
   if(required)throw error;
  }finally{refreshing.current=false;}
 };
 useEffect(()=>{mounted.current=true;void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{mounted.current=false;revision.current++;clearInterval(timer);};},[]);
 const apply=async(method:string,args:Record<string,unknown>,label:string,success:string,confirm:(state:RuntimeState)=>boolean)=>{
  if(changing.current)return;
  changing.current=true;revision.current++;setPending(label);setActionError('');setNotice('');
  try{
   await window.rayloom.studio(method,args);revision.current++;
   const confirmed=await refresh(true);
   if(!confirmed?.ready||confirmed.changing)throw Error('Изменение отправлено. Движок ещё проверяет устройства — дождитесь подтверждения состояния.');
   if(!confirm(confirmed))throw Error('Запрос завершён, но новое состояние не подтвердилось. Обновите состояние и повторите настройку.');
   if(mounted.current)setNotice(success);
  }catch(error){if(mounted.current)setActionError(cleanError(error));revision.current++;await refresh(true).catch(()=>{});}
  finally{changing.current=false;if(mounted.current)setPending('');}
 };
 const virtual=runtime?.mode==='virtual',busy=!!pending||runtime?.changing===true;
 const ready=runtime?.ready===true&&!runtime.hardware?.starting;
 const granted=ready&&runtime?.hardware?.elevated===true;
 const accessKnown=ready&&typeof runtime?.hardware?.elevated==='boolean';
 const automatic=runtime?.settings.autoStart===true,savedAccess=automatic&&runtime?.settings.elevatedStartup===true;
 const disabled=!windows||busy||virtual||!ready||!!loadError;
 const saveStartup=(enabled:boolean)=>void apply(enabled&&granted?'runtime.elevate':'runtime.settings',enabled&&granted?{autoStart:true}:{settings:{autoStart:enabled}},enabled?'Включаем автозапуск…':'Выключаем автозапуск…',enabled?'Автозапуск включён. Последняя сцена запустится при входе в Windows.':'Автозапуск выключен. Текущая подсветка продолжает работать.',state=>state.settings.autoStart===enabled&&(!enabled||!granted||state.settings.elevatedStartup===true));
 const allowMemory=(remember:boolean)=>void apply('runtime.elevate',{autoStart:remember},'Подтверждаем доступ к памяти…',remember?'Доступ подтверждён и будет сохраняться при входе в Windows.':'Доступ к памяти подтверждён для текущего запуска.',state=>state.hardware?.elevated===true&&(!remember||(state.settings.autoStart&&state.settings.elevatedStartup===true)));
 return <section className="runtime-settings">
  <div className="section-heading"><div><h2>Фоновая работа</h2><p>Настройте свет один раз. После закрытия окна выбранная сцена продолжит работать.</p></div></div>
  {!!(loadError||actionError)&&<div className="runtime-feedback is-error" role="alert"><p>{actionError||loadError}</p><Button size="sm" variant="secondary" isDisabled={busy} onPress={()=>void refresh()}><RefreshCw size={14}/>Обновить состояние</Button></div>}
  {pending&&<div className="runtime-feedback is-pending" role="status" aria-live="polite"><Spinner aria-label="Изменение настроек"/><div><strong>{pending}</strong><p>Если Windows запросит разрешение, подтвердите его. Затем дождитесь проверки устройств. Повторно нажимать не нужно.</p></div></div>}
  {notice&&!pending&&<div className="runtime-feedback is-success" role="status"><CheckCircle2 size={18}/><p>{notice}</p></div>}
  {!runtime?<div className="runtime-loading" role="status"><Spinner aria-label="Загрузка настроек"/>Проверяем настройки…</div>:<>
   <article className="studio-panel runtime-card"><Cpu size={24}/><div><h2>Работа после закрытия окна</h2><p>Закрывайте редактор крестиком — подсветка и ваши сценарии останутся включены.</p><p className="runtime-state" role="status">{runtime.error?'Движку требуется внимание: '+runtime.error:!ready?'Проверяем устройства и восстанавливаем сцену…':'Фоновый движок готов'}</p></div></article>
   <article className="studio-panel runtime-card"><Power size={24}/><div><h2>Автозапуск</h2><p>{windows?'При входе в Windows запускается последняя сцена. Окно редактора открывать не нужно.':'Настройка запуска при входе в систему пока реализована только для Windows.'}</p><RayloomSwitch selected={windows&&automatic} disabled={disabled} onChange={saveStartup} label={windows?'Запускать подсветку вместе с Windows':'Запускать подсветку при входе в систему'}/><p className="runtime-state">{!windows?'Недоступно на этой платформе.':virtual?'В виртуальной студии автозапуск недоступен.':automatic?(savedAccess?'Включён · с доступом к RGB-памяти':'Включён'): 'Выключен'}</p>{windows&&!virtual&&automatic&&!savedAccess&&<p>Если нужна подсветка оперативной памяти, разрешите доступ ниже.</p>}</div></article>
   <article className="studio-panel runtime-card"><MemoryStick size={24}/><div><h2>Подсветка оперативной памяти</h2><p>{windows?'Для управления памятью Windows может запросить разрешение администратора.':'Мастер выдачи доступа к памяти пока доступен только в Windows.'}</p><p className={'runtime-state '+(granted?'is-confirmed':'')} role="status">{!windows?'Настройка доступа на этой платформе ещё не реализована.':virtual?'Проверка доступна с реальными устройствами.':!accessKnown?'Проверяем доступ…':granted?'Доступ разрешён':'Доступ пока не разрешён'}</p>{windows&&!virtual&&<div className="runtime-actions">
    {!granted&&<Button variant="secondary" isDisabled={disabled||!accessKnown} onPress={()=>allowMemory(automatic)}>Разрешить доступ</Button>}
    {granted&&!savedAccess&&<><p>{automatic?'Доступ есть в текущем запуске. Сохраните его, чтобы память настраивалась при входе в Windows.':'Доступ действует в текущем запуске. Включите автозапуск выше, чтобы сохранить его при входе в Windows.'}</p>{automatic&&<Button variant="secondary" isDisabled={disabled} onPress={()=>allowMemory(true)}>Сохранять доступ при входе</Button>}</>}
    {savedAccess&&<p>Разрешение сохранено для автозапуска. Повторное подтверждение не требуется.</p>}
    {!granted&&<small>{automatic?'Доступ будет также сохранён для включённого автозапуска.':'Это разрешение не включает автозапуск. Настроить его можно отдельно выше.'} При выдаче доступа свет может ненадолго прерваться; затем восстановится последняя сцена.</small>}
   </div>}</div></article>
   <RayloomDisclosure title="Техническая диагностика"><dl className="runtime-diagnostics"><div><dt>Процесс агента</dt><dd>{runtime.pid??'—'}</dd></div><div><dt>Память агента</dt><dd>{runtime.memory?Math.round(runtime.memory.rss/1024/1024)+' МБ':'—'} (нативное ядро учитывается отдельно)</dd></div><div><dt>Права ядра</dt><dd>{accessKnown?(granted?'Администратор':'Обычные'):'Проверяются'}</dd></div><div><dt>Доступные шины</dt><dd>{runtime.hardware?.i2cBusCount??'—'}</dd></div><div><dt>HTML-вычислитель</dt><dd>{runtime.htmlRenderer?'Работает':'Не используется'}</dd></div></dl><p>HTML-эффекты используют отдельный браузерный процесс, который работает после закрытия редактора. Доступ к памяти проверяется ядром; наличие прав само по себе не гарантирует поддержку конкретной модели.</p></RayloomDisclosure>
   <Button variant="secondary" isDisabled={busy} onPress={()=>void window.rayloom.window('quit')}>Полностью завершить Rayloom</Button>
  </>}
 </section>;
}
