import {useEffect,useRef,useState} from 'react';
import {Button,Modal} from '@heroui/react';
import {Check,Lightbulb,Palette,RotateCcw} from 'lucide-react';
import type {Component,Layout} from './studio-types';
import './calibration-wizard.css';

type Calibration={session:string;component:string;name:string;phase:'question'|'review'|'unsupported';step:number;answers:string[];channelOrder:string|null;expiresAt:number};
const choices=[{id:'R',name:'Красный',color:'#f35b69'},{id:'G',name:'Зелёный',color:'#64cf93'},{id:'B',name:'Синий',color:'#6398fa'}];
const errorText=(error:unknown)=>String(error instanceof Error?error.message:error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');

export function CalibrationWizard({component,layout,onClose,onApplied}:{component:Component;layout:Layout;onClose:()=>void;onApplied:(layout:Layout)=>void}){
 const [calibration,setCalibration]=useState<Calibration|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[expired,setExpired]=useState(false);
 const session=useRef<string|null>(null),mounted=useRef(true),working=useRef(false);
 const focusAnchor=useRef<HTMLSpanElement>(null);
 useEffect(()=>{
  if(busy)return;
  const dialog=focusAnchor.current?.closest<HTMLElement>('[role="dialog"]');
  // Advancing a question removes its focused button. Keep keyboard navigation
  // and Escape in this modal instead of leaving focus on document.body.
  if(dialog&&!dialog.contains(document.activeElement))dialog.focus({preventScroll:true});
 },[calibration?.phase,calibration?.step,busy]);
 const update=(next:Calibration|null)=>{session.current=next?.session??null;if(mounted.current)setCalibration(next);};
 const perform=async(action:()=>Promise<void>)=>{if(working.current)return;working.current=true;setBusy(true);setError('');try{await action();}catch(e){if(mounted.current)setError(errorText(e));}finally{working.current=false;if(mounted.current)setBusy(false);}};
 useEffect(()=>{
  mounted.current=true;
  const timer=setInterval(()=>{if(!session.current||working.current)return;const current=session.current;void window.rayloom.studio('calibration.state').then((next:Calibration|null)=>{if(!mounted.current||session.current!==current||working.current)return;if(!next||next.session!==current){update(null);setExpired(true);}else setCalibration(next);}).catch(e=>{if(mounted.current)setError(errorText(e));});},1500);
  return()=>{mounted.current=false;clearInterval(timer);if(session.current)void window.rayloom.studio('calibration.cancel',{session:session.current}).catch(()=>{});};
 },[]);
 const begin=()=>perform(async()=>{
  if(session.current){await window.rayloom.studio('calibration.cancel',{session:session.current});update(null);}
  setExpired(false);
  const next=await window.rayloom.studio('calibration.begin',{component:component.id,layout}) as Calibration|null;
  if(!mounted.current){if(next)await window.rayloom.studio('calibration.cancel',{session:next.session});return;}
  if(!next)throw Error('Проверка прервана другим действием. Начните её ещё раз.');update(next);
 });
 const close=()=>perform(async()=>{if(session.current)await window.rayloom.studio('calibration.cancel',{session:session.current});update(null);onClose();});
 const answer=(color:string)=>perform(async()=>{update(await window.rayloom.studio('calibration.step',{session:session.current,color}));});
 const apply=()=>perform(async()=>{const state=await window.rayloom.studio('calibration.apply',{session:session.current});update(null);onApplied(state.layout);onClose();});
 return <Modal isOpen onOpenChange={open=>{if(!open)void close();}}><Modal.Backdrop isDismissable={!busy}><Modal.Container size="md" placement="center"><Modal.Dialog className="calibration-wizard"><span ref={focusAnchor} hidden/>
  <Modal.Header><div className="calibration-wizard-icon"><Palette size={23}/></div><Modal.Heading>Настроим цвета</Modal.Heading><p>{component.name}</p></Modal.Header>
  <Modal.Body>
   {error&&<p className="calibration-error" role="alert">{error}</p>}
   {expired&&<p className="calibration-notice" role="status">Проверка завершена. Предыдущее освещение восстановлено, коррекция не сохранена. Можно начать заново.</p>}
   {!calibration?<><p>Три коротких вопроса помогут правильно передавать красный, зелёный и синий на этот порт.</p><div className="calibration-isolation"><Lightbulb size={21}/><div><strong>Смотреть нужно только на выбранный порт</strong><p>На время проверки остальные устройства погаснут. После сохранения или отмены вернётся прежняя подсветка.</p></div></div><p className="calibration-hint">Мы определим порядок цветовых каналов. Модель устройства и количество диодов останутся прежними.</p></>:calibration.phase==='question'?<>
    <div className="calibration-progress" aria-label={'Вопрос '+(calibration.step+1)+' из 3'}>{[0,1,2].map(i=><span key={i} data-complete={i<calibration.step} data-current={i===calibration.step}>{i<calibration.step?<Check size={14}/>:i+1}</span>)}<small>Вопрос {calibration.step+1} из 3</small></div>
    <h3>Какой цвет сейчас горит?</h3><p>Посмотрите на «{calibration.name}» и выберите цвет, который видите.</p>
    <div className="calibration-choice-grid">{choices.map(choice=><Button key={choice.id} variant="secondary" className="calibration-choice" isDisabled={busy} onPress={()=>void answer(choice.id)}><i style={{background:choice.color}}/>{choice.name}</Button>)}</div>
    <div className="calibration-other-choices"><Button variant="tertiary" size="sm" isDisabled={busy} onPress={()=>void answer('dark')}>Не горит</Button><Button variant="tertiary" size="sm" isDisabled={busy} onPress={()=>void answer('mixed')}>Другой или смешанный</Button></div>
   </>:calibration.phase==='review'?<><div className="calibration-review-swatch"/><h3>Теперь должен гореть красный</h3><p>Мы подобрали коррекцию по вашим ответам. Если порт светится красным, сохраните её. Если нет — повторите проверку.</p><div className="calibration-result"><span>Порядок каналов</span><strong>{calibration.channelOrder}</strong></div><p className="calibration-hint">Сохранятся коррекция этого порта и текущие изменения пространства. Затем возобновится выбранный эффект.</p></>:<><h3>Нужна дополнительная проверка</h3><p>Обычная RGB-коррекция подходит, когда каждый канал даёт один основной цвет. Если порт не горит или цвета смешаны, проверьте питание, подключение и тип устройства на порту.</p><p className="calibration-hint">Настройки цветов пока не изменены. Можно повторить вопросы или вернуться к устройству.</p></>}
  </Modal.Body>
  <Modal.Footer><Button variant="tertiary" isDisabled={busy} onPress={()=>void close()}>{calibration?'Отменить и вернуть подсветку':'Закрыть'}</Button>{!calibration?<Button isDisabled={busy} onPress={()=>void begin()}>{busy?'Подготавливаем…':'Начать проверку'}</Button>:calibration.phase==='question'?<span className="calibration-hint">Выберите цвет выше</span>:<><Button variant="secondary" isDisabled={busy} onPress={()=>void begin()}><RotateCcw size={14}/>Повторить</Button>{calibration.phase==='review'&&<Button isDisabled={busy} onPress={()=>void apply()}><Check size={14}/>Да, сохранить</Button>}</>}</Modal.Footer>
 </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
