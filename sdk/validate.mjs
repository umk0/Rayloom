import fs from 'node:fs';import {validateManifest} from './runtime.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node sdk/validate.mjs <manifest.json>');
const m=validateManifest(JSON.parse(fs.readFileSync(file,'utf8')));console.log(`${m.id}@${m.version}: valid; ${m.effects.length} effect(s)`);
