import {useState} from 'react';
import {ActionIcon,Accordion,Alert,Badge,Button,Card,Group,SimpleGrid,Stack,Tabs,Text,TextInput,ThemeIcon,Title,Tooltip} from '@mantine/core';
import {ArrowRight,Boxes,Code2,Layers3,Monitor,Palette,Plus,RefreshCw,Search,Sparkles,Timer,Waves} from 'lucide-react';
import {builtInExtensions,matchesExtension,nativeExtensionState} from '../../shared/extension-catalog.mjs';
import type {StudioController} from './useStudio';

const icons:Record<string,typeof Sparkles>={effects:Sparkles,map:Layers3,hardware:Monitor,schedule:Timer,events:Code2,network:Waves,theme:Palette};
const builtinCatalog:{id:string;nativeId:string;title:string;description:string;icon:string}[]=builtInExtensions;
// Keep the catalog position when an extension opens in the same shell.
let catalogView={tab:'all',query:''};
export function ExtensionsScreen({s,onOpen,onCreate,onEffects}:{s:StudioController;onOpen:(id:string)=>void;onCreate:()=>void;onEffects:()=>void}){
  const [tab,setTab]=useState(catalogView.tab),[query,setQuery]=useState(catalogView.query);
  const changeTab=(value:string|null)=>{if(value){catalogView.tab=value;setTab(value);}};
  const changeQuery=(value:string)=>{catalogView.query=value;setQuery(value);};
  const builtins=builtinCatalog.filter(p=>matchesExtension(query,p.title,p.description));
  const packages=(s.state?.plugins??[]).filter((p:any)=>matchesExtension(query,p.name,p.description,p.author,...p.effects.map((e:any)=>e.name)));
  const count=(tab==='packages'?0:builtins.length)+(tab==='builtins'?0:packages.length);
  return <Stack gap="xl">
    <Group justify="space-between" align="start">
      <Text c="dimmed" size="sm" maw={520}>Встроенные возможности и ваши пакеты — всё для управления светом в одном месте.</Text>
      <Group gap="xs"><Button variant="light" leftSection={<Plus size={16}/>} disabled={s.busy||!s.ready} onClick={()=>void s.run(async()=>{const result=await window.rayloom.studio('plugins.install');if(result!==null)s.setNotice('Пакет установлен');return result;})}>Установить из папки</Button><Tooltip label="Обновить список пакетов"><ActionIcon variant="default" size="lg" aria-label="Обновить плагины" disabled={s.busy||!s.ready} onClick={()=>void s.run(()=>window.rayloom.studio('plugins.reload'))}><RefreshCw size={16}/></ActionIcon></Tooltip></Group>
    </Group>
    <TextInput aria-label="Найти расширение" placeholder="Найти расширение…" leftSection={<Search size={16}/>} value={query} onChange={e=>changeQuery(e.currentTarget.value)} rightSection={query?<ActionIcon variant="subtle" aria-label="Очистить поиск расширений" onClick={()=>changeQuery('')}>×</ActionIcon>:undefined}/>
    <Tabs value={tab} onChange={changeTab}>
      <Tabs.List aria-label="Тип расширений"><Tabs.Tab value="all">Все</Tabs.Tab><Tabs.Tab value="builtins">Встроенные</Tabs.Tab><Tabs.Tab value="packages">Мои пакеты</Tabs.Tab></Tabs.List>
      {['all','builtins','packages'].map(section=><Tabs.Panel key={section} value={section} pt="xl">
        {section===tab&&<>
          {!!count&&<SimpleGrid cols={{base:1,sm:2,lg:3}} spacing="lg">
            {tab!=='packages'&&builtins.map(p=>{
              const Icon=icons[p.icon]??Boxes,status=nativeExtensionState(p,s.snapshot);
              return <Card key={p.id} className="ray-extension-card" withBorder radius="lg" padding="lg">
                <Group justify="space-between"><ThemeIcon size={42} radius="md" variant="light" color="lime"><Icon size={23}/></ThemeIcon><Badge variant="light" color={status.color}>{status.label}</Badge></Group>
                <Title order={3} fz="md" mt="md">{p.title}</Title><Text size="sm" c="dimmed" mt="xs" className="ray-extension-description">{p.description}</Text>
                {status.detail&&<Text size="xs" c="dimmed" mt="sm">{status.detail}</Text>}
                <Group justify="space-between" mt="lg"><Text size="xs" c="dimmed">Встроено{status.version?' · '+status.version:''}</Text><Button aria-label={'Настроить: '+p.title} size="compact-sm" variant="subtle" rightSection={<ArrowRight size={15}/>} disabled={!status.available} onClick={()=>onOpen(p.id)}>Настроить</Button></Group>
              </Card>;
            })}
            {tab!=='builtins'&&packages.map((p:any)=><Card key={p.id} className="ray-extension-card" withBorder radius="lg" padding="lg">
              <Group justify="space-between"><ThemeIcon size={42} radius="md" variant="light" color="lime"><Boxes size={23}/></ThemeIcon><Badge variant="light">Установлено</Badge></Group>
              <Title order={3} fz="md" mt="md">{p.name}</Title><Text size="sm" c="dimmed" mt="xs" className="ray-extension-description">{p.description||'Дополнительные эффекты и матрицы устройств.'}</Text>
              <Text size="xs" c="dimmed" mt="sm">Эффекты: {p.effects.length} · Матрицы: {p.templates?.length??0}</Text>
              <Group justify="space-between" mt="lg"><Text size="xs" c="dimmed">{p.author||'Автор не указан'} · {p.version}</Text>{p.effects.length>0&&<Button size="compact-sm" variant="subtle" rightSection={<ArrowRight size={15}/>} onClick={onEffects}>К эффектам</Button>}</Group>
              {p.license&&<Text size="xs" c="dimmed" mt="xs">Лицензия: {p.license}</Text>}
            </Card>)}
          </SimpleGrid>}
          {!count&&<Stack align="center" py="xl" gap="sm"><Boxes size={30}/><Text fw={500}>{query?'Ничего не нашлось':'Пока нет своих пакетов'}</Text><Text size="sm" c="dimmed" ta="center">{query?'Попробуйте другое название или уберите фильтр.':'Установите пакет из папки с manifest.json.'}</Text>{query&&<Button variant="subtle" onClick={()=>changeQuery('')}>Очистить поиск</Button>}</Stack>}
        </>}
      </Tabs.Panel>)}
    </Tabs>
    {s.state?.pluginErrors?.map((p:any)=><Alert color="red" key={p.folder} title="Пакет не загрузился"><Text size="sm">{p.folder}: {p.error}</Text><Text size="sm" mt="xs">Исправьте пакет и обновите список.</Text></Alert>)}
    <Accordion variant="separated"><Accordion.Item value="authors"><Accordion.Control icon={<Code2 size={19}/>}>Для авторов расширений</Accordion.Control><Accordion.Panel><Stack gap="md"><Text size="sm">Начните с HTML-эффекта: нарисуйте свет на Canvas, добавьте параметры и проверьте результат в предпросмотре.</Text><Text size="sm" c="dimmed">Для пакета создайте manifest.json с названием, версией, автором и лицензией. SDK поддерживает формулы эффектов, их настройки и матрицы устройств.</Text><Button variant="light" leftSection={<Code2 size={16}/>} style={{alignSelf:'flex-start'}} onClick={onCreate}>Открыть студию эффектов</Button></Stack></Accordion.Panel></Accordion.Item></Accordion>
  </Stack>;
}
