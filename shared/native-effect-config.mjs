// The same generic controls feed both real output and the native preview.
import {applyNativeEffectParameters} from './effect-parameters.mjs';
export function nativeEffectSettings(effect, {color, speed, fps,effectParameters={}}) {
 if(!Number.isInteger(color)||color<0||color>0xffffff)throw Error('Invalid native effect color');
 if(!Number.isFinite(speed)||speed<0||speed>10)throw Error('Invalid native effect speed');
 if(!Number.isInteger(fps)||fps<1||fps>240)throw Error('Invalid native effect FPS');
 const settings=structuredClone(effect.defaults);
 settings.Brightness=100;settings.FPS=fps;
 if(settings.UserColors?.length)settings.UserColors[0]=color;
 // Upstream palette-based effects (Breathing, Sequence, CustomMarquee, etc.)
 // store packed RGB colors in this field instead of generic UserColors slots.
 else if(Array.isArray(settings.CustomSettings?.colors)&&settings.CustomSettings.colors.length&&settings.CustomSettings.colors.every(c=>Number.isInteger(c)&&c>=0&&c<=0xffffff))settings.CustomSettings.colors[0]=color;
 if(effect.speedMax>effect.speedMin)settings.Speed=Math.round(effect.speedMin+(effect.speedMax-effect.speedMin)*speed/10);
 applyNativeEffectParameters(effect,settings,effectParameters['openrgb:'+effect.id]??{});
 // Simple Studio and its preview share automatic system-output selection.
 // Raw advanced profiles keep upstream -1 = disabled semantics.
 if(settings.CustomSettings?.audio_settings?.audio_device===-1&&Number.isInteger(effect.audioDefaultDevice)&&effect.audioDefaultDevice>=0)settings.CustomSettings.audio_settings.audio_device=effect.audioDefaultDevice;
 return settings;
}
