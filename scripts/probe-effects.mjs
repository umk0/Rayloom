import {CoreClient} from '../desktop/core-client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..');
const core=new CoreClient(root,fs.mkdtempSync(path.join(os.tmpdir(),'lumen-catalog-')));
try {
  console.log(await core.start());
  const catalog=await core.call('plugin.rpc',{plugin:'org.openrgb.openrgbeffectsplugin',request:{method:'catalog'}});
  fs.writeFileSync(path.join(root,'artifacts','effects-catalog.json'),JSON.stringify(catalog,null,2));
  console.log(catalog.length,'effects');
  console.log(catalog.map(e=>`${e.id}: ${e.fields.map(f=>`${f.key}(${f.type})`).join(', ')}`).join('\n'));
} finally {await core.stop();}
