import {useEffect, useRef, useState} from 'react';
import {ActionIcon, Alert, Button, Group, Paper, SimpleGrid, Slider, Stack, Text, Textarea, TextInput, Title} from '@mantine/core';
import {ArrowDown, ArrowUp, FolderOpen, Plus, RotateCcw, Trash2} from 'lucide-react';
import {RayloomColorInput, RayloomDisclosure, RayloomSelect, RayloomSwitch, NumericInput} from './StudioControls';
import {ScreenRegion} from './ScreenRegion';
import {type Description, type Effect, type Field, clone} from '../types';

type Context = {catalog: Description[]; blends: string[]; notify: (message: string) => void; capture?: () => () => boolean};
// A picker or library read may finish after another edit, another selection or
// unmount. Never call an old onChange closure into a newer settings object.
function useAsyncEdit(value: any, context: Context) {
  const state = useRef({value, revision: 0, request: 0, mounted: true});
  if (state.current.value !== value) { state.current.value = value; state.current.revision++; }
  useEffect(() => { state.current.mounted = true; return () => { state.current.mounted = false; state.current.request++; }; }, []);
  return async (read: () => Promise<any>, change: (next: any) => void) => {
    const revision = state.current.revision, request = ++state.current.request, unchanged = context.capture?.() ?? (() => true);
    try {
      const next = await read();
      if (next === null || next === undefined || !state.current.mounted || state.current.request !== request) return;
      if (state.current.revision !== revision || !unchanged()) { context.notify('Выбор не применён: настройки уже изменились. Повторите выбор, если он ещё нужен.'); return; }
      change(next);
    } catch (error) { if (state.current.mounted && state.current.request === request && unchanged()) context.notify(String(error)); }
  };
}
export function Numeric({label, value, onChange, min, max, step = 1}: {label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number}) {
  const finite = Number.isFinite(value) ? value : 0;
  return <Stack gap="xs"><NumericInput label={label} value={finite} onChange={onChange} min={min} max={max} step={step}/>{min !== undefined && max !== undefined && max > min && <Slider aria-label={`${label} ползунок`} thumbLabel={`${label} ползунок`} value={Math.max(min, Math.min(max, finite))} onChange={onChange} min={min} max={max} step={step}/>}</Stack>;
}

function Palette({value, onChange, fixed = false}: {value: number[]; onChange: (value: number[]) => void; fixed?: boolean}) {
  const colors = Array.isArray(value) ? value : [];
  return <Stack gap="sm">{colors.map((color, index) => <Group key={index} align="end" wrap="nowrap"><div className="rayloom-grow"><RayloomColorInput label={`Цвет ${index + 1}`} value={color} onChange={next => onChange(colors.map((c, i) => i === index ? next : c))}/></div>{!fixed && colors.length > 1 && <ActionIcon variant="subtle" color="red" aria-label={`Удалить цвет ${index + 1}`} size="lg" onClick={() => onChange(colors.filter((_, i) => i !== index))}><Trash2 size={16}/></ActionIcon>}</Group>)}{!fixed && <Button size="xs" variant="light" leftSection={<Plus size={14}/>} onClick={() => onChange([...colors, 0xffffff])}>Добавить цвет</Button>}</Stack>;
}

export function Fields({fields, value, onChange, context}: {fields: Field[]; value: Record<string, any>; onChange: (value: Record<string, any>) => void; context: Context}) {
  const settings = value ?? {};
  return <Stack gap="lg">{fields.filter(field => field.key !== 'show_rendering' && field.key !== 'restore_token').map(field => <FieldEditor key={field.key} field={field} value={settings[field.key]} onChange={next => onChange({...settings, [field.key]: next})} context={context}/>)}</Stack>;
}

