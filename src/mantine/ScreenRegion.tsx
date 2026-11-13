import {useRef, useState, type PointerEvent} from 'react';
import {Button, Stack, Text} from '@mantine/core';

export function ScreenRegion({value, onChange, notify}: {value: any; onChange: (value: any) => void; notify: (message: string) => void}) {
  const [frame, setFrame] = useState<any>(null), [busy, setBusy] = useState(false);
  const start = useRef<{x: number; y: number} | null>(null);
  const capture = async () => {
    setBusy(true);
    try { const index = value.screen_index; setFrame({...await window.rayloom.effects('screen.capture', {index}), index}); }
    catch (error) { notify(String(error)); } finally { setBusy(false); }
  };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {x: Math.max(0, Math.min(frame.width - 1, Math.round((event.clientX - rect.left) * frame.width / rect.width))), y: Math.max(0, Math.min(frame.height - 1, Math.round((event.clientY - rect.top) * frame.height / rect.height)))};
  };
  return <Stack gap="sm"><Button variant="light" loading={busy} onClick={() => void capture()}>Выделить область на снимке экрана</Button>
    {frame && frame.index === value.screen_index && <><Text size="sm" c="dimmed">Проведите мышью по снимку. Область также можно задать числовыми полями ниже.</Text><div className="rayloom-screen-region" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); start.current = point(event); }}
      onPointerMove={event => { if (!start.current) return; const p = point(event), s = start.current; onChange({...value, left: Math.min(p.x, s.x), top: Math.min(p.y, s.y), width: Math.max(1, Math.abs(p.x - s.x)), height: Math.max(1, Math.abs(p.y - s.y))}); }} onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}>
      <img src={frame.image} alt="Выбор области захвата экрана" draggable={false}/><div className="rayloom-screen-selection" style={{left: `${100 * value.left / frame.width}%`, top: `${100 * value.top / frame.height}%`, width: `${100 * value.width / frame.width}%`, height: `${100 * value.height / frame.height}%`}}/>
    </div><Button variant="subtle" onClick={() => setFrame(null)}>Закрыть снимок</Button></>}
  </Stack>;
}
