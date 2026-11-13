import {useState,type CSSProperties} from 'react';
import {Accordion,Button,Input,Label,TextField} from '@heroui/react';
import {ArrowLeft,Layers3,Lightbulb,Palette,RotateCcw,Save} from 'lucide-react';
import {Component,Layout} from './studio-types';
import {Device} from './types';
import {BoundedNumber,RayloomSelect,RayloomSwitch} from './StudioControls';
import {MatrixEditor} from './MatrixEditor';
import {CalibrationWizard} from './CalibrationWizard';
import './port-inspector.css';

type Props={component:Component;device?:Device;layout:Layout;onCalibrationApplied:(layout:Layout)=>void;onChange:(c:Component)=>void;onGroupsChange?:(groups:Layout['groups'])=>void;onSplit:(c:Component)=>void;onBack:()=>void;onIdentify:(led?:number,color?:number)=>Promise<void>;onSaveTemplate:()=>Promise<void>;templates:any[];run:(fn:()=>Promise<any>,message?:string)=>Promise<void>;busy:boolean};

export function PortInspector({component,device,layout,onCalibrationApplied,onChange,onGroupsChange,onSplit,onBack,onIdentify,onSaveTemplate,templates,run,busy}:Props){
 const [calibrating,setCalibrating]=useState(false);
 const sourceZone=device?.zones?.find(z=>z.index===component.zone),calibration=component.calibration??{channelOrder:'RGB',brightness:100};
 const groups=layout.groups.filter(group=>group.id!=='all');
 return <div className="port-inspector">
  {calibrating&&<CalibrationWizard component={component} layout={layout} onClose={()=>setCalibrating(false)} onApplied={onCalibrationApplied}/>}
  <section className="port-identity" aria-label="Выбранный компонент">
   <Button className="port-back" variant="tertiary" size="sm" onPress={onBack}><ArrowLeft size={14}/>Все устройства и порты</Button>
   <TextField className="port-name-field" value={component.name} onChange={name=>onChange({...component,name})}>
    <Label>Название компонента</Label><Input maxLength={120} placeholder="Передние вентиляторы"/>
   </TextField>
   <p className="port-source">{component.device.name}<span>{sourceZone?.name??'Зона '+(component.zone+1)} · {component.points.length} LED</span></p>
   <div className={'port-connection '+(device?'is-connected':'')}><i/>{device?'Подключён':'Сейчас не подключён'}</div>
  </section>

  <section className="port-identify-section" aria-label="Определение и калибровка">
   <Button className="identify-port-button" variant="secondary" isDisabled={busy||!device} onPress={()=>void run(()=>onIdentify(),'Порт определён: три красных импульса. Предыдущее освещение восстановлено.')}><Lightbulb size={16}/>Какой это порт?</Button>
   <p>{device?'Остальные устройства погаснут. Этот порт мигнёт трижды, затем подсветка восстановится.':'Название, расположение и матрицу можно редактировать. Для проверки цвета подключите устройство.'}</p>
   <Button variant="secondary" isDisabled={busy||!device} onPress={()=>setCalibrating(true)}><Palette size={16}/>Калибровать цвета</Button>
   <p>Цвета перепутаны? Три вопроса помогут подобрать коррекцию.</p>
  </section>

  <section className="port-participation" aria-label="Участие в пространстве">
   <RayloomSwitch label="Участвует в подсветке" selected={component.enabled} onChange={enabled=>onChange({...component,enabled})}/>
   <p>{component.enabled?'Компонент отображается на схеме, когда устройство подключено.':'Компонент скрыт со схемы. Все настройки сохранены — его можно включить снова.'}</p>
   <BoundedNumber label="Яркость этого компонента" min={0} max={100} value={calibration.brightness} hint="Проценты от общей яркости" onChange={brightness=>onChange({...component,calibration:{...calibration,brightness}})}/>
  </section>

  <section className="port-position" aria-label="Положение компонента">
   <div className="section-heading-plain"><h3>Положение</h3><Button size="sm" variant="tertiary" onPress={()=>onChange({...component,pose:{...component.pose,x:0,y:0,z:0}})}>В центр</Button></div>
   <div className="studio-fields">{(['x','y'] as const).map(key=><BoundedNumber key={key} label={'Положение '+key.toUpperCase()} min={-100000} max={100000} step={.1} value={component.pose[key]} hint="Миллиметры" onChange={value=>onChange({...component,pose:{...component.pose,[key]:value}})}/>)}</div>
   <BoundedNumber label="Поворот на плоскости" min={-360} max={360} value={component.pose.rz} hint="Градусы · поворот Z" onChange={rz=>onChange({...component,pose:{...component.pose,rz}})}/>
   <Button className="spatial-reset-pose" size="sm" variant="tertiary" onPress={()=>onChange({...component,pose:{...component.pose,x:0,y:0,z:0,rx:0,ry:0,rz:0}})}><RotateCcw size={14}/>Вернуть в начало пространства</Button>
  </section>

  <Accordion className="port-accordion" allowsMultipleExpanded>
   <Accordion.Item id="depth" className="port-advanced"><Accordion.Heading><Accordion.Trigger>Глубина и наклон в 3D<Accordion.Indicator/></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body>
    <p>Глубина и наклон сохраняются и в режиме 2D.</p>
    <BoundedNumber label="Положение Z" min={-100000} max={100000} step={.1} value={component.pose.z} hint="Миллиметры · глубина" onChange={z=>onChange({...component,pose:{...component.pose,z}})}/>
    <div className="studio-fields">{(['rx','ry'] as const).map(key=><BoundedNumber key={key} label={'Наклон '+key.slice(1).toUpperCase()} min={-360} max={360} value={component.pose[key]} hint="Градусы" onChange={value=>onChange({...component,pose:{...component.pose,[key]:value}})}/>)}</div>
    <BoundedNumber label="Масштаб компонента" min={.01} max={100} step={.01} value={component.pose.scale} hint="1 — исходный размер" onChange={scale=>onChange({...component,pose:{...component.pose,scale}})}/>
   </Accordion.Body></Accordion.Panel></Accordion.Item>

   <Accordion.Item id="groups" className="port-groups"><Accordion.Heading><Accordion.Trigger><span><Layers3 size={15}/>Группы компонента</span><Accordion.Indicator/></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body>
    <p>Компонент может входить в несколько групп. «Всё пространство» включает все включённые компоненты.</p>
    {groups.length?groups.map(group=><RayloomSwitch key={group.id} label={group.name} selected={group.members.includes(component.id)} disabled={!onGroupsChange} onChange={included=>onGroupsChange?.(layout.groups.map(current=>current.id===group.id?{...current,members:included?[...new Set([...current.members,component.id])]:current.members.filter(id=>id!==component.id)}:current))}/>):<p className="port-empty-hint">Создайте группу в разделе «Группы». Здесь появится возможность включить в неё этот компонент.</p>}
   </Accordion.Body></Accordion.Panel></Accordion.Item>

   <Accordion.Item id="calibration" className="port-calibration"><Accordion.Heading><Accordion.Trigger>Ручная коррекция цветов<Accordion.Indicator/></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body>
    <p>Обычно подходит RGB: драйвер устройства уже учитывает порядок каналов. Меняйте его, только если тест показывает другой цвет.</p>
    <RayloomSelect label="Порядок цветовых каналов" value={calibration.channelOrder} onChange={value=>onChange({...component,calibration:{...calibration,channelOrder:value as typeof calibration.channelOrder}})} options={['RGB','RBG','GRB','GBR','BRG','BGR'].map(order=>({value:order,label:order}))}/>
    <div className="calibration-colors">{[['Красный',255,'#ff6b72'],['Зелёный',65280,'#91db9a'],['Синий',16711680,'#82afff']].map(([name,color,css])=><Button size="sm" variant="secondary" key={String(name)} isDisabled={busy||!device} style={{'--test-color':String(css)} as CSSProperties} onPress={()=>void run(()=>onIdentify(undefined,Number(color)),'Цветовой тест завершён, подсветка восстановлена.')}><i/>{name}</Button>)}</div>
    <p>Каждый тест должен показать цвет кнопки. Остальная подсветка временно погаснет.</p>
   </Accordion.Body></Accordion.Panel></Accordion.Item>

   <Accordion.Item id="matrix" className="port-matrix"><Accordion.Heading><Accordion.Trigger>Форма и порядок светодиодов<Accordion.Indicator/></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body>
    <MatrixEditor key={component.id} component={component} device={device} onChange={onChange} onSplit={onSplit} templates={templates} run={run} onIdentify={onIdentify}/>
    <Button className="port-template-save" size="sm" variant="secondary" isDisabled={busy} onPress={()=>void run(onSaveTemplate,'Матрица сохранена в шаблоны')}><Save size={14}/>Сохранить шаблон</Button>
   </Accordion.Body></Accordion.Panel></Accordion.Item>
  </Accordion>
 </div>;
}
