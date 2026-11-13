import {Minus,Square,X,PanelBottomClose} from 'lucide-react';
import './window-titlebar.css';

export function WindowTitlebar({title}:{title:string}){
 const mac=window.rayloom.platform==='darwin';
 const act=(action:string)=>void window.rayloom.window(action).catch(()=>{});
 const close=<button className="close-window" aria-label="Закрыть редактор, оставить подсветку" title="Закрыть редактор — подсветка продолжит работать" onClick={()=>act('close')}><X size={14}/></button>;
 const minimize=<button className="minimize-window" aria-label="Свернуть окно" onClick={()=>act('minimize')}><Minus size={16}/></button>;
 const maximize=<button className="maximize-window" aria-label="Развернуть или восстановить окно" onClick={()=>{if(mac)void window.rayloom.window('state').then(s=>act(s.fullscreen?'fullscreen-exit':'fullscreen-enter'));else act('maximize');}}><Square size={12}/></button>;
 return <div className={'titlebar rayloom-titlebar'+(mac?' platform-mac':'')}><div className="titlebar-brand">{title}</div><div className="window-controls">{mac?<>{close}{minimize}{maximize}</>:<><button aria-label="Скрыть в трей" title="Скрыть в трей" onClick={()=>act('hide')}><PanelBottomClose size={14}/></button>{minimize}{maximize}{close}</>}</div></div>;
}
