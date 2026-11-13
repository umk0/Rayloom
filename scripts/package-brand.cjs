// Asset packaging only. No BrowserWindow, hardware host or application profile.
const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
app.whenReady().then(()=>{
  const dir=path.resolve(__dirname,'../public/brand');
  const source=nativeImage.createFromPath(path.join(dir,'rayloom-icon-source.png'));
  if(source.isEmpty())throw Error('Missing generated Rayloom icon');
  const original=source.getSize();
  if(original.width!==original.height||original.width<1024)throw Error('Expected a square source of at least 1024 pixels');
  const sizes=[16,20,24,32,40,48,64,128,256,512,1024];
  const pngs=new Map(sizes.map(size=>{
    const png=source.resize({width:size,height:size,quality:'best'}).toPNG();
    fs.writeFileSync(path.join(dir,`rayloom-${size}.png`),png);
    return [size,png];
  }));
  const icoSizes=sizes.filter(size=>size<=256);
  const header=Buffer.alloc(6+16*icoSizes.length);
  header.writeUInt16LE(1,2);header.writeUInt16LE(icoSizes.length,4);
  let offset=header.length;
  icoSizes.forEach((size,i)=>{
    const png=pngs.get(size),p=6+i*16;
    header[p]=size===256?0:size;header[p+1]=size===256?0:size;
    header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);
    header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);
    offset+=png.length;
  });
  fs.writeFileSync(path.join(dir,'rayloom.ico'),Buffer.concat([header,...icoSizes.map(size=>pngs.get(size))]));
  // Modern macOS ICNS entries contain the same PNG artwork at native sizes.
  const chunks=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]].map(([type,size])=>{
    const png=pngs.get(size),chunk=Buffer.alloc(8);chunk.write(type);chunk.writeUInt32BE(8+png.length,4);
    return Buffer.concat([chunk,png]);
  });
  const icnsHeader=Buffer.alloc(8);icnsHeader.write('icns');icnsHeader.writeUInt32BE(8+chunks.reduce((n,c)=>n+c.length,0),4);
  fs.writeFileSync(path.join(dir,'rayloom.icns'),Buffer.concat([icnsHeader,...chunks]));
  console.log(`Rayloom icon: ${sizes.length} PNG sizes, ${icoSizes.length} ICO entries, ${chunks.length} ICNS entries.`);
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
