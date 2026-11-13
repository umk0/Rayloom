export const effectsId='org.openrgb.openrgbeffectsplugin';
export function effectProfile({effect='RainbowWave',speed=40,brightness=100,frequency=10,colors=[16711680,65280,255],devices=[]}={}) {
  if(!['RainbowWave','Breathing','SpectrumCycling'].includes(effect)) throw new Error('Unsupported effect');
  for(const [name,value,min,max] of [['speed',speed,effect==='Breathing'?10:1,effect==='Breathing'?200:100],['brightness',brightness,0,100],['frequency',frequency,1,50]])
    if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${name}`);
  if(!Array.isArray(colors)||!colors.length||colors.length>16||colors.some(c=>!Number.isInteger(c)||c<0||c>0xffffff))throw new Error('Invalid colors');
  if(!Array.isArray(devices)||!devices.length)throw new Error('Select at least one device');
  const zones=devices.flatMap(d=>Array.from({length:d.zoneCount},(_,zone_idx)=>({zone_idx,reverse:false,self_brightness:100,name:d.name,location:d.location,serial:d.serial,description:d.description,version:d.version,vendor:d.vendor,is_segment:false,segment_idx:-1})));
  // These effects expose no generic UserColors slots. Breathing stores its
  // palette in custom settings; rainbow effects generate their own colors.
  const custom=effect==='Breathing'?{colors:[...colors]}:effect==='SpectrumCycling'?{saturation:255}:{};
  return {version:2,Effects:[{EffectClassName:effect,CustomName:'Rayloom scene',AutoStart:true,FPS:30,Speed:speed,Slider2Val:effect==='RainbowWave'?frequency:1,RandomColors:false,AllowOnlyFirst:false,Brightness:brightness,Temperature:0,Tint:0,UserColors:[],ControllerZones:zones,SelectAll:false,CustomSettings:custom}]};
}