function FieldEditor({field: field, value, onChange, context}: {field: Field; value: any; onChange: (value: any) => void; context: Context}) {
  const readValue = useAsyncEdit(value, context);
  const label = field.label;
  if (field.type === 'layers') return <Layers value={value ?? []} onChange={onChange} context={context}/>;
  if (field.key === 'shader_program') return <ShaderEditor value={value} onChange={onChange} context={context}/>;
  if (field.type === 'boolean') return <Stack gap={4}><RayloomSwitch label={label} selected={Boolean(value)} onChange={onChange}/>{field.help && <Text size="xs" c="dimmed">{field.help}</Text>}</Stack>;
  if (field.type === 'number') return <Numeric label={label} value={value ?? 0} onChange={onChange} min={field.min} max={field.max} step={field.step ?? (Number.isInteger(value) ? 1 : .01)}/>;
  if (field.type === 'enum') return <Stack gap={4}><RayloomSelect label={label} value={String(value)} onChange={next => { const option = field.options?.find(item => String(item.value) === next); if (option) onChange(option.value); }} options={(field.options ?? []).map(option => ({value: String(option.value), label: option.label}))}/>{field.help && <Text size="xs" c="dimmed">{field.help}</Text>}</Stack>;
  if (field.type === 'color') return <RayloomColorInput label={label} value={value ?? 0} onChange={onChange}/>;
  if (field.type === 'colors') return <Stack gap="sm"><Text fw={500} size="sm">{label}</Text><Palette value={value ?? []} onChange={onChange}/></Stack>;
  if (field.type === 'object') return <RayloomDisclosure title={field.key === 'audio_settings' ? 'Аудиовход и эквалайзер' : label} defaultExpanded={field.key !== 'audio_settings'}><Fields fields={field.fields ?? []} value={value ?? {}} onChange={onChange} context={context}/></RayloomDisclosure>;
  if (field.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const move = (index: number, delta: number) => { const next = [...items]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next); };
    return <Stack gap="sm"><Text size="sm" fw={600}>{label}</Text>{items.map((item: any, index: number) => <Paper key={index} withBorder p="sm"><Stack gap="sm"><FieldEditor field={{...(field.item ?? {key: 'item', label: 'Шаг', type: typeof item}), label: `${label} ${index + 1}`}} value={item} onChange={next => onChange(items.map((a: any, i: number) => i === index ? next : a))} context={context}/>{field.key !== 'equalizer' && <Group justify="end" gap="xs"><ActionIcon variant="subtle" disabled={!index} aria-label={`Переместить шаг ${index + 1} выше`} onClick={() => move(index, -1)}><ArrowUp size={15}/></ActionIcon><ActionIcon variant="subtle" disabled={index === items.length - 1} aria-label={`Переместить шаг ${index + 1} ниже`} onClick={() => move(index, 1)}><ArrowDown size={15}/></ActionIcon><ActionIcon variant="subtle" color="red" aria-label={`Удалить шаг ${index + 1}`} onClick={() => onChange(items.filter((_: any, i: number) => i !== index))}><Trash2 size={15}/></ActionIcon></Group>}</Stack></Paper>)}{field.key !== 'equalizer' && <Button variant="light" size="xs" leftSection={<Plus size={14}/>} onClick={() => onChange([...items, field.item?.options?.[0]?.value ?? (field.item?.type === 'number' ? 0 : field.item?.type === 'object' ? {} : '')])}>Добавить шаг</Button>}</Stack>;
  }
  if (field.type === 'code') return <Textarea className="rayloom-code-input" label={label} spellCheck={false} autosize minRows={10} maxRows={24} value={value ?? ''} onChange={event => onChange(event.currentTarget.value)}/>;
  return <Group align="end" wrap="nowrap"><TextInput className="rayloom-grow" label={label} description={field.help} value={value ?? ''} onChange={event => onChange(event.currentTarget.value)}/>{field.type === 'file' && <Button variant="default" leftSection={<FolderOpen size={15}/>} onClick={() => void readValue(() => window.rayloom.file(field.key === 'fileName' ? 'gif' : 'texture'), onChange)}>Выбрать</Button>}</Group>;
}

