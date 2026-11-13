import {Button,ColorArea,ColorField,ColorPicker,ColorSlider,ColorSwatch,Label,Popover} from '@heroui/react';
import {ChevronDown,Plus,Trash2} from 'lucide-react';
import {RayloomDisclosure,RayloomSelect,RayloomSlider,RayloomSwitch} from './StudioControls';
import {getEffectParameterSchema,readEffectParameter,updateEffectParameter} from '../shared/effect-parameters.mjs';
import {hex,rgb,type Description} from './types';
import './effect-parameters.css';

type Control={key:string;label:string;type:string;binding:string;default:any;help?:string;min?:number;max?:number;step?:number;suffix?:string;advanced?:boolean;minItems?:number;maxItems?:number;options?:{label:string;value:number|string}[]};
function ParameterColor({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){
 return <div className="studio-color-field"><span>{label}</span><ColorPicker value={hex(value)} onChange={color=>onChange(rgb(color.toString('hex')))}><ColorPicker.Trigger aria-label={'Выбрать: '+label} className="studio-color-trigger"><ColorSwatch/><span>{hex(value).toUpperCase()}</span><ChevronDown size={13}/></ColorPicker.Trigger><ColorPicker.Popover className="studio-color-popover"><Popover.Dialog aria-label={label}><h3>{label}</h3><ColorArea colorSpace="hsb" xChannel="saturation" yChannel="brightness" aria-label="Насыщенность и яркость"><ColorArea.Thumb/></ColorArea><ColorSlider colorSpace="hsb" channel="hue" aria-label="Цветовой тон"><ColorSlider.Track><ColorSlider.Thumb/></ColorSlider.Track></ColorSlider><ColorField colorSpace="rgb"><Label>HEX</Label><ColorField.Group><ColorField.Input aria-label={'HEX: '+label}/></ColorField.Group></ColorField><Button slot="close" variant="secondary" fullWidth style={{marginTop:16}}>Готово</Button></Popover.Dialog></ColorPicker.Popover></ColorPicker></div>;
}

function ParameterControl({control,value,onChange}:{control:Control;value:any;onChange:(value:any)=>void}){
 const d=control;
 if(d.type==='number')return <div className="effect-parameter"><RayloomSlider label={d.label} value={value} min={d.min} max={d.max} step={d.step??1} suffix={d.suffix??''} onChange={onChange}/>{d.help&&<small>{d.help}</small>}</div>;
 if(d.type==='boolean')return <div className="effect-parameter"><RayloomSwitch label={d.label} selected={value} onChange={onChange}/>{d.help&&<small>{d.help}</small>}</div>;
 if(d.type==='color')return <ParameterColor label={d.label} value={value} onChange={onChange}/>;
 if(d.type==='select')return <div className="effect-parameter"><RayloomSelect label={d.label} value={String(value)} onChange={next=>onChange(d.options?.find(o=>String(o.value)===next)?.value)} options={(d.options??[]).map(o=>({label:o.label,value:String(o.value)}))}/>{d.help&&<small>{d.help}</small>}</div>;
 if(d.type==='palette')return <fieldset className="effect-parameter-palette"><legend>{d.label}</legend><div className="effect-palette-colors">{value.map((color:number,index:number)=><div className="effect-palette-entry" key={index}><ParameterColor label={'Цвет '+(index+1)} value={color} onChange={next=>onChange(value.map((c:number,i:number)=>i===index?next:c))}/>{value.length>(d.minItems??1)&&<Button size="sm" variant="tertiary" aria-label={'Удалить цвет '+(index+1)} onPress={()=>onChange(value.filter((_:number,i:number)=>i!==index))}><Trash2 size={14}/></Button>}</div>)}</div>{value.length<(d.maxItems??256)&&<Button size="sm" variant="secondary" onPress={()=>onChange([...value,0xffffff])}><Plus size={14}/>Добавить цвет</Button>}</fieldset>;
 return null;
}

export function EffectParameters({effectId,config,catalog,plugins,onChange,onAdvanced}:{effectId:string;config:any;catalog:Description[];plugins:any[];onChange:(next:any)=>void;onAdvanced?:()=>void}){
 const schema=getEffectParameterSchema(effectId,{catalog,plugins});
 const controls=schema.controls as Control[],main=controls.filter(d=>!d.advanced),advanced=controls.filter(d=>d.advanced);
 const render=(d:Control)=><ParameterControl key={effectId+':'+d.binding+':'+d.key} control={d} value={readEffectParameter(d,config,effectId)} onChange={value=>onChange(updateEffectParameter(config,effectId,d,value))}/>;
 return <section className="effect-parameters" aria-label={'Настройки эффекта '+schema.name} data-effect-parameters={effectId}>
  <div className="effect-parameters-heading"><h3>Настройки · {schema.name}</h3><span>Только для этого эффекта</span></div>
  {schema.loading?<p>Загружаем настройки эффекта…</p>:schema.unavailable?<p>Этот эффект сейчас недоступен. Выберите другой в библиотеке.</p>:<>
   {schema.fixedPalette&&<p className="effect-parameter-note">У этого эффекта своя палитра.</p>}
   {!controls.length&&!schema.hasAdvancedOnly&&<p className="effect-parameter-note">Дополнительных параметров нет. Общая яркость регулируется сверху.</p>}
   {main.length>0&&<div className="effect-parameters-grid">{main.map(render)}</div>}
   {(advanced.length>0||schema.hasAdvancedOnly)&&<RayloomDisclosure title="Дополнительные параметры эффекта"><div className="effect-parameters-grid">{advanced.map(render)}</div>{schema.hasAdvancedOnly&&<div className="effect-parameter-extra"><p>GIF, шейдеры и слои настраиваются в отдельной сцене расширенного редактора.</p>{onAdvanced&&<Button variant="secondary" onPress={onAdvanced}>Расширенная библиотека</Button>}</div>}</RayloomDisclosure>}
  </>}
 </section>;
}
