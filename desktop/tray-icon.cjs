const zlib=require('node:zlib');
function crc(b){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const tag=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,sum]);}
const h=Buffer.alloc(13);h.writeUInt32BE(32,0);h.writeUInt32BE(32,4);h[8]=8;h[9]=6;
const p=Buffer.alloc(32*(1+32*4));for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=y*129+1+x*4;const on=(x-16)**2+(y-13)**2<94||(x>11&&x<21&&y>13&&y<27);p[i]=180;p[i+1]=241;p[i+2]=123;p[i+3]=on?255:0;}
module.exports=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(p)),chunk('IEND',Buffer.alloc(0))]);
