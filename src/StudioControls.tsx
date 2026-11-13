import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Accordion,ColorArea,ColorField,ColorPicker,ColorSlider,ColorSwatch,Label,ListBox,Select,Switch,Slider} from '@heroui/react';
import {ChevronDown} from 'lucide-react';
import {hex,rgb} from './types';
import './studio-controls.css';

type SelectOption={value:string;label:string;description?:string;disabled?:boolean};
export function RayloomSelect({label,ariaLabel,value,onChange,options,disabled=false,placeholder='Выберите…',className=''}:{label?:string;ariaLabel?:string;value:string;onChange:(value:string)=>void;options:SelectOption[];disabled?:boolean;placeholder?:string;className?:string}){
 return <Select className={'rayloom-select '+className} aria-label={ariaLabel??label} value={value||null} onChange={next=>{if(next!==null)onChange(String(next));}} isDisabled={disabled} placeholder={placeholder} variant="secondary">
  {label&&<Label>{label}</Label>}<Select.Trigger><Select.Value/><Select.Indicator/></Select.Trigger><Select.Popover className="rayloom-select-popover"><ListBox>{options.map(option=><ListBox.Item key={option.value} id={option.value} textValue={option.label} isDisabled={option.disabled}><div><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</div><ListBox.ItemIndicator/></ListBox.Item>)}</ListBox></Select.Popover>
 </Select>;
}
export function RayloomSwitch({label,selected,onChange,disabled=false}:{label:string;selected:boolean;onChange:(value:boolean)=>void;disabled?:boolean}){
 return <Switch className="rayloom-switch" aria-label={label} isSelected={selected} onChange={onChange} isDisabled={disabled}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control><Label>{label}</Label></Switch.Content></Switch>;
}
export function RayloomSlider({label,value,onChange,min=0,max=100,step=1,suffix=''}:{label:string;value:number;onChange:(value:number)=>void;min?:number;max?:number;step?:number;suffix?:string}){
 return <Slider className="rayloom-slider" aria-label={label} value={value} minValue={min} maxValue={max} step={step} onChange={v=>onChange(Array.isArray(v)?v[0]:v)}><div className="rayloom-slider-heading"><Label>{label}</Label><Slider.Output>{()=>value+suffix}</Slider.Output></div><Slider.Track><Slider.Fill/><Slider.Thumb/></Slider.Track></Slider>;
}

export function BoundedNumber({label,value,onChange,min,max,step=1,hint}:{label:string;value:number;onChange:(value:number)=>void;min:number;max:number;step?:number;hint?:string}){
 const [draft,setDraft]=useState(String(value)),[adjusted,setAdjusted]=useState(false);const id=useId(),skipBlur=useRef(false);
 useEffect(()=>setDraft(String(value)),[value]);
 const commit=()=>{if(skipBlur.current){skipBlur.current=false;return;}const entered=draft.trim()===''?value:Number(draft.replace(',','.'));const finite=Number.isFinite(entered)?entered:value;const next=Math.max(min,Math.min(max,finite));const precision=step<1?Math.min(4,(String(step).split('.')[1]??'').length):0;const rounded=Number(next.toFixed(precision));setAdjusted(entered!==rounded||!Number.isFinite(entered));setDraft(String(rounded));onChange(rounded);};
 return <label className="bounded-number" htmlFor={id}><span>{label}</span><input id={id} aria-describedby={id+'-hint'} type="text" inputMode="decimal" role="spinbutton" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} value={draft} onChange={e=>{setDraft(e.target.value);setAdjusted(false);}} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.currentTarget.blur();}else if(e.key==='Escape'){e.stopPropagation();skipBlur.current=true;setDraft(String(value));setAdjusted(false);e.currentTarget.blur();}else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const next=Math.max(min,Math.min(max,value+(e.key==='ArrowUp'?step:-step)));setDraft(String(next));onChange(Number(next.toFixed(4)));}}}/><small id={id+'-hint'} className={adjusted?'field-adjusted':''}>{adjusted?'Значение приведено к допустимому диапазону':hint??`${min}–${max}`}</small></label>;
}

export function StudioColorPicker({value,onChange}:{value:number;onChange:(color:number)=>void}){
 const text=hex(value);
 return <div className="studio-color-field"><span>Цвет эффекта</span><ColorPicker value={text} onChange={color=>onChange(rgb(color.toString('hex')))}><ColorPicker.Trigger aria-label="Выбрать цвет эффекта" className="studio-color-trigger"><ColorSwatch/><span>{text.toUpperCase()}</span><ChevronDown size={13}/></ColorPicker.Trigger><ColorPicker.Popover className="studio-color-popover"><div role="dialog" aria-label="Выбор цвета эффекта" tabIndex={-1}><h3>Цвет эффекта</h3><ColorArea colorSpace="hsb" xChannel="saturation" yChannel="brightness" aria-label="Насыщенность и яркость"><ColorArea.Thumb/></ColorArea><ColorSlider colorSpace="hsb" channel="hue" aria-label="Цветовой тон"><ColorSlider.Track><ColorSlider.Thumb/></ColorSlider.Track></ColorSlider><ColorField colorSpace="rgb"><Label>HEX</Label><ColorField.Group><ColorField.Input aria-label="HEX цвета эффекта"/></ColorField.Group></ColorField><div className="studio-color-presets">{['#ff595e','#ffad5a','#e8ed75','#b4f17b','#65d5d2','#7ba7ff','#c198ee','#ffffff'].map(c=><button key={c} type="button" aria-label={'Цвет '+c} style={{background:c}} onClick={()=>onChange(rgb(c))}/>)}</div></div></ColorPicker.Popover></ColorPicker></div>;
}

export function RayloomDisclosure({title,children,defaultExpanded=false,className='',onExpandedChange}:{title:string;children:ReactNode;defaultExpanded?:boolean;className?:string;onExpandedChange?:(expanded:boolean)=>void}){
 return <Accordion className={'rayloom-disclosure '+className} defaultExpandedKeys={defaultExpanded?['content']:[]} onExpandedChange={keys=>onExpandedChange?.(keys.size>0)}><Accordion.Item id="content"><Accordion.Heading><Accordion.Trigger>{title}<Accordion.Indicator/></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body>{children}</Accordion.Body></Accordion.Panel></Accordion.Item></Accordion>;
}
