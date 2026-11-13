import {useEffect, useMemo, useState} from 'react';
import {ActionIcon, Badge, Button, Group, Modal, Select, Stack, Tabs, Text, TextInput, Tooltip, UnstyledButton} from '@mantine/core';
import {Bookmark, Check, Grid2X2, Search} from 'lucide-react';
import {BUILTIN_EFFECTS} from '../../shared/builtin-effects.mjs';
import {FAVORITES_KEY, FAVORITES_EVENT, readFavorites, toggleFavorite, filterLibrary, libraryViewKey, readLibraryView} from '../../shared/effect-library-state.mjs';
import type {Description} from '../types';
import {EffectPreview, nativePreviewQueue, type PreviewSpec} from '../EffectPreview';
import './effects.css';

type LibraryEffect = PreviewSpec & {name: string; description: string; category?: string};
type Props = {value: string; onChange: (value: string) => void; catalog: Description[]; plugins: any[]; config: any; compact?: boolean; nativeOnly?: boolean};
const categoryNames: Record<string, string> = {Advanced: 'Продвинутые', Audio: 'Музыка', Beams: 'Лучи', Rainbow: 'Радуга', Random: 'Случайные', Simple: 'Простые', Special: 'Особые'};
const plainDescription = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();

export function EffectLibrary({value, onChange, catalog, plugins, config, compact = false, nativeOnly = false}: Props) {
  const [view] = useState(() => readLibraryView(sessionStorage, nativeOnly));
  const [opened, setOpened] = useState(false), [query, setQuery] = useState(view.query), [source, setSource] = useState(view.source), [category, setCategory] = useState(view.category), [active, setActive] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites(localStorage)), [favoriteError, setFavoriteError] = useState('');
  useEffect(() => { try { sessionStorage.setItem(libraryViewKey(nativeOnly), JSON.stringify({query, source, category})); } catch {} }, [query, source, category, nativeOnly]);
  useEffect(() => {
    const refresh = () => setFavorites(readFavorites(localStorage));
    const storage = (event: StorageEvent) => { if (event.key === FAVORITES_KEY || event.key === null) refresh(); };
    window.addEventListener(FAVORITES_EVENT, refresh); window.addEventListener('storage', storage);
    return () => { window.removeEventListener(FAVORITES_EVENT, refresh); window.removeEventListener('storage', storage); };
  }, []);
  const bookmark = (id: string) => {
    try { setFavorites(toggleFavorite(localStorage, id)); setFavoriteError(''); window.dispatchEvent(new Event(FAVORITES_EVENT)); }
    catch { setFavoriteError('Не удалось сохранить избранное. Прежний список сохранён; попробуйте ещё раз.'); }
  };
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)'), change = () => setReducedMotion(media.matches), pause = () => setActive('');
    media.addEventListener('change', change); window.addEventListener('blur', pause); document.addEventListener('visibilitychange', pause);
    return () => { media.removeEventListener('change', change); window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', pause); };
  }, []);
  useEffect(() => {
    nativePreviewQueue.setActive(active.startsWith('openrgb:') && !reducedMotion ? active.slice(8) : active && !reducedMotion ? 'local' : null);
    return () => nativePreviewQueue.setActive(null);
  }, [active, reducedMotion]);
  const effects = useMemo<LibraryEffect[]>(() => [
    ...(!nativeOnly ? BUILTIN_EFFECTS.map((effect: {id: string; name: string; description: string}) => ({...effect, source: 'rayloom' as const})) : []),
    ...catalog.map(effect => ({id: `openrgb:${effect.id}`, name: effect.name || effect.id, description: plainDescription(effect.description ?? ''), source: 'openrgb' as const, nativeId: effect.id, category: effect.category, inputKind: effect.category === 'Audio' ? 'audio' : undefined})),
    ...(!nativeOnly ? plugins.flatMap(plugin => (plugin.effects ?? []).map((effect: any) => ({id: `${plugin.id}/${effect.id}`, name: effect.name || effect.id, description: effect.description || plugin.name, source: 'community' as const, definition: effect}))) : []),
  ], [catalog, plugins, nativeOnly]);
  const selected = effects.find(effect => effect.id === value);
  const featured = ['aurora', 'prism', 'nebula', 'tidal'].map(id => effects.find(effect => effect.id === id)).filter((effect): effect is LibraryEffect => Boolean(effect));
  if (selected && !featured.some(effect => effect.id === value)) featured[Math.min(featured.length, 3)] = selected;
  const filtered: LibraryEffect[] = filterLibrary(effects, {source, category, query}, favorites);
  const shown = compact && !opened ? featured : filtered;
  useEffect(() => { if (active && !shown.some(effect => effect.id === active)) setActive(''); }, [active, shown]);
  const choose = (id: string) => { setActive(''); onChange(id); setOpened(false); };
  const card = (effect: LibraryEffect, allowPreview = true, dense = false) => <div key={effect.id} style={{position: 'relative', minWidth: 0}}><UnstyledButton data-effect={effect.id} style={{height: '100%', width: '100%'}} className={`rayloom-effect-card ${value === effect.id ? 'is-selected' : ''}`} aria-pressed={value === effect.id} aria-label={effect.name}
    onClick={() => choose(effect.id)} onPointerEnter={() => { if (allowPreview) setActive(effect.id); }} onPointerLeave={() => { if (allowPreview) setActive(current => current === effect.id ? '' : current); }} onFocus={() => { if (allowPreview) setActive(effect.id); }} onBlur={() => { if (allowPreview) setActive(current => current === effect.id ? '' : current); }}>
    <div className="rayloom-effect-card-visual"><EffectPreview effect={effect} active={allowPreview && active === effect.id} config={config} reducedMotion={reducedMotion} onInactive={() => { if (allowPreview) setActive(current => current === effect.id ? '' : current); }}/>{value === effect.id && <span className="rayloom-effect-check" style={{right: dense ? 8 : 46}}><Check size={15}/></span>}</div>
    <div className="rayloom-effect-card-copy"><Text fw={600} size="sm">{effect.name}</Text>{!dense && <><Text size="xs" c="dimmed" lineClamp={2}>{effect.description || 'Настраиваемый эффект'}</Text><Badge size="xs" variant="light" color="gray">{effect.source === 'rayloom' ? 'Rayloom' : effect.source === 'community' ? 'Сообщество' : categoryNames[effect.category ?? ''] ?? 'Effects Plugin'}</Badge></>}</div>
  </UnstyledButton>{!dense && <Tooltip label={favorites.includes(effect.id) ? 'Убрать из избранного' : 'В избранное'}><ActionIcon style={{position: 'absolute', right: 8, top: 8}} variant={favorites.includes(effect.id) ? 'filled' : 'default'} size="md" aria-pressed={favorites.includes(effect.id)} aria-label={`${favorites.includes(effect.id) ? 'Убрать из избранного' : 'Добавить в избранное'}: ${effect.name}`} onClick={() => bookmark(effect.id)}><Bookmark size={15} fill={favorites.includes(effect.id) ? 'currentColor' : 'none'}/></ActionIcon></Tooltip>}</div>;
  const fullLibrary = <Stack gap="md"><Group align="start"><TextInput className="rayloom-grow" aria-label="Поиск эффектов" placeholder="Найти эффект…" value={query} onChange={event => setQuery(event.currentTarget.value)} leftSection={<Search size={16}/>} data-autofocus/>
    <Select aria-label="Категория эффектов" value={category} onChange={next => setCategory(next ?? 'all')} data={[{value: 'all', label: 'Все категории'}, ...Array.from(new Set(catalog.map(effect => effect.category))).map(value => ({value, label: categoryNames[value] ?? value}))]} comboboxProps={{zIndex: 1200}}/></Group>
    <Tabs value={source} onChange={next => { setSource(next ?? 'all'); setCategory('all'); }}><Tabs.List aria-label="Источник эффектов">{[{value: 'all', label: 'Все'}, {value: 'favorites', label: 'Избранное'}, ...(!nativeOnly ? [{value: 'rayloom', label: 'Rayloom'}, {value: 'openrgb', label: 'Effects Plugin'}, {value: 'community', label: 'Сообщество'}] : [])].map(item => <Tabs.Tab key={item.value} value={item.value}>{item.label}</Tabs.Tab>)}</Tabs.List></Tabs>
    {favoriteError && <Text size="sm" c="red" role="alert">{favoriteError}</Text>}
    <Text size="xs" c="dimmed">{filtered.length} эффектов. Наведите курсор или перейдите к карточке клавишей Tab. Предпросмотр не меняет подсветку.</Text>
    <div className="rayloom-effect-grid" aria-label="Библиотека эффектов">{filtered.map(effect => card(effect))}</div>{!filtered.length && <Text c="dimmed" ta="center" py="xl">{source === 'favorites' && !favorites.length ? 'Сохраните любимые эффекты кнопкой закладки на карточке.' : 'Ничего не найдено. Попробуйте другое название или категорию.'}</Text>}
    <Text size="xs" c="dimmed">Аудиоэффекты слушают системный звук при наведении. Для GIF, шейдеров и слоёв сначала задайте источник в редакторе сцены.</Text>
  </Stack>;
  if (!compact) return fullLibrary;
  return <Stack gap="sm" className="rayloom-effect-library"><Group justify="space-between"><Text size="sm" c="dimmed">Эффекты</Text><Text size="xs" c="dimmed">{selected?.name}</Text></Group>
    <div className="rayloom-effect-strip" aria-label="Быстрый выбор эффекта">{featured.map(effect => card(effect, !opened, true))}<Button className="rayloom-all-effects" variant="default" leftSection={<Grid2X2 size={18}/>} onClick={() => { setActive(''); setOpened(true); }}>Все эффекты</Button></div>
    <Modal opened={opened} onClose={() => { setOpened(false); setActive(''); }} title="Все эффекты" size="min(1120px, 94vw)" zIndex={800} classNames={{root: 'rayloom rayloom-effect-modal'}}>{fullLibrary}</Modal>
  </Stack>;
}
