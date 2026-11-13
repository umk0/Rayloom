import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Checkbox,Group,Modal,ScrollArea,Text,TextInput,UnstyledButton} from '@mantine/core';
import {Check,Layers3,Plus,Save,Trash2} from 'lucide-react';
import {Layout} from '../studio-types';
import {clearGroupDraft,freshGroupDraft,groupDraftChanged,groupDraftConflict,restoreGroupDraft,writeGroupDraft,type GroupDraft} from './group-draft';
import './spatial.css';

export function GroupsPanel({layout,onChange,onSave,onRemove,activeGroup,onActivate,busy,draftScope='hardware'}:{layout:Layout;onChange:(layout:Layout)=>void;onSave:()=>Promise<void>;onRemove:(id:string)=>Promise<void>;activeGroup:string;onActivate:(id:string)=>void;busy:boolean;draftScope?:string}){
 const [initial]=useState(()=>restoreGroupDraft(draftScope,layout,activeGroup));
 const [editing,setEditing]=useState(initial.draft.editing),[name,setName]=useState(initial.draft.name),[members,setMembers]=useState(initial.draft.members),[message,setMessage]=useState(''),[saving,setSaving]=useState(false),[conflict,setConflict]=useState(initial.conflict);
 type Destination={kind:'edit'|'activate';id:string};
 const [destination,setDestination]=useState<Destination|null>(null);
 const working=useRef(false),latest=useRef(layout),draft=useRef(initial.draft),mounted=useRef(true),scope=useRef(draftScope);latest.current=layout;
 const blocked=busy||saving;
 const changed=groupDraftChanged(draft.current);
 const publish=(next:Layout)=>{latest.current=next;onChange(next);};
 const show=(next:GroupDraft)=>{draft.current=next;setEditing(next.editing);setName(next.name);setMembers(next.members);};
 const remember=(patch:Partial<GroupDraft>)=>{const next=writeGroupDraft(scope.current,{...draft.current,...patch});show(next);return next;};
 const load=(id:string)=>{clearGroupDraft(scope.current,draft.current.revision);show(freshGroupDraft(latest.current,id));setMessage('');setConflict(false);};
 const navigate=(next:Destination)=>{clearGroupDraft(scope.current,draft.current.revision);setDestination(null);if(next.kind==='edit')load(next.id);else onActivate(next.id);};
 const requestNavigate=(next:Destination)=>{if(working.current||busy)return;if(changed)setDestination(next);else navigate(next);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(scope.current!==draftScope){scope.current=draftScope;const restored=restoreGroupDraft(draftScope,layout,activeGroup);show(restored.draft);setConflict(restored.conflict);setDestination(null);setMessage('');}else if(!working.current){if(draft.current.revision)setConflict(groupDraftConflict(draft.current,layout));else show(freshGroupDraft(layout,draft.current.editing));}},[draftScope,layout.groups,layout.components,saving]);
 const save=async(activate=false)=>{
  if(working.current||busy)return false;
  if(conflict||groupDraftConflict(draft.current,latest.current)){setConflict(true);setMessage('Сначала выберите, какую версию группы сохранить.');return false;}
  if(!name.trim()){setMessage('Назовите группу, например «Корпус» или «Передние вентиляторы».');return false;}
  const validMembers=[...new Set(members)].filter(id=>latest.current.components.some(c=>c.id===id));
  if(!validMembers.length){setMessage('Отметьте хотя бы одно устройство или порт.');return false;}
  working.current=true;setSaving(true);setMessage('');
  const id=editing==='new'?'group-'+crypto.randomUUID():editing,group={id,name:name.trim().slice(0,120),members:validMembers};
  // Keep this identity even if persistence fails: retry updates the same draft.
  const pending=remember({editing:id,name:group.name,members:validMembers,baseline:group}),pendingScope=scope.current;
  const next=latest.current;publish({...next,groups:next.groups.some(g=>g.id===id)?next.groups.map(g=>g.id===id?group:g):[...next.groups,group]});
  try{await onSave();clearGroupDraft(pendingScope,pending.revision);if(mounted.current&&scope.current===pendingScope){if(draft.current.revision===pending.revision)show({...pending,baseline:group,revision:0});setMessage('Группа сохранена. Теперь выберите её для эффекта.');if(activate)onActivate(id);}return true;}
  catch(error){if(mounted.current&&scope.current===pendingScope)setMessage('Не удалось сохранить группу. Черновик сохранён в редакторе; попробуйте ещё раз. '+String(error));return false;}
  finally{working.current=false;if(mounted.current)setSaving(false);}
 };
 const remove=async()=>{
  if(working.current||busy)return;const removed=latest.current.groups.find(g=>g.id===editing);if(!removed)return;
  const pending=remember({}),pendingScope=scope.current;
  working.current=true;setSaving(true);setMessage('');
  try{await onRemove(removed.id);clearGroupDraft(pendingScope,pending.revision);if(mounted.current&&scope.current===pendingScope)load('new');}
  catch(error){if(mounted.current&&scope.current===pendingScope)setMessage('Не удалось удалить группу. Черновик и настройки сохранены. '+String(error));}
  finally{working.current=false;if(mounted.current)setSaving(false);}
 };

 return <><Modal opened={destination!==null} onClose={()=>{if(!working.current)setDestination(null);}} closeOnEscape={!saving} closeOnClickOutside={!saving} closeButtonProps={{disabled:saving}} title="Сохранить изменения группы?" centered classNames={{root:'rayloom'}}><Text size="sm" mb="lg">Название или состав группы изменены. Сохраните их перед переходом или оставьте прежний вариант.</Text>{message&&<Text role="status" size="sm" mb="md">{message}</Text>}<Group justify="flex-end"><Button variant="subtle" disabled={blocked} onClick={()=>setDestination(null)}>Остаться</Button><Button variant="default" disabled={blocked} onClick={()=>{if(destination)navigate(destination);}}>Не сохранять и перейти</Button><Button disabled={blocked} onClick={()=>{const next=destination,pendingScope=scope.current;if(next)void save().then(saved=>{if(saved&&mounted.current&&scope.current===pendingScope)navigate(next);});}}>Сохранить и перейти</Button></Group></Modal><div className="groups-workspace">
  <aside className="group-library" aria-label="Ваши группы">
   <div className="section-heading-plain"><h2>Ваши группы</h2><Button size="sm" variant="subtle" disabled={blocked} aria-label="Новая группа" onClick={()=>requestNavigate({kind:'edit',id:'new'})}><Plus size={17}/></Button></div>
   <UnstyledButton className="group-tile all-group" disabled={blocked} onClick={()=>requestNavigate({kind:'activate',id:'all'})}><Layers3 size={20}/><span><strong>Всё пространство</strong><small>Все включённые компоненты</small></span>{activeGroup==='all'&&<Check size={16}/>}</UnstyledButton>
   {layout.groups.filter(g=>g.id!=='all').map(g=><UnstyledButton key={g.id} className={'group-tile '+(editing===g.id?'selected':'')} disabled={blocked} aria-pressed={editing===g.id} onClick={()=>requestNavigate({kind:'edit',id:g.id})}><Layers3 size={20}/><span><strong>{g.name}</strong><small>{g.members.length} компонентов</small></span>{activeGroup===g.id&&<Check size={16}/>}</UnstyledButton>)}
   {layout.groups.filter(g=>g.id!=='all').length===0&&<p>Объедините порты или устройства, чтобы включать им один эффект.</p>}
  </aside>
  <section className="group-editor">
   <p className="studio-kicker">{editing==='new'?'НОВАЯ ГРУППА':'ГРУППА'}</p><h2>{editing==='new'?'Что будет светиться вместе?':name||'Название группы'}</h2>
   {conflict&&<Alert color="yellow" title="Группа изменилась вне редактора"><Text size="sm" mb="md">Ваш черновик сохранён. Выберите сохранённую версию или продолжите свой вариант; недоступные порты будут исключены из выбора.</Text><Group><Button variant="default" disabled={blocked} onClick={()=>load(editing)}>Загрузить сохранённую версию</Button><Button variant="light" disabled={blocked} onClick={()=>{remember({baseline:latest.current.groups.find(g=>g.id===editing)??null,members:draft.current.members.filter(id=>latest.current.components.some(c=>c.id===id))});setConflict(false);setMessage('');}}>Оставить мой черновик</Button></Group></Alert>}
   <TextInput label="1. Название группы" aria-label="Название группы" disabled={blocked} maxLength={120} placeholder="Например, передние вентиляторы" value={name} onChange={e=>{remember({name:e.currentTarget.value});setMessage('');}}/>
   <div className="section-heading-plain"><h3>2. Устройства и порты</h3><span>{members.length} выбрано</span></div>
   <div className="studio-actions compact"><Button variant="subtle" size="compact-sm" disabled={blocked} onClick={()=>remember({members:layout.components.map(c=>c.id)})}>Выбрать всё</Button><Button variant="subtle" size="compact-sm" disabled={blocked} onClick={()=>remember({members:[]})}>Снять выбор</Button></div>
   <ScrollArea className="group-member-scroll" type="auto" scrollbarSize={6}>
    {layout.components.map(c=><Checkbox className={'group-member-choice '+(members.includes(c.id)?'selected':'')} key={c.id} disabled={blocked} aria-label={'Добавить в группу: '+c.name} checked={members.includes(c.id)} onChange={event=>{const checked=event.currentTarget.checked;remember({members:checked?[...new Set([...draft.current.members,c.id])]:draft.current.members.filter(id=>id!==c.id)});}} label={<span><strong>{c.name}</strong><small>{c.points.length} LED · {c.device.name}</small></span>}/>)}
    {!layout.components.length&&<p className="spatial-list-empty">Добавьте устройства, чтобы объединить их в группу.</p>}
   </ScrollArea>
   {message&&<p role="status" className="group-message">{message}</p>}
   <div className="studio-actions"><Button disabled={blocked} onClick={()=>void save()} leftSection={<Save size={15}/>}>Сохранить группу</Button>
    {editing!=='new'&&<><Button variant="light" disabled={blocked} onClick={()=>void save(true)}>Назначить эффект</Button><Button variant="subtle" color="red" disabled={blocked} aria-label="Удалить группу" onClick={()=>void remove()}><Trash2 size={16}/></Button></>}
   </div>
   <p className="studio-source">Устройство может входить в несколько групп. Выбранный эффект играет на одной группе за раз.</p>
  </section>
 </div></>;
}
