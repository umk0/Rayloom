const topics=new Set(['start','parameters','api','errors']);

export function normalizeAuthorHelp(value){
  return {topic:topics.has(value?.topic)?value.topic:'start',step:Number.isInteger(value?.step)?Math.max(0,Math.min(2,value.step)):0};
}

/** Exploring several examples always retains the author's original work. */
export function openCanvasExample(current,template,previous){
  if(!template||typeof template.name!=='string'||typeof template.source!=='string')throw Error('Этот пример недоступен.');
  const document={name:template.name,source:template.source};
  const same=current.name===document.name&&current.source===document.source;
  return {document,previous:previous??(same?null:structuredClone(current))};
}

/** Only real, current Monaco errors/warnings become clickable source locations. */
export function canvasDiagnostics(markers,modelVersion){
  if(!Array.isArray(markers))return [];
  return markers.filter(marker=>marker&&(marker.severity===8||marker.severity===4)
    &&typeof marker.message==='string'&&marker.message.trim()
    &&Number.isInteger(marker.startLineNumber)&&marker.startLineNumber>0
    &&Number.isInteger(marker.startColumn)&&marker.startColumn>0
    &&(marker.modelVersionId===undefined||marker.modelVersionId===modelVersion))
    .map(marker=>({message:marker.message,line:marker.startLineNumber,column:marker.startColumn,severity:marker.severity===8?'error':'warning'}))
    .sort((a,b)=>a.line-b.line||a.column-b.column);
}
