import fs from 'node:fs';
import path from 'node:path';

// Source checkout and the portable package use different Electron locations.
// Resolve from this build's root so an HTML effect never starts an old version.
export function electronHostExecutable(root,{platform=process.platform,exists=fs.existsSync}={}){
 const name=platform==='win32'?'electron.exe':'electron';
 const candidates=[
  path.join(root,'node_modules','electron','dist',name),
  path.join(root,'..','electron',name)
 ];
 const found=candidates.find(exists);
 if(!found)throw Error('Electron host is missing for HTML effects. Restore the Rayloom installation.');
 return found;
}
