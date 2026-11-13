const page=(meta,body)=>`<!doctype html>
<html><head><meta charset="utf-8">
${meta}
<style>html,body{margin:0;background:#000;overflow:hidden}canvas{width:100vw;height:100vh;display:block}</style>
</head><body><canvas id="effect" width="128" height="128"></canvas>
<script>
const canvas=document.getElementById('effect'),ctx=canvas.getContext('2d');
const started=performance.now();
function draw(now){
  const t=(now-started)/1000;
  const {parameters:p,events}=window.rayloomEffect?.getState()??{parameters:{speed:1,color:'#a378ef'},events:{health:1}};
${body}
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script></body></html>`;
const controls='<meta property="speed" label="Скорость" type="number" min="0" max="10" step="0.1" default="1">\n<meta property="color" label="Цвет" type="color" default="#a378ef">';
export const canvasTemplates=[
 {id:'wave',name:'Шёлковая волна',source:page(controls,`  ctx.fillStyle='#05040a';ctx.fillRect(0,0,128,128);
  for(let x=0;x<128;x++){
    ctx.globalAlpha=.12+.88*(.5+.5*Math.sin(x/18-t*p.speed*2));
    ctx.fillStyle=p.color;ctx.fillRect(x,0,1,128);
  }
  ctx.globalAlpha=1;`)},
 {id:'aurora',name:'Полярное сияние',source:page('<meta property="speed" label="Скорость" type="number" min="0" max="10" step="0.1" default="1">',`  for(let x=0;x<128;x+=2)for(let y=0;y<128;y+=2){
    const wave=Math.sin(x/28+t*p.speed)+Math.cos(y/25-t*p.speed*.7);
    ctx.fillStyle='hsl('+((wave*55+t*18+240)%360)+' 85% '+(25+12*Math.sin(y/22+t))+'%)';
    ctx.fillRect(x,y,2,2);
  }`)},
 {id:'health',name:'Пульс игры',source:page(controls,`  const health=Math.max(0,Math.min(1,events.health??1));
  ctx.fillStyle='#05040a';ctx.fillRect(0,0,128,128);
  const radius=15+health*55+Math.sin(t*(health<.3?10:2)*p.speed)*8;
  const gradient=ctx.createRadialGradient(64,64,0,64,64,Math.max(1,radius));
  gradient.addColorStop(0,health<.3?'#ff2020':p.color);gradient.addColorStop(1,'#000000');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);`)}
];
