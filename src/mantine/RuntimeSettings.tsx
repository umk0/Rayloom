import {useEffect, useRef, useState} from 'react';
import {Accordion, Alert, Badge, Button, Group, Loader, Paper, Stack, Switch, Text, Title} from '@mantine/core';
import {CheckCircle2, Cpu, MemoryStick, Power, RefreshCw} from 'lucide-react';
import {cleanPanelError} from '../../shared/panel-session.mjs';
import './panels.css';

type RuntimeState = {ready:boolean; changing?:boolean; error?:string; mode:string; settings:{autoStart:boolean; elevatedStartup?:boolean}; hardware?:{starting?:boolean; elevated?:boolean; i2cBusCount?:number}; memory?:{rss:number}; pid?:number; htmlRenderer?:boolean};
const cleanError = cleanPanelError;

export function RuntimeSettings() {
  const windows = window.rayloom.platform === 'win32';
  const [runtime, setRuntime] = useState<RuntimeState|null>(null);
  const [loadError, setLoadError] = useState(''), [actionError, setActionError] = useState('');
  const [pending, setPending] = useState(''), [notice, setNotice] = useState(''),[quitting,setQuitting]=useState(false);
  const mounted = useRef(false), revision = useRef(0), changing = useRef(false), refreshing = useRef(false);
  const refresh = async (required = false) => {
    if (!required && (changing.current || refreshing.current)) return;
    const token = revision.current; refreshing.current = true;
    try {
      const next = await window.rayloom.studio('runtime.status') as RuntimeState;
      if (mounted.current && token === revision.current) { setRuntime(next); setLoadError(''); }
      return next;
    } catch (error) {
      if (mounted.current && token === revision.current) setLoadError(cleanError(error));
      if (required) throw error;
    } finally { refreshing.current = false; }
  };
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { mounted.current = false; revision.current++; clearInterval(timer); };
  }, []);
  const apply = async (method:string, args:Record<string, unknown>, label:string, success:string, confirm:(state:RuntimeState)=>boolean) => {
    if (changing.current) return;
    changing.current = true; revision.current++; setPending(label); setActionError(''); setNotice('');
    try {
      await window.rayloom.studio(method, args); revision.current++;
      const confirmed = await refresh(true);
      if (!confirmed?.ready || confirmed.changing) throw Error('Изменение отправлено. Дождитесь проверки устройств.');
      if (!confirm(confirmed)) throw Error('Новое состояние не подтвердилось. Обновите состояние и повторите настройку.');
      if (mounted.current) setNotice(success);
    } catch (error) {
      if (mounted.current) setActionError(cleanError(error));
      revision.current++; await refresh(true).catch(() => {});
    } finally { changing.current = false; if (mounted.current) setPending(''); }
  };
  const quit=async()=>{if(changing.current)return;changing.current=true;setQuitting(true);setActionError('');try{await window.rayloom.window('quit');}catch(error){if(mounted.current)setActionError(cleanError(error));}finally{changing.current=false;if(mounted.current)setQuitting(false);}};
  const virtual = runtime?.mode === 'virtual', busy = !!pending || quitting || runtime?.changing === true;
  const ready = runtime?.ready === true && !runtime.hardware?.starting;
  const granted = ready && runtime?.hardware?.elevated === true;
  const accessKnown = ready && typeof runtime?.hardware?.elevated === 'boolean';
  const automatic = runtime?.settings.autoStart === true;
  const savedAccess = automatic && runtime?.settings.elevatedStartup === true;
  const disabled = !windows || busy || virtual || !ready || !!loadError;
  const saveStartup = (enabled:boolean) => void apply(
    enabled && granted ? 'runtime.elevate' : 'runtime.settings',
    enabled && granted ? {autoStart:true} : {settings:{autoStart:enabled}},
    enabled ? 'Включаем автозапуск…' : 'Выключаем автозапуск…',
    enabled ? 'Последняя сцена будет запускаться при входе в Windows.' : 'Автозапуск выключен. Текущая подсветка продолжает работать.',
    state => state.settings.autoStart === enabled && (!enabled || !granted || state.settings.elevatedStartup === true)
  );
  const allowMemory = (remember:boolean) => void apply('runtime.elevate', {autoStart:remember}, 'Подтверждаем доступ к памяти…',
    remember ? 'Доступ к памяти сохранён для следующих запусков.' : 'Доступ к памяти подтверждён для текущего запуска.',
    state => state.hardware?.elevated === true && (!remember || (state.settings.autoStart && state.settings.elevatedStartup === true))
  );
  return <Stack className="rayloom-runtime" gap="lg">
    <div><Title order={2}>Фоновая работа</Title><Text c="dimmed" mt={6}>Настройте свет один раз. Сцена продолжит работать, когда вы закроете окно.</Text></div>
    {(loadError || actionError) && <Alert color="red" title="Не удалось изменить настройку" role="alert"><Text size="sm">{actionError || loadError}</Text><Button mt="sm" variant="light" color="red" disabled={busy} leftSection={<RefreshCw size={15}/>} onClick={() => void refresh()}>Обновить состояние</Button></Alert>}
    {pending && <Alert title={pending} icon={<Loader size={18}/>} role="status"><Text size="sm">Подтвердите запрос Windows, если он появится, и дождитесь завершения проверки.</Text></Alert>}
    {notice && !pending && <Alert color="green" icon={<CheckCircle2 size={18}/>} role="status">{notice}</Alert>}
    {!runtime ? <Group role="status"><Loader size="sm"/><Text>Проверяем настройки…</Text></Group> : <>
      <Paper withBorder p="lg" radius="lg" className="rayloom-setting-card"><Cpu size={22}/><Stack gap={6}>
        <Title order={3}>Работа после закрытия окна</Title><Text c="dimmed">Закрывайте редактор крестиком — свет и сценарии останутся включены.</Text>
        <Text size="sm" c={runtime.error ? 'red' : ready ? 'ray' : 'dimmed'} role="status">{runtime.error ? 'Движку требуется внимание: ' + runtime.error : !ready ? 'Проверяем устройства и восстанавливаем сцену…' : 'Готово к фоновой работе'}</Text>
      </Stack></Paper>
      <Paper withBorder p="lg" radius="lg" className="rayloom-setting-card"><Power size={22}/><Stack gap="md">
        <Group justify="space-between" align="flex-start"><div><Title order={3}>Автозапуск</Title><Text c="dimmed" mt={6}>{windows ? 'Последняя сцена включится при входе в Windows.' : 'Настройка автозапуска пока доступна только в Windows.'}</Text></div><Badge variant="light" color={automatic ? 'ray' : 'gray'}>{automatic ? 'Включён' : 'Выключен'}</Badge></Group>
        <Switch checked={windows && automatic} disabled={disabled} onChange={event => saveStartup(event.currentTarget.checked)} label={windows ? 'Запускать подсветку вместе с Windows' : 'Запускать подсветку при входе в систему'}/>
        {virtual && <Text c="dimmed" size="sm">Автозапуск недоступен в виртуальной студии.</Text>}
        {windows && !virtual && automatic && !savedAccess && <Text c="dimmed" size="sm">Для подсветки оперативной памяти разрешите доступ ниже.</Text>}
      </Stack></Paper>
      <Paper withBorder p="lg" radius="lg" className="rayloom-setting-card"><MemoryStick size={22}/><Stack gap="md">
        <div><Title order={3}>Подсветка оперативной памяти</Title><Text c="dimmed" mt={6}>{windows ? 'Однократное разрешение Windows для управления светом на модулях памяти.' : 'Мастер выдачи доступа пока доступен только в Windows.'}</Text></div>
        <Text size="sm" c={granted ? 'ray' : 'dimmed'} role="status">{!windows ? 'Недоступно на этой платформе.' : virtual ? 'Проверка доступна с реальными устройствами.' : !accessKnown ? 'Проверяем доступ…' : granted ? 'Доступ разрешён' : 'Доступ пока не разрешён'}</Text>
        {windows && !virtual && <>
          {!granted && <div><Button variant="light" disabled={disabled || !accessKnown} onClick={() => allowMemory(automatic)}>Разрешить доступ</Button><Text c="dimmed" size="sm" mt="sm">{automatic ? 'Разрешение сохранится для автозапуска.' : 'Автозапуск при этом не включается.'} Свет может ненадолго прерваться, затем сцена восстановится.</Text></div>}
          {granted && !savedAccess && <div><Text c="dimmed" size="sm">{automatic ? 'Доступ есть в текущем запуске. Сохраните его для следующих входов в Windows.' : 'Включите автозапуск выше, чтобы сохранить доступ для следующих входов в Windows.'}</Text>{automatic && <Button mt="sm" variant="light" disabled={disabled} onClick={() => allowMemory(true)}>Сохранять доступ при входе</Button>}</div>}
          {savedAccess && <Text c="dimmed" size="sm">Разрешение сохранено. Повторное подтверждение не требуется.</Text>}
        </>}
      </Stack></Paper>
      <Accordion variant="separated" radius="lg"><Accordion.Item value="diagnostics"><Accordion.Control>Техническая диагностика</Accordion.Control><Accordion.Panel>
        <dl className="rayloom-runtime-diagnostics"><div><dt>Процесс агента</dt><dd>{runtime.pid ?? '—'}</dd></div><div><dt>Память агента</dt><dd>{runtime.memory ? Math.round(runtime.memory.rss / 1024 / 1024) + ' МБ' : '—'}</dd></div><div><dt>Права ядра</dt><dd>{accessKnown ? granted ? 'Администратор' : 'Обычные' : 'Проверяются'}</dd></div><div><dt>Доступные шины</dt><dd>{runtime.hardware?.i2cBusCount ?? '—'}</dd></div><div><dt>HTML-вычислитель</dt><dd>{runtime.htmlRenderer ? 'Работает' : 'Не используется'}</dd></div></dl>
        <Text size="sm" c="dimmed">Память нативного ядра учитывается отдельно. HTML-эффекты используют отдельный процесс, работающий после закрытия редактора. Права администратора сами по себе не гарантируют поддержку конкретного модуля памяти.</Text>
      </Accordion.Panel></Accordion.Item></Accordion>
      <div><Button variant="subtle" color="gray" disabled={busy} loading={quitting} onClick={() => void quit()}>Полностью завершить Rayloom</Button></div>
    </>}
  </Stack>;
}
