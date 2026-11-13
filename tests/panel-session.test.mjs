import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasEditorSession,PluginDraftSession,canRunPluginCommand,readUnchangedCanvasDocument,validateEditorSource,normalizeCodePreferences,MAX_EDITOR_SOURCE} from '../shared/panel-session.mjs';

const base=()=>({config:{ip:'127.0.0.1',port:18765,hooks:[]},running:false,profiles:['First']});
test('plugin navigation restores editable draft while retaining current server telemetry',()=>{
  const store=new PluginDraftSession(),server=base(),draft=structuredClone(server);draft.config.port=18766;
  store.write('hardware','http-hook',server,draft);
  const restored=store.restore('hardware','http-hook',{...server,running:true,profiles:['First','Second']});
  assert.equal(restored.draft.config.port,18766);assert.equal(restored.draft.running,true);assert.deepEqual(restored.draft.profiles,['First','Second']);assert.equal(restored.conflict,false);
  restored.draft.config.port=1;assert.equal(store.restore('hardware','http-hook',server).draft.config.port,18766,'restored objects must not mutate cached data');
});
test('plugin drafts never cross hardware and virtual modes or plugin ids',()=>{
  const store=new PluginDraftSession(),server=base();store.write('hardware','http-hook',server,{...server,config:{...server.config,port:19000}});
  assert.equal(store.restore('virtual','http-hook',server),null);assert.equal(store.restore('hardware','e131',server),null);assert.equal(store.restore('unknown','http-hook',server),null);
});
test('server edits are surfaced as a conflict without dropping the local draft',()=>{
  const store=new PluginDraftSession(),server=base();store.write('hardware','http-hook',server,{...server,config:{...server.config,port:19000}});
  const restored=store.restore('hardware','http-hook',{...server,config:{...server.config,port:19001}});
  assert.equal(restored.conflict,true);assert.equal(restored.draft.config.port,19000);
});
test('late save acknowledgement cannot erase a newer draft after navigation',()=>{
  const store=new PluginDraftSession(),server=base(),first={...server,config:{...server.config,port:19000}},second={...server,config:{...server.config,port:19001}};
  store.write('hardware','http-hook',server,first);store.write('hardware','http-hook',server,second);store.acknowledge('hardware','http-hook',first);
  assert.equal(store.restore('hardware','http-hook',server).draft.config.port,19001);
  store.acknowledge('hardware','http-hook',second);assert.equal(store.restore('hardware','http-hook',server),null);
});
test('explicit discard and reverting fields to baseline remove only the intended draft',()=>{
  const store=new PluginDraftSession(),server=base(),draft={...server,config:{...server.config,port:19000}};
  store.write('hardware','http-hook',server,draft);store.write('virtual','http-hook',server,draft);store.clear('hardware','http-hook');
  assert.equal(store.restore('hardware','http-hook',server),null);assert(store.restore('virtual','http-hook',server));
  store.write('virtual','http-hook',server,server);assert.equal(store.restore('virtual','http-hook',server),null);
});
test('scheduler next-run telemetry does not turn restored work into a conflict',()=>{
  const store=new PluginDraftSession(),server={tasks:[{name:'Night',cron_line:'0 0 20 * * ?',run:true,next_run_ms:1}]};
  store.write('hardware','scheduler',server,{tasks:[{...server.tasks[0],name:'Evening'}]});
  const restored=store.restore('hardware','scheduler',{tasks:[{...server.tasks[0],next_run_ms:99}]});
  assert.equal(restored.conflict,false);assert.equal(restored.draft.tasks[0].name,'Evening');
});
test('Canvas navigation retains preview ownership, compiled source, group and view per mode',()=>{
  const session=new CanvasEditorSession();session.write('hardware',{target:'preview',compiledSource:'<canvas/>',view:'split',outputGroup:'desk'});session.write('hardware',{view:'preview'});
  const restored=session.read('hardware');assert.deepEqual(restored,{target:'preview',compiledSource:'<canvas/>',view:'preview',outputGroup:'desk'});assert.deepEqual(session.read('virtual'),{});
  restored.target='output';assert.equal(session.read('hardware').target,'preview');
});
test('oversized code produces an actionable error without silently truncating user text',()=>{
  const source='x'.repeat(MAX_EDITOR_SOURCE)+'tail';assert.match(validateEditorSource(source),/не обрезан/);assert(source.endsWith('tail'));assert.equal(validateEditorSource('x'.repeat(MAX_EDITOR_SOURCE)),'');assert(validateEditorSource(null));
});
test('editor preferences survive valid values and clamp malformed persisted values',()=>{
  assert.deepEqual(normalizeCodePreferences({fontSize:18,wordWrap:false}),{fontSize:18,wordWrap:false});assert.deepEqual(normalizeCodePreferences(null),{fontSize:14,wordWrap:true});
  assert.equal(normalizeCodePreferences({fontSize:500}).fontSize,22);assert.equal(normalizeCodePreferences({fontSize:1}).fontSize,12);assert.equal(normalizeCodePreferences({fontSize:'large'}).fontSize,14);
});
test('late imported document cannot overwrite edits made while reading the file',async()=>{
  let revision=1,resolve;const pending=new Promise(done=>{resolve=done;});
  const read=readUnchangedCanvasDocument(()=>pending,()=>revision);revision++;
  resolve({name:'Imported',source:'<canvas/>'});await assert.rejects(read,/Код изменился/);
  const next={name:'Saved',source:'<canvas/>'};assert.equal(await readUnchangedCanvasDocument(async()=>next,()=>revision),next);
  assert.equal(await readUnchangedCanvasDocument(async()=>{revision++;return null;},()=>revision),null,'cancelled file dialog keeps the current draft silently');
});
test('automatic map and startup cannot replace dirty drafts; Apply and Stop remain explicit',()=>{
  for(const method of ['automap','start','run'])assert.equal(canRunPluginCommand(false,true,method),false);
  assert.equal(canRunPluginCommand(false,true,'config.set'),true);assert.equal(canRunPluginCommand(false,true,'stop'),true);
  assert.equal(canRunPluginCommand(false,false,'automap'),true);assert.equal(canRunPluginCommand(true,false,'automap'),false);
});
