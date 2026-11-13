// SPDX-License-Identifier: GPL-2.0-or-later
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPortableRelease} from '../shared/portable-release.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{
 const result=buildPortableRelease(root);
 console.log(`${result.status}: Rayloom ${result.version} (${result.files} files) at ${result.current}`);
}catch(error){console.error(error.stack??error.message);process.exitCode=1;}
