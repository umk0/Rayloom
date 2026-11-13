export const builtInExtensions = [
  {id:'effects',nativeId:'org.openrgb.openrgbeffectsplugin',title:'Слои эффектов',description:'Соберите световую композицию из эффектов, GIF и шейдеров.',icon:'effects'},
  {id:'visual-map',nativeId:'org.openrgb.openrgbvisualmapplugin',title:'Карты и градиенты',description:'Создавайте цветовые переходы и карты освещения.',icon:'map'},
  {id:'hardware-sync',nativeId:'org.openrgb.openrgbhardwaresyncplugin',title:'Свет по датчикам',description:'Показывайте температуру и нагрузку цветом подсветки.',icon:'hardware'},
  {id:'scheduler',nativeId:'org.openrgb.openrgbschedulerplugin',title:'Расписание',description:'Запускайте любимые сцены в нужное время.',icon:'schedule'},
  {id:'http-hook',nativeId:'org.openrgb.openrgbhttphookplugin',title:'События приложений',description:'Меняйте свет по командам из других программ.',icon:'events'},
  {id:'e131',nativeId:'org.openrgb.openrgbe131receiverplugin',title:'Световая сеть',description:'Принимайте световые сцены по сети E1.31.',icon:'network'},
  {id:'skin',nativeId:'org.openrgb.openrgbskinplugin',title:'Оформление',description:'Настройте цвета интерфейса под своё пространство.',icon:'theme'},
];

export function nativeExtensionState(extension,snapshot){
  const plugin=snapshot?.plugins?.find(p=>p.id===extension.nativeId);
  const version=plugin?.version?String(plugin.version):'';
  if(snapshot?.error)return {available:false,label:'Нет связи',color:'red',detail:'Дождитесь подключения к устройствам.',version};
  if(plugin?.incompatible)return {available:false,label:'Несовместимо',color:'red',detail:'Для этой версии Rayloom нужна совместимая сборка расширения.',version};
  if(plugin?.loaded)return {available:true,label:'Доступно',color:'green',detail:'',version};
  if(snapshot?.starting||!snapshot?.status?.pluginsReady)return {available:false,label:'Загружается',color:'gray',detail:'Расширение появится после запуска движка.',version};
  return {available:false,label:'Недоступно',color:'yellow',detail:'Расширение не загрузилось. Проверьте установку Rayloom и перезапустите приложение.',version};
}

export function matchesExtension(query,...values){
  const terms=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack=values.filter(Boolean).join(' ').toLocaleLowerCase();
  return terms.every(term=>haystack.includes(term));
}
