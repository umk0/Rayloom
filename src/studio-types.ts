export type Point={led:number;x:number;y:number;z:number};
export type Component={id:string;name:string;device:any;deviceKey:string;zone:number;source:string;enabled:boolean;points:Point[];calibration?:{channelOrder:'RGB'|'RBG'|'GRB'|'GBR'|'BRG'|'BGR';brightness:number};pose:{x:number;y:number;z:number;rx:number;ry:number;rz:number;scale:number}};
export type Layout={version:1;components:Component[];groups:{id:string;name:string;members:string[]}[];deviceAliases?:Record<string,string>;scenes:any[]};
export const emptyLayout:Layout={version:1,components:[],groups:[{id:'all',name:'Всё пространство',members:[]}],scenes:[]};
