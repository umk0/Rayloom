import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');

test('active brand assets and entry pages use Rayloom',()=>{
 const brand=path.join(root,'public','brand');
 const files=fs.readdirSync(brand);
 assert.ok(files.length>0);
 assert.ok(files.every(name=>name.startsWith('rayloom')),'old brand image remains in public/brand');
 for(const page of ['index.html','legacy.html']){
  const html=fs.readFileSync(path.join(root,page),'utf8');
  assert.match(html,/brand\/rayloom-32\.png/);
  assert.doesNotMatch(html,/brand\/lumen/i);
 }
 for(const file of ['src/StudioApp.tsx','src/AdvancedWorkbench.tsx','src/mantine/NativeSceneEditor.tsx']){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(source,/LumenRGB|brand\/lumen/i,`old visible brand remains in ${file}`);
 }
});
