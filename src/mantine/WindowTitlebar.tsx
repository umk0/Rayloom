import {useEffect,useRef,useState} from 'react';
import {ActionIcon,Group,Tooltip} from '@mantine/core';
import {Copy,Minus,Square,X,PanelBottomClose} from 'lucide-react';
import {cleanPanelError} from '../../shared/panel-session.mjs';

export function WindowTitlebar({onError}:{onError?:(message:string)=>void}){
 const mac=window.rayloom.platform==='darwin';
 const [pending,setPending]=useState(false),[expanded,setExpanded]=useState(false);
 const mounted=useRef(true),working=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const act=async(action:string)=>{
  if(working.current)return;working.current=true;setPending(true);
  try{
   const target=mac&&action==='maximize'?(await window.rayloom.window('state')).fullscreen?'fullscreen-exit':'fullscreen-enter':action;
   const state=await window.rayloom.window(target);if(mounted.current)setExpanded(mac?state.fullscreen:state.maximized);
  }catch(error){if(mounted.current)onError?.(cleanPanelError(error));}
  finally{working.current=false;if(mounted.current)setPending(false);}
 };
 const control=(action:string,label:string,icon:React.ReactNode,close=false)=><Tooltip key={action} label={label} openDelay={650}><ActionIcon variant="subtle" color="gray" disabled={pending} className={close?'window-close':undefined} aria-label={label} onClick={()=>void act(action)}>{icon}</ActionIcon></Tooltip>;
 const close=control('close','Закрыть редактор, оставить подсветку',<X size={16}/>,true);
 const minimize=control('minimize','Свернуть окно',<Minus size={16}/>);
 const maximize=control('maximize','Развернуть или восстановить окно',expanded?<Copy size={13}/>:<Square size={13}/>);
 return <header className={'ray-window-bar'+(mac?' platform-mac':'')}><div className="window-drag"/><Group gap={4} className="window-controls">{mac?<>{close}{minimize}{maximize}</>:<>{control('hide','Скрыть в трей',<PanelBottomClose size={15}/>)}{minimize}{maximize}{close}</>}</Group></header>;
}
