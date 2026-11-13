import {parentPort} from 'node:worker_threads';
import {renderSpatialFrame,sampleCanvasFrame,projectSampleIndices,calibratePackedFrame} from './frame-renderer.mjs';
let points=[],config={},effect;
let canvasSize='',canvasIndices;
parentPort.on('message',message=>{
 try{
  if(message.type==='init'){({points,config,effect}=message);parentPort.postMessage({id:message.id,ready:true});return;}
  const started=performance.now();let colors;
  if(message.kind==='native')colors=calibratePackedFrame(points,config,message.colors);
  else if(message.kind==='canvas'){
   const size=message.frame.width+'x'+message.frame.height;
   if(size!==canvasSize){canvasSize=size;canvasIndices=projectSampleIndices(points,message.frame.width,message.frame.height,config.projection);}
   colors=sampleCanvasFrame(points,config,message.frame,canvasIndices);
  }else colors=renderSpatialFrame(points,config,message.events,message.t,effect);
  parentPort.postMessage({id:message.id,colors,renderMs:performance.now()-started},[colors.buffer]);
 }catch(e){parentPort.postMessage({id:message.id,error:e.message});}
});
