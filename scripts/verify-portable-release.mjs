import path from 'node:path';
import {verifyPackage} from '../shared/portable-release.mjs';
const target=process.argv[2];
if(!target||!path.isAbsolute(target))throw Error('Absolute release directory is required');
const value=verifyPackage(target);
console.log(`Verified Rayloom ${value.version}: ${value.files.length} files`);
