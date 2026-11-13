import {hsv,scaleColor} from './spatial.mjs';

// Shared by the native background renderer and the tiny, local library previews.
export const BUILTIN_EFFECTS = [
 {id:'aurora',name:'Полярное сияние',description:'Ленты мятного и фиолетового света',category:'ambient',controls:['speed','scale']},
 {id:'nebula',name:'Туманность',description:'Медленно плывущее цветное облако',category:'ambient',controls:['speed','scale']},
 {id:'meteor',name:'Метеорный поток',description:'Светящиеся следы сквозь пространство',category:'dynamic',controls:['speed','scale']},
 {id:'ember',name:'Тёплый пепел',description:'Угли, искры и мягкое живое тепло',category:'ambient',controls:['speed','scale']},
 {id:'prism',name:'Призма',description:'Пересечение цветных граней',category:'dynamic',controls:['speed','scale']},
 {id:'tidal',name:'Прилив',description:'Бирюзовые волны и свет под водой',category:'ambient',controls:['speed','scale']},
 {id:'fireflies',name:'Светлячки',description:'Редкие огоньки в ночном воздухе',category:'ambient',controls:['speed','scale']},
 {id:'orbit',name:'Орбиты',description:'Вращающиеся световые рукава',category:'dynamic',controls:['speed','scale']},
 {id:'rainbow',name:'Спектр',description:'Радуга через всё пространство',category:'classic',controls:['speed','scale']},
 {id:'wave',name:'Волна',description:'Движение выбранного цвета',category:'classic',controls:['color','speed','scale']},
 {id:'breathing',name:'Дыхание',description:'Спокойная общая пульсация',category:'classic',controls:['color','speed']},
 {id:'solid',name:'Один цвет',description:'Постоянный выбранный цвет',category:'classic',controls:['color']},
 {id:'ripple',name:'Сфера',description:'Объёмная волна от центра',category:'classic',controls:['speed','scale']},
];
const TAU=Math.PI*2,unit=v=>Math.max(0,Math.min(1,v));
const fract=v=>v-Math.floor(v);
const hash=v=>fract(Math.sin(v*127.1+311.7)*43758.5453123);
const mix=(a,b,f)=>{f=unit(f);return Math.round((a&255)*(1-f)+(b&255)*f)|(Math.round(((a>>8)&255)*(1-f)+((b>>8)&255)*f)<<8)|(Math.round(((a>>16)&255)*(1-f)+((b>>16)&255)*f)<<16);};

export function sampleBuiltin(effect,p,config,t,index=0){
 const size=Math.max(1,config.scale),x=p.x/size,y=p.y/size,z=p.z/size,time=t*config.speed;
 const phase=x+y*.4+z*.6-time*.15;
 if(effect==='solid')return config.color;
 if(effect==='breathing')return scaleColor(config.color,.2+.8*(.5+.5*Math.sin(time*2)));
 if(effect==='ripple')return hsv(Math.hypot(x,y,z)-time*.2);
 if(effect==='wave')return scaleColor(config.color,.1+.9*(.5+.5*Math.sin(phase*TAU)));
 if(effect==='aurora'){
  const curtain=Math.sin(x*5+Math.sin(y*3+time*.23)*1.8+z*2-time*.4);
  const light=.12+.88*Math.pow(.5+.5*curtain,2.3);
  return hsv(.43+.32*(.5+.5*Math.sin(x*1.7+y*.8+time*.17)),.72,light);
 }
 if(effect==='nebula'){
  const cloud=(Math.sin(x*3.1+time*.16)+Math.sin(y*4.4-z*2-time*.21)+Math.sin((x+y+z)*2.3+time*.12))/3;
  return hsv(.64+.17*Math.sin(cloud*3+time*.08),.65,.15+.75*Math.pow(.5+.5*cloud,1.25));
 }
 if(effect==='meteor'){
  const lane=Math.floor((y+z*.55)*6),seed=hash(lane);
  const tail=fract(x*.7+z*.35-time*(.22+seed*.16)+seed);
  const light=tail<.27?Math.pow(1-tail/.27,2):0;
  return mix(hsv(.58+seed*.17,.85,.025+light*.8),0xffffff,Math.pow(light,8)*.7);
 }
 if(effect==='ember'){
  const noise=.5+.5*Math.sin(x*7+y*5+time*1.7)*Math.sin(y*11-z*6-time*1.1);
  const spark=Math.pow(.5+.5*Math.sin(time*(1+hash(index)*.8)+hash(index)*TAU),20);
  return hsv(.015+noise*.065,.92,.06+noise*.44+spark*.45);
 }
 if(effect==='prism'){
  const a=Math.sin((x*.8+y*.6+z*.3)*TAU-time*.7),b=Math.sin((x*.3-y*.8+z*.5)*TAU+time*.43);
  return hsv((x*.5-y*.22+z*.33)+time*.035,.72,.22+.78*Math.pow((a+b+2)/4,1.7));
 }
 if(effect==='tidal'){
  const waves=Math.sin(Math.hypot(x+.6,y-.2,z*.6)*11-time*.85)+Math.sin(x*7-y*9+z*3+time*.51);
  const light=Math.pow((waves+2)/4,3);
  return mix(hsv(.51+.05*Math.sin(y+time*.09),.88,.07+light*.75),0xf5ffee,light*.35);
 }
 if(effect==='fireflies'){
  const seed=hash(index+Math.floor(x*13)+Math.floor(y*17)*37),pulse=Math.pow(.5+.5*Math.sin(time*(.7+seed*.6)+seed*TAU),12);
  return hsv(.12+seed*.19,.65,seed>.47?.018+pulse*.95:.012);
 }
 if(effect==='orbit'){
  const radius=Math.hypot(x,y,z*.6),angle=Math.atan2(y,x);
  const arm=Math.pow(.5+.5*Math.sin(angle*3+radius*8-time*.9+z*3),6);
  return hsv(.55+radius*.24-time*.04,.75,.035+arm*.965);
 }
 return hsv(phase);
}