const blankPass = () => ({type: 2, fragment_shader: 'void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);\n}', texture_path: ''});
function ShaderEditor({value, onChange, context}: {value: any; onChange: (value: any) => void; context: Context}) {
  const readValue = useAsyncEdit(value, context);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [library, setLibrary] = useState<{path: string; name: string}[]>([]), [previews, setPreviews] = useState<any[]>([]), [saveName, setSaveName] = useState('my-shader.fs');
  useEffect(() => { let active = true; void window.rayloom.effects('shaders').then(result => { if (active) setLibrary(result); }).catch(error => { if (active) context.notify(String(error)); }); return () => { active = false; }; }, []);
  useEffect(() => {
    let active = true, inflight = false;
    const timer = setInterval(() => { if (inflight || document.hidden) return; inflight = true; void window.rayloom.effects('diagnostics').then(result => { if (active) setPreviews(result); }).catch(() => {}).finally(() => { inflight = false; }); }, 500);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const current = value ?? {main_pass: blankPass(), passes: [], version: '110', width: 128, height: 128};
  const passes = Array.isArray(current.passes) ? current.passes : [];
  const passFields: Field[] = [{key: 'type', label: 'Источник', type: 'enum', options: [{label: 'Текстура', value: 0}, {label: 'Аудио', value: 1}, {label: 'GLSL', value: 2}]}, {key: 'texture_path', label: 'Текстура', type: 'file'}, {key: 'fragment_shader', label: 'GLSL · mainImage', type: 'code'}];
  return <Stack gap="lg"><Title order={4}>Редактор GLSL</Title>{previews.map((preview, index) => <Paper p="md" withBorder key={index}><Stack gap="sm"><Text fw={500}>{preview.name || 'Активный шейдер'}</Text>{preview.image && <img className="rayloom-shader-preview" src={preview.image} alt="Живой рендер GLSL"/>}{preview.log && <Text component="pre" size="xs" className="rayloom-code-log">{preview.log}</Text>}</Stack></Paper>)}
    <RayloomSelect label="Библиотека шейдеров" value="" placeholder="Выберите программу…" onChange={path => void readValue(() => window.rayloom.effects('shader.read', {path}), onChange)} options={library.map(shader => ({value: shader.path, label: shader.name}))}/>
    <Text size="sm" c="dimmed">iTime · iResolution · iAudio · iChannel0…3. Код компилируется при применении сцены.</Text>
    <RayloomSelect label="Версия GLSL" value={String(current.version)} onChange={version => onChange({...current, version})} options={['110', '120', '130', '140', '150', '330', '400', '410', '420', '430', '440', '450'].map(value => ({value, label: value}))}/>
    <Fields fields={passFields} value={current.main_pass ?? blankPass()} onChange={main_pass => onChange({...current, main_pass})} context={context}/>
    {passes.map((pass: any, index: number) => <RayloomDisclosure key={index} title={`Канал iChannel${index}`}><Fields fields={passFields} value={pass} onChange={next => onChange({...current, passes: passes.map((item: any, i: number) => i === index ? next : item)})} context={context}/><Button variant="light" color="red" onClick={() => onChange({...current, passes: passes.filter((_: any, i: number) => i !== index)})}>Удалить канал</Button></RayloomDisclosure>)}
    <Button variant="light" disabled={passes.length >= 4} leftSection={<Plus size={15}/>} onClick={() => onChange({...current, passes: [...passes, blankPass()]})}>Добавить проход</Button>
    <Group align="end"><TextInput className="rayloom-grow" label="Имя файла шейдера" value={saveName} onChange={event => setSaveName(event.currentTarget.value)}/><Button variant="default" disabled={!saveName.trim()} onClick={() => { const unchanged = context.capture?.() ?? (() => true); void window.rayloom.effects('shader.save', {name: saveName, program: current}).then(() => window.rayloom.effects('shaders')).then(result => { if (mounted.current) { setLibrary(result); context.notify(unchanged() ? 'Шейдер сохранён' : 'Шейдер сохранён. Новые правки ещё не записаны.'); } }).catch(error => { if (mounted.current) context.notify(String(error)); }); }}>Сохранить в библиотеку</Button></Group>
  </Stack>;
}

function Layers({value, onChange, context}: {value: any[]; onChange: (value: any[]) => void; context: Context}) {
  const update = (index: number, group: any) => onChange(value.map((item, i) => index === i ? group : item));
  const blend = (selected: number, set: (value: number) => void) => <RayloomSelect label="Наложение" value={String(selected)} onChange={next => set(Number(next))} options={context.blends.map((label, index) => ({value: String(index), label}))}/>;
  return <Stack gap="lg"><Title order={4}>Композиция слоёв</Title>{value.map((group, index) => <Paper key={index} p="md" withBorder><Stack gap="md"><Group justify="space-between"><Text fw={600}>Группа {index + 1}</Text><Group gap="xs"><ActionIcon variant="subtle" disabled={!index} aria-label={`Переместить группу ${index + 1} выше`} onClick={() => { const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}><ArrowUp size={16}/></ActionIcon><ActionIcon variant="subtle" color="red" aria-label={`Удалить группу ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={16}/></ActionIcon></Group></Group>
    {blend(group.composer_fn, next => update(index, {...group, composer_fn: next}))}
    {(group.layers ?? []).map((layer: any, layerIndex: number) => <RayloomDisclosure key={layerIndex} title={`${layerIndex + 1}. ${layer.effect_settings.CustomName || layer.effect_settings.EffectClassName}`}><Group><Button variant="default" disabled={!layerIndex} leftSection={<ArrowUp size={14}/>} onClick={() => { const next = [...group.layers]; [next[layerIndex - 1], next[layerIndex]] = [next[layerIndex], next[layerIndex - 1]]; update(index, {...group, layers: next}); }}>Выше</Button><Button variant="light" color="red" onClick={() => update(index, {...group, layers: group.layers.filter((_: any, i: number) => i !== layerIndex)})}>Удалить слой</Button></Group>
      {blend(layer.composer_fn, next => update(index, {...group, layers: group.layers.map((item: any, i: number) => i === layerIndex ? {...item, composer_fn: next} : item)}))}
      <EffectEditor value={layer.effect_settings} onChange={next => update(index, {...group, layers: group.layers.map((item: any, i: number) => i === layerIndex ? {...item, effect_settings: next} : item)})} context={context} nested/>
    </RayloomDisclosure>)}
    <RayloomSelect ariaLabel="Добавить эффект в группу" value="" disabled={(group.layers?.length ?? 0) >= 32} placeholder={(group.layers?.length ?? 0) >= 32 ? 'До 32 слоёв в группе' : 'Добавить эффект в группу…'} onChange={id => { const effect = context.catalog.find(item => item.id === id); if (effect && (group.layers?.length ?? 0) < 32) update(index, {...group, layers: [...(group.layers ?? []), {composer_fn: 6, effect_settings: clone(effect.defaults)}]}); }} options={context.catalog.filter(effect => effect.id !== 'Layers').map(effect => ({value: effect.id, label: effect.name}))}/>
  </Stack></Paper>)}<Button variant="light" disabled={value.length >= 16} leftSection={<Plus size={15}/>} onClick={() => { if (value.length < 16) onChange([...value, {composer_fn: 6, layers: []}]); }}>Добавить группу слоёв</Button>{value.length >= 16 && <Text size="xs" c="dimmed">До 16 групп в композиции.</Text>}</Stack>;
}

export function EffectEditor({value: value, onChange, context, nested = false}: {value: Effect; onChange: (value: Effect) => void; context: Context; nested?: boolean}) {
  const description = context.catalog.find(item => item.id === value.EffectClassName), [screens, setScreens] = useState<any[]>([]);
  useEffect(() => { let active = true; if (value.EffectClassName === 'Ambient') void window.rayloom.effects('screens').then(result => { if (active) setScreens(result); }).catch(error => { if (active) context.notify(String(error)); }); return () => { active = false; }; }, [value.EffectClassName]);
  if (!description) return <Alert color="yellow">Неизвестный эффект: {value.EffectClassName}. Выберите другой в библиотеке.</Alert>;
  const change = (key: string, next: any) => onChange({...value, [key]: next});
  return <Stack gap="xl" className="rayloom-native-effect-settings"><Group justify="space-between"><Title order={3}>{description.name}</Title><Button variant="subtle" size="xs" leftSection={<RotateCcw size={14}/>} onClick={() => onChange({...clone(description.defaults), ControllerZones: value.ControllerZones, CustomName: value.CustomName, AutoStart: value.AutoStart})}>Сбросить</Button></Group>
    <Text size="sm" c="dimmed">{description.description.replace(/<[^>]*>/g, ' ')}</Text><TextInput label="Название эффекта" value={value.CustomName ?? ''} placeholder={description.name} onChange={event => change('CustomName', event.currentTarget.value)}/>
    <SimpleGrid cols={{base: 1, sm: 2}} spacing="lg"><Numeric label="Яркость" value={value.Brightness} onChange={next => change('Brightness', next)} min={0} max={100}/>{description.speedMax > description.speedMin && <Numeric label="Скорость" value={value.Speed} onChange={next => change('Speed', next)} min={description.speedMin} max={description.speedMax}/>} {description.secondaryMax > description.secondaryMin && <Numeric label={description.secondaryName || 'Размер рисунка'} value={value.Slider2Val} onChange={next => change('Slider2Val', next)} min={description.secondaryMin} max={description.secondaryMax}/>}</SimpleGrid>
    <RayloomDisclosure title="Частота кадров, цветокоррекция и запуск"><SimpleGrid cols={{base: 1, sm: 2}} spacing="lg"><Numeric label="FPS" value={value.FPS} min={1} max={240} onChange={next => change('FPS', next)}/><Numeric label="Температура" value={value.Temperature} min={-100} max={100} onChange={next => change('Temperature', next)}/><Numeric label="Оттенок" value={value.Tint} min={-100} max={100} onChange={next => change('Tint', next)}/></SimpleGrid>{description.random && <RayloomSwitch label="Случайные цвета" selected={value.RandomColors} onChange={next => change('RandomColors', next)}/>} {description.onlyFirst && <RayloomSwitch label="Только первый светодиод" selected={value.AllowOnlyFirst} onChange={next => change('AllowOnlyFirst', next)}/>} {!nested && <RayloomSwitch label="Запускать при применении сцены" selected={value.AutoStart} onChange={next => change('AutoStart', next)}/>}</RayloomDisclosure>
    {description.colorCount > 0 && <Stack gap="sm"><Text fw={600} size="sm">Палитра эффекта</Text><Palette value={value.UserColors ?? description.defaults.UserColors ?? []} fixed onChange={next => change('UserColors', next)}/></Stack>}
    {value.EffectClassName === 'Ambient' && <Paper withBorder p="md"><Stack gap="sm"><Title order={4}>Область захвата</Title><Group>{screens.map(screen => <Button key={screen.index} size="xs" variant="default" onClick={() => change('CustomSettings', {...value.CustomSettings, screen_index: screen.index, left: 0, top: 0, width: screen.width, height: screen.height})}>Экран {screen.index + 1}: {screen.width} × {screen.height}</Button>)}</Group><Text size="sm" c="dimmed">Захват начнётся после применения сцены.</Text><ScreenRegion value={value.CustomSettings} onChange={next => change('CustomSettings', next)} notify={context.notify}/></Stack></Paper>}
    <Fields fields={description.fields} value={value.CustomSettings} onChange={next => { if (value.EffectClassName === 'Shaders') next = {...next, show_rendering: false, shader_program: {...next.shader_program, width: next.width, height: next.height}}; change('CustomSettings', next); }} context={context}/>
  </Stack>;
}
