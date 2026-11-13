export const CHANNEL_ORDERS=Object.freeze(['RGB','RBG','GRB','GBR','BRG','BGR']);
export const DEFAULT_CALIBRATION=Object.freeze({channelOrder:'RGB',brightness:100});
export const CALIBRATION_PROBES=Object.freeze(['R','G','B']);
export function inferChannelOrder(observed){
 if(!Array.isArray(observed)||observed.length!==3||observed.some(c=>!CALIBRATION_PROBES.includes(c))||new Set(observed).size!==3)throw Error('Для коррекции нужны три разных основных цвета: красный, зелёный и синий.');
 // observed[i] is the physical color lit by raw wire channel i. Feeding that
 // logical channel into wire i is precisely the inverse correction we need.
 return observed.join('');
}
export function normalizeCalibration(value={}){
 if(!value||typeof value!=='object'||!CHANNEL_ORDERS.includes(value.channelOrder??'RGB'))throw Error('Выберите допустимый порядок цветовых каналов.');
 const brightness=value.brightness??100;
 if(!Number.isFinite(brightness)||brightness<0||brightness>100)throw Error('Яркость компонента должна быть от 0 до 100%.');
 return {channelOrder:value.channelOrder??'RGB',brightness};
}
export function calibrateColor(color,value=DEFAULT_CALIBRATION){
 const order=value.channelOrder??'RGB',gain=(value.brightness??100)/100;
 const channels={R:color&255,G:(color>>>8)&255,B:(color>>>16)&255};
 return Math.round(channels[order[0]]*gain)|(Math.round(channels[order[1]]*gain)<<8)|(Math.round(channels[order[2]]*gain)<<16);
}
// Preview logical R/G/B while retaining the real output brightness. Reversing
// the wire order is lossless; reversing attenuation would invent lost detail.
export function logicalColor(color,value=DEFAULT_CALIBRATION){
 const order=value.channelOrder??'RGB',bytes=[color&255,(color>>>8)&255,(color>>>16)&255];
 return bytes[order.indexOf('R')]|(bytes[order.indexOf('G')]<<8)|(bytes[order.indexOf('B')]<<16);
}
