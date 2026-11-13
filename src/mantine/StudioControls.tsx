import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Accordion, ColorInput, Group, NumberInput, Select, Slider, Stack, Switch, Text} from '@mantine/core';
import {hex, rgb} from '../types';
import './effects.css';

type SelectOption = {value: string; label: string; description?: string; disabled?: boolean};
export function RayloomSelect({label, ariaLabel, value, onChange, options, disabled = false, placeholder = 'Выберите…', className = ''}: {label?: string; ariaLabel?: string; value: string; onChange: (value: string) => void; options: SelectOption[]; disabled?: boolean; placeholder?: string; className?: string}) {
  return <Select className={className} label={label} aria-label={ariaLabel ?? label} value={value || null}
    onChange={next => { if (next !== null) onChange(String(next)); }} data={options} disabled={disabled}
    placeholder={placeholder} searchable={options.length > 8} nothingFoundMessage="Ничего не найдено"
    comboboxProps={{zIndex: 1200}} renderOption={({option}) => {
      const description = options.find(item => item.value === option.value)?.description;
      return <Stack gap={2}><Text size="sm">{option.label}</Text>{description && <Text size="xs" c="dimmed">{description}</Text>}</Stack>;
    }}/>;
}

export function RayloomSwitch({label, selected, onChange, disabled = false}: {label: string; selected: boolean; onChange: (value: boolean) => void; disabled?: boolean}) {
  return <Switch label={label} checked={selected} onChange={event => onChange(event.currentTarget.checked)} disabled={disabled} className="rayloom-setting-switch"/>;
}

export function RayloomSlider({label, value, onChange, min = 0, max = 100, step = 1, suffix = ''}: {label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string}) {
  const safeValue = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  return <Stack gap={12} className="rayloom-slider"><Group justify="space-between" gap="xs"><Text size="sm">{label}</Text><Text size="sm" c="dimmed" ff="monospace">{Number(safeValue.toFixed(4))}{suffix}</Text></Group>
    <Slider aria-label={label} thumbLabel={label} value={safeValue} onChange={onChange} min={min} max={max} step={step} label={v => `${v}${suffix}`}/></Stack>;
}

/** Keeps incomplete text local; only finite, bounded numbers reach the scene contract. */
export function NumericInput({label, value, onChange, min, max, step = 1, hint}: {label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; hint?: string}) {
  const [draft, setDraft] = useState<string | number>(value);
  const latest = useRef<string | number>(value), skipBlur = useRef(false);
  useEffect(() => { latest.current = value; setDraft(value); }, [value]);
  const commit = () => {
    if (skipBlur.current) { skipBlur.current = false; latest.current = value; setDraft(value); return; }
    const raw = latest.current;
    const entered = typeof raw === 'number' ? raw : raw.trim() === '' ? value : Number(raw.replace(',', '.'));
    const finite = Number.isFinite(entered) ? entered : value;
    const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, finite));
    const precision = step < 1 ? Math.min(5, (String(step).split('.')[1] ?? '').length) : 0;
    const next = Number(clamped.toFixed(precision));
    latest.current = next; setDraft(next);
    if (next !== value) onChange(next);
  };
  return <NumberInput label={label} aria-label={label} description={hint} value={draft}
    min={min} max={max} step={step} clampBehavior="none" decimalScale={5}
    onChange={next => { latest.current = next; setDraft(next); }} onBlur={commit}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { event.stopPropagation(); skipBlur.current = true; latest.current = value; setDraft(value); event.currentTarget.blur(); }
    }}/>;
}

export function BoundedNumber(props: {label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number; hint?: string}) {
  return <NumericInput {...props}/>;
}

export function RayloomColorInput({label, value, onChange}: {label: string; value: number; onChange: (color: number) => void}) {
  const [draft, setDraft] = useState(hex(value));
  useEffect(() => setDraft(hex(value)), [value]);
  return <ColorInput label={label} aria-label={label} format="hex" value={draft} withEyeDropper={false}
    onChange={next => { setDraft(next); if (/^#[0-9a-f]{6}$/i.test(next)) onChange(rgb(next)); }}
    onBlur={() => { if (!/^#[0-9a-f]{6}$/i.test(draft)) setDraft(hex(value)); }}
    popoverProps={{zIndex: 1200, trapFocus: true, returnFocus: true}}
    swatches={['#ff595e', '#ffad5a', '#e8ed75', '#b4f17b', '#65d5d2', '#7ba7ff', '#c198ee', '#ffffff']}/>
}

export function StudioColorPicker({value, onChange}: {value: number; onChange: (color: number) => void}) {
  return <RayloomColorInput label="Цвет эффекта" value={value} onChange={onChange}/>;
}

export function RayloomDisclosure({title, children, defaultExpanded = false, className = '', onExpandedChange}: {title: string; children: ReactNode; defaultExpanded?: boolean; className?: string; onExpandedChange?: (expanded: boolean) => void}) {
  return <Accordion className={`rayloom-disclosure ${className}`} variant="separated" defaultValue={defaultExpanded ? 'content' : null} onChange={value => onExpandedChange?.(value === 'content')}>
    <Accordion.Item value="content"><Accordion.Control>{title}</Accordion.Control><Accordion.Panel><Stack gap="md">{children}</Stack></Accordion.Panel></Accordion.Item>
  </Accordion>;
}
