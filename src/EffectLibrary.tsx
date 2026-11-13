import {useEffect,useMemo,useState} from 'react';
import {Button,Input,SearchField,Tabs} from '@heroui/react';
import {Check,ChevronDown,ChevronUp,Search,Sparkles} from 'lucide-react';
import {BUILTIN_EFFECTS} from '../shared/builtin-effects.mjs';
import {Description} from './types';
import './effect-library.css';
import {EffectPreview,nativePreviewQueue,type PreviewSpec} from './EffectPreview';

type Effect=PreviewSpec&{name:string;description:string};
type Props={value:string;onChange:(value:string)=>void;catalog:Description[];plugins:any[];config:any};
const featured=['aurora','nebula','meteor','ember','prism','tidal'];
const plainDescription=(text:string)=>text.replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

export function EffectLibrary({value,onChange,catalog,plugins,config}:Props){
 const [expanded,setExpanded]=useState(false),[query,setQuery]=useState(''),[category,setCategory]=useState('all'),[active,setActive]=useState('');
 const [reducedMotion,setReducedMotion]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReducedMotion(media.matches),pause=()=>setActive('');media.addEventListener('change',change);window.addEventListener('blur',pause);document.addEventListener('visibilitychange',pause);return()=>{media.removeEventListener('change',change);window.removeEventListener('blur',pause);document.removeEventListener('visibilitychange',pause);};},[]);
 useEffect(()=>{nativePreviewQueue.setActive(active.startsWith('openrgb:')&&!reducedMotion?active.slice(8):active&&!reducedMotion?'local':null);return()=>nativePreviewQueue.setActive(null);},[active,reducedMotion]);
 const effects=useMemo<Effect[]>(()=>[
  ...BUILTIN_EFFECTS.map((effect:{id:string;name:string;description:string})=>({...effect,source:'lumen' as const,preview:effect.id})),
  ...catalog.map(effect=>({id:'openrgb:'+effect.id,name:effect.name||effect.id,description:plainDescription(effect.description??'')||'Алгоритм Effects Plugin',source:'openrgb' as const,nativeId:effect.id,inputKind:effect.category==='Audio'?'audio':undefined})),
  ...plugins.flatMap(plugin=>(plugin.effects??[]).map((effect:any)=>({id:plugin.id+'/'+effect.id,name:effect.name||effect.id,description:effect.description||plugin.name,source:'community' as const,definition:effect}))),
 ],[catalog,plugins]);
 const choose=(id:string)=>{onChange(id);if(expanded){setExpanded(false);requestAnimationFrame(()=>document.querySelector('[data-effect-parameters]')?.scrollIntoView({block:'nearest',behavior:'instant'}));}};
 const filtered=effects.filter(effect=>(category==='all'||effect.source===category)&&[effect.name,effect.description].join(' ').toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
 const selected=effects.find(effect=>effect.id===value);
 const initial=featured.map(id=>effects.find(effect=>effect.id===id)!).filter(Boolean);
 if(selected&&!initial.some(effect=>effect.id===value))initial[initial.length-1]=selected;
 const shown=expanded?filtered:initial;
 useEffect(()=>{if(active&&!shown.some(effect=>effect.id===active))setActive('');},[active,shown]);
 return <div className="effect-library">
  <div className="effect-library-heading"><div><Sparkles size={15}/><span>{selected?'Выбран: '+selected.name:'Выберите эффект'}</span></div><Button size="sm" variant="tertiary" aria-expanded={expanded} onPress={()=>setExpanded(!expanded)}>{expanded?'Свернуть':'Показать все · '+effects.length}{expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</Button></div>
  {expanded&&<div className="effect-library-filters"><SearchField value={query} onChange={setQuery} aria-label="Поиск эффектов"><SearchField.Group><Search size={15}/><Input placeholder="Найти эффект…"/><SearchField.ClearButton/></SearchField.Group></SearchField><Tabs className="rayloom-tabs effect-library-tabs" selectedKey={category} onSelectionChange={key=>setCategory(String(key))}><Tabs.ListContainer><Tabs.List aria-label="Источник эффектов">{[{id:'all',label:'Все'},{id:'lumen',label:'Rayloom'},{id:'openrgb',label:'Effects Plugin'},{id:'community',label:'Сообщество'}].map(tab=><Tabs.Tab key={tab.id} id={tab.id}>{tab.label}<Tabs.Indicator/></Tabs.Tab>)}</Tabs.List></Tabs.ListContainer></Tabs></div>}
  <div className="effect-card-grid" aria-label="Библиотека эффектов">{shown.map(effect=><button type="button" key={effect.id} data-effect={effect.id} className={'effect-card '+(value===effect.id?'is-selected':'')} aria-pressed={value===effect.id} aria-label={effect.name} onClick={()=>choose(effect.id)} onPointerEnter={()=>setActive(effect.id)} onPointerLeave={()=>setActive(current=>current===effect.id?'':current)} onFocus={()=>setActive(effect.id)} onBlur={()=>setActive(current=>current===effect.id?'':current)}><div className="effect-card-visual"><EffectPreview effect={effect} active={active===effect.id} config={config} reducedMotion={reducedMotion} onInactive={()=>setActive(current=>current===effect.id?'':current)}/><span className="effect-card-source">{effect.source==='lumen'?'RAYLOOM':effect.source==='openrgb'?'EFFECTS':'PLUGIN'}</span>{value===effect.id&&<span className="effect-card-check"><Check size={12}/></span>}</div><strong>{effect.name}</strong><small>{effect.description}</small></button>)}</div>
  {expanded&&!shown.length&&<p className="effect-library-empty">По этому запросу эффектов нет. Попробуйте другое название или источник.</p>}
  <p className="effect-library-hint">Наведите курсор или выберите карточку клавишей Tab. Предпросмотр не меняет вашу подсветку.{expanded&&category!=='lumen'?' Аудиоэффекты слушают системный звук при наведении. Для GIF, шейдеров и слоёв нужен свой источник в настройках эффекта.':''}</p>
 </div>;
}
