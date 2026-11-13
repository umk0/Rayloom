import {normalizeSceneConfig} from './scene-config.mjs';

// Layout is available before the background agent restores playback. Hydrate
// them independently; a local intent always wins over a later startup poll.
export class StudioHydration {
 constructor(){this.epoch=0;this.reset();}
 reset(mode=null){this.epoch++;this.mode=mode;this.layoutLoaded=false;this.configLoaded=false;this.configRevision=0;}
 editConfig(){this.configLoaded=true;return ++this.configRevision;}
 ownLayout(){this.layoutLoaded=true;}
 token(){return {epoch:this.epoch,revision:this.configRevision};}
 isCurrent(token){return token.epoch===this.epoch&&token.revision===this.configRevision;}
 observe(state,token){
  if(token.epoch!==this.epoch)return {stale:true};
  const mode=state.mode??this.mode;
  const modeChanged=!!this.mode&&!!mode&&this.mode!==mode;
  if(modeChanged)this.reset(mode);else if(mode)this.mode=mode;
  const updates={stale:false,modeChanged};
  if(!this.layoutLoaded&&state.layout){this.layoutLoaded=true;updates.layout=state.layout;}
  // Null is an intermediate startup state, not a decision to use the defaults.
  if(!this.configLoaded&&state.current){
   try{const config=normalizeSceneConfig(state.current);this.configLoaded=true;updates.config=config;}
   catch(error){updates.configError=error instanceof Error?error.message:String(error);}
  }
  return updates;
 }
}
