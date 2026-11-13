import {setTimeout as delay} from 'node:timers/promises';

// Elevation changes the existing owner only when its privilege actually needs
// changing. Permission cancellation must leave the current playback running.
export async function changeRuntimeAccess({operation,getRuntime,getHardware,command,shutdown,reconnect,reload,onPhase=()=>{},sleep=delay,now=Date.now,readyTimeoutMs=110000}) {
 if(!['StartOnce','Register','Remove'].includes(operation))throw Error('Неизвестная настройка запуска.');
 const confirmed=async(requireElevated=false)=>{
  const deadline=now()+readyTimeoutMs;
  do {
   const runtime=await getRuntime();
   if(runtime.error)throw Error('Движок не готов: '+runtime.error);
   if(runtime.ready){
    const hardware=await getHardware();
    if(!hardware.starting){
     if(requireElevated&&hardware.elevated!==true)throw Error('Windows завершила запрос, но доступ к RGB-памяти не подтверждён. Настройки автозапуска сохранены.');
     return {...runtime,hardware};
    }
   }
   onPhase('detecting');await sleep(250);
  }while(now()<deadline);
  throw Error('Движок ещё ищет устройства. Обновите состояние через несколько секунд.');
 };
 const current=await confirmed();
 if(current.mode!=='hardware')throw Error('Эта настройка доступна после подключения реальных устройств.');
 if(operation==='StartOnce'&&current.hardware.elevated===true)return current;
 if(operation==='Register'&&current.settings.autoStart&&current.settings.elevatedStartup&&current.hardware.elevated===true)return current;
 if(operation==='Remove'&&!current.settings.elevatedStartup)return current;
 onPhase('permission');
 // Register first, without launching a competing owner. StartOnce delegates its
 // graceful restart to the elevated worker, after Windows approval, not before.
 const outcome=await command(operation,{noStart:operation==='Register',restart:operation==='StartOnce'});
 if(!outcome.ok){
  // A rejected UAC request does not touch the existing connection or playback.
  // For a partial worker failure reconnect only to the already existing owner.
  if(!outcome.cancelled){try{await reconnect({launch:false});}catch{}}
  throw Error(outcome.error||(outcome.cancelled?'Запрос Windows отменён. Настройки не изменены.':'Не удалось изменить настройки. Обновите состояние и повторите.'));
 }
 if(operation==='Remove'){await reload();return confirmed();}
 if(operation==='Register'){
  await reload();
  if(current.hardware.elevated===true)return confirmed(true);
  onPhase('reconnecting');await shutdown();await reconnect({launch:true});
 }else{onPhase('reconnecting');await reconnect({launch:false,wait:true});}
 onPhase('detecting');
 return confirmed(true);
}

// Do not replace a scheduled elevated start with the ordinary registry start,
// or overwrite settings written by the elevated worker with an old cache.
export async function setBasicStartup({settings,enabled,mode,platform,launcherExists,execute,write}) {
 if(mode==='virtual')throw Error('Автозапуск доступен после подключения реальных устройств.');
 if(platform!=='win32')throw Error('Автозапуск пока доступен в Windows.');
 if(settings.elevatedStartup){
  if(enabled&&settings.autoStart)return settings;
  throw Error('Измените автозапуск с доступом к памяти в окне настроек Rayloom.');
 }
 if(settings.autoStart===enabled)return settings;
 if(enabled&&!launcherExists)throw Error('Не найден фоновый запуск Rayloom.');
 await execute(enabled);
 const next={...settings,autoStart:enabled};await write(next);return next;
}
