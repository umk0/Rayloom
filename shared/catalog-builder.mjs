import {createHash} from 'node:crypto';

export const sha256 = text => createHash('sha256').update(text).digest('hex');

export function parseSupportCsv(source) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(c==='"') {if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===','||c==='\n')) {row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){rows.push(row);row=[];}}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}
  if(quoted)throw Error('Unterminated CSV quote');
  const headers=rows.shift();
  if(headers?.[0]!=='Name'||!headers.includes('RGBController'))throw Error('Unexpected upstream catalog format');
  return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}

// Preserve quoted strings and line positions while removing C/C++ comments.
const uncomment = source => source.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
  token=>token.startsWith('"')?token:token.replace(/[^\n]/g,' '));

export function extractDetectors(source, sourcePath) {
  const text=uncomment(source), records=[];
  for(const match of text.matchAll(/^[ \t]*(REGISTER_(?:HID|I2C|USB|DETECTOR|SERIAL|NETWORK)[A-Z0-9_]*)\s*\(\s*("(?:\\.|[^"\\])*")/gm)) {
    const Name=JSON.parse(match[2]);
    if(!Name.trim())continue;
    const macro=match[1],transport=macro.includes('HID')?'USB HID':macro.includes('I2C')?'SMBus / I2C':macro.includes('USB')?'USB':macro.includes('SERIAL')?'Serial':'Other';
    records.push({Name,Category:transport,Type:'Registered detector',RGBController:sourcePath.split('/').slice(2,-1).join('/'),Direct:'Runtime check',SourceId:'openrgb-core',Support:'registered-detector',Geometry:'runtime-controller',
      provenance:{path:sourcePath,line:text.slice(0,match.index).split('\n').length,sha256:sha256(source),license:'GPL-2.0-or-later'},registration:macro});
  }
  return records;
}

export function extractLiteralMatrices(source, sourcePath) {
  const text=uncomment(source), templates=[];
  // Runtime formulas, enums and unknown constants stay in core. Extracted
  // variants still need confirmation against the controller selected at runtime.
  const regex=/\b(?:static\s+)?(?:const\s+)?(?:unsigned\s+int|uint(?:8|16|32)_t|int)\s+(\w*[Mm]atrix\w*)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]\s*=\s*\{([\s\S]*?)\}\s*;/g;
  for(const match of text.matchAll(regex)) {
    const rows=Number(match[2]),columns=Number(match[3]);
    if(!rows||!columns||rows*columns>16384)continue;
    const rowTexts=[...match[4].matchAll(/\{([^{}]*)\}/g)].map(m=>m[1]);
    if(rowTexts.length!==rows)continue;
    const values=rowTexts.map(row=>row.split(',').map(v=>v.trim()).filter(Boolean));
    if(values.some(row=>row.length!==columns))continue;
    const knownEmptyNA=/^\s*#define\s+NA\s+(?:0x[fF]{8}|UINT_MAX|UINT32_MAX)\b/m.test(text);
    if(values.flat().some(v=>!(/^(?:0x[\da-fA-F]+|\d+)$/.test(v)||knownEmptyNA&&v==='NA')))continue;
    const matrix=values.map(row=>row.map(v=>v==='NA'||Number(v)===0xffffffff?null:Number(v)));
    const indices=[...new Set(matrix.flat().filter(v=>v!==null))];
    if(!indices.length||indices.some(v=>v<0||v>65535))continue;
    templates.push({id:sha256(sourcePath+'#'+match[1]).slice(0,20),name:match[1],controllerFamily:sourcePath.split('/').slice(2,-1).join('/'),rows,columns,matrix,
      ledCount:indices.length,requiredLedCount:Math.max(...indices)+1,sourceId:'openrgb-core',status:'template-needs-confirmation',
      provenance:{path:sourcePath,line:text.slice(0,match.index).split('\n').length,sha256:sha256(source),license:'GPL-2.0-or-later'}});
  }
  return templates;
}

export function consolidateDetectors(records) {
  const grouped=new Map();
  for(const record of records) {
    const key=record.Name+'\0'+record.RGBController;
    if(grouped.has(key))grouped.get(key).variants.push(record.provenance);
    else grouped.set(key,{...record,variants:[record.provenance]});
  }
  return [...grouped.values()].sort((a,b)=>a.Name.localeCompare(b.Name,'en'));
}
