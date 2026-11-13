import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeEffectSettings} from '../shared/native-effect-config.mjs';

test('native output and preview use identical bounded generic controls without mutating defaults',()=>{
 const effect={speedMin:1,speedMax:100,defaults:{Brightness:70,FPS:60,Speed:10,UserColors:[5,6],CustomSettings:{colors:[7,8]}}};
 const result=nativeEffectSettings(effect,{color:255,speed:4,fps:30});
 assert.equal(result.Speed,41);assert.equal(result.FPS,30);assert.equal(result.Brightness,100);
 assert.deepEqual(result.UserColors,[255,6]);assert.deepEqual(result.CustomSettings,{colors:[7,8]});
 assert.equal(effect.defaults.UserColors[0],5);assert.equal(effect.defaults.Speed,10);
 for(const override of [{color:-1},{color:0x1000000},{color:1.5},{speed:NaN},{speed:11},{fps:0},{fps:241}])assert.throws(()=>nativeEffectSettings(effect,{color:0,speed:1,fps:60,...override}));
});

test('palette-based native effects use selected color without inventing extra palette entries',()=>{
 const effect={speedMin:1,speedMax:20,defaults:{UserColors:[],CustomSettings:{colors:[0,65280]}}};
 const settings=nativeEffectSettings(effect,{color:255,speed:1,fps:60});
 assert.deepEqual(settings.CustomSettings.colors,[255,65280]);
 assert.deepEqual(effect.defaults.CustomSettings.colors,[0,65280]);
 const sentinel={...effect,defaults:{UserColors:[],CustomSettings:{colors:[-1]}}};
 assert.deepEqual(nativeEffectSettings(sentinel,{color:255,speed:1,fps:60}).CustomSettings.colors,[-1]);
});

test('simple output and previews select the system loopback while raw defaults remain disabled',()=>{
 const effect={id:'AudioSync',audioDefaultDevice:4,defaults:{UserColors:[1],CustomSettings:{audio_settings:{audio_device:-1}}}};
 const settings=nativeEffectSettings(effect,{color:255,speed:1,fps:60});
 assert.equal(settings.CustomSettings.audio_settings.audio_device,4);
 assert.equal(effect.defaults.CustomSettings.audio_settings.audio_device,-1);
 assert.equal(nativeEffectSettings({...effect,audioDefaultDevice:-1},{color:255,speed:1,fps:30}).CustomSettings.audio_settings.audio_device,-1);
});
