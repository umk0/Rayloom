import {ActionIcon, Button, Group, Stack, Text, Title} from '@mantine/core';
import {Plus, Trash2} from 'lucide-react';
import {RayloomColorInput, RayloomDisclosure, RayloomSelect, RayloomSlider, RayloomSwitch} from './StudioControls';
import {getEffectParameterSchema, readEffectParameter, updateEffectParameter} from '../../shared/effect-parameters.mjs';
import type {Description} from '../types';

type Control = {key: string; label: string; type: string; binding: string; default: any; help?: string; min?: number; max?: number; step?: number; suffix?: string; advanced?: boolean; minItems?: number; maxItems?: number; options?: {label: string; value: number | string}[]};
function ParameterControl({control: d, value, onChange}: {control: Control; value: any; onChange: (value: any) => void}) {
  if (d.type === 'number') return <Stack gap={6}><RayloomSlider label={d.label} value={value} min={d.min} max={d.max} step={d.step ?? 1} suffix={d.suffix ?? ''} onChange={onChange}/>{d.help && <Text size="xs" c="dimmed">{d.help}</Text>}</Stack>;
  if (d.type === 'boolean') return <Stack gap={6}><RayloomSwitch label={d.label} selected={Boolean(value)} onChange={onChange}/>{d.help && <Text size="xs" c="dimmed">{d.help}</Text>}</Stack>;
  if (d.type === 'color') return <RayloomColorInput label={d.label} value={value} onChange={onChange}/>;
  if (d.type === 'select') return <Stack gap={6}><RayloomSelect label={d.label} value={String(value)} onChange={next => { const option = d.options?.find(o => String(o.value) === next); if (option) onChange(option.value); }} options={(d.options ?? []).map(o => ({label: o.label, value: String(o.value)}))}/>{d.help && <Text size="xs" c="dimmed">{d.help}</Text>}</Stack>;
  if (d.type === 'palette') {
    const colors: number[] = Array.isArray(value) ? value : [];
    return <Stack gap="sm" role="group" aria-label={d.label}><Text size="sm" fw={500}>{d.label}</Text>{colors.map((color, index) => <Group key={index} align="end" wrap="nowrap"><div className="rayloom-grow"><RayloomColorInput label={`Цвет ${index + 1}`} value={color} onChange={next => onChange(colors.map((c, i) => i === index ? next : c))}/></div>{colors.length > (d.minItems ?? 1) && <ActionIcon variant="subtle" color="red" size="lg" aria-label={`Удалить цвет ${index + 1}`} onClick={() => onChange(colors.filter((_, i) => i !== index))}><Trash2 size={16}/></ActionIcon>}</Group>)}{colors.length < (d.maxItems ?? 256) && <Button variant="light" size="xs" leftSection={<Plus size={14}/>} onClick={() => onChange([...colors, 0xffffff])}>Добавить цвет</Button>}</Stack>;
  }
  return null;
}

export function EffectParameters({effectId, config, catalog, plugins, onChange, onAdvanced}: {effectId: string; config: any; catalog: Description[]; plugins: any[]; onChange: (next: any) => void; onAdvanced?: () => void}) {
  const schema = getEffectParameterSchema(effectId, {catalog, plugins});
  const controls = schema.controls as Control[], main = controls.filter(d => !d.advanced), advanced = controls.filter(d => d.advanced);
  const render = (d: Control) => <ParameterControl key={`${effectId}:${d.binding}:${d.key}`} control={d} value={readEffectParameter(d, config, effectId)} onChange={value => onChange(updateEffectParameter(config, effectId, d, value))}/>;
  return <Stack gap="xl" className="rayloom-effect-parameters" component="section" aria-label={`Настройки эффекта ${schema.name}`} data-effect-parameters={effectId}>
    <Title order={3}>{schema.name}</Title>
    {schema.loading ? <Text c="dimmed" size="sm">Загружаем настройки…</Text> : schema.unavailable ? <Text c="dimmed" size="sm">Эффект недоступен. Выберите другой в библиотеке.</Text> : <>
      {schema.fixedPalette && <Text c="dimmed" size="sm">У этого эффекта своя палитра.</Text>}
      {!controls.length && !schema.hasAdvancedOnly && <Text c="dimmed" size="sm">У эффекта нет дополнительных настроек.</Text>}
      {main.map(render)}
      {(advanced.length > 0 || schema.hasAdvancedOnly) && <RayloomDisclosure title="Дополнительно">{advanced.map(render)}{schema.hasAdvancedOnly && <Stack gap="sm"><Text size="sm" c="dimmed">GIF, шейдеры и слои настраиваются в отдельной сцене редактора.</Text>{onAdvanced && <Button variant="light" onClick={onAdvanced}>Открыть редактор сцены</Button>}</Stack>}</RayloomDisclosure>}
    </>}
  </Stack>;
}
