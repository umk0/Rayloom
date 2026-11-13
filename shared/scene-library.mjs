import {validateLayout} from './spatial.mjs';
import {normalizeSceneConfig} from './scene-config.mjs';

export function sceneNameError(value){
  if(typeof value!=='string'||!value.trim())return 'Укажите название сцены.';
  const name=value.trim();
  if(name.length>100)return 'Название должно быть не длиннее 100 символов.';
  if(/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[.]$/.test(name)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))return 'Используйте буквы, цифры и пробелы; не заканчивайте название точкой.';
  return null;
}

export function createSceneRecord({name,layout,config}){
  const error=sceneNameError(name);if(error)throw Error(error);
  const record={name:name.trim(),layout:structuredClone(validateLayout(layout)),config:normalizeSceneConfig(config)};
  if(!record.layout.groups.some(group=>group.id===record.config.group))throw Error('Выберите существующую группу перед сохранением сцены.');
  return structuredClone(record);
}

export function upsertSceneRecord(records,record,{replace=false}={}){
  const previous=records.find(item=>item.name===record.name);
  if(previous&&!replace)throw Error('Сцена с таким названием уже существует. Подтвердите замену или выберите другое название.');
  return [...records.filter(item=>item.name!==record.name),record];
}

export function sceneFingerprint(layout,config){return JSON.stringify({layout,config:normalizeSceneConfig(config)});}
