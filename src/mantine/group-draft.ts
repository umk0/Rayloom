import type {Layout} from '../studio-types';

type Group=Layout['groups'][number];
export type GroupDraft={editing:string;name:string;members:string[];baseline:Group|null;revision:number};
const drafts=new Map<string,GroupDraft>();
let revision=0;
const copyGroup=(group:Group|null):Group|null=>group?{...group,members:[...group.members]}:null;
const clone=(draft:GroupDraft):GroupDraft=>({...draft,members:[...draft.members],baseline:copyGroup(draft.baseline)});
const same=(a:Pick<Group,'name'|'members'>|null,b:Pick<Group,'name'|'members'>|null)=>a===null||b===null?a===b:a.name===b.name&&a.members.length===b.members.length&&a.members.every(id=>b.members.includes(id));

export function freshGroupDraft(layout:Layout,id:string):GroupDraft{
 const group=layout.groups.find(g=>g.id===id&&g.id!=='all')??null;
 return {editing:group?.id??'new',name:group?.name??'',members:[...(group?.members??[])],baseline:copyGroup(group),revision:0};
}
export function writeGroupDraft(scope:string,draft:GroupDraft):GroupDraft{
 const next=clone({...draft,revision:++revision});drafts.set(scope,next);return clone(next);
}
export function readGroupDraft(scope:string):GroupDraft|null{const draft=drafts.get(scope);return draft?clone(draft):null;}
export function clearGroupDraft(scope:string,expectedRevision:number):boolean{
 if(drafts.get(scope)?.revision!==expectedRevision)return false;drafts.delete(scope);return true;
}
export function groupDraftChanged(draft:GroupDraft):boolean{return !same(draft,draft.baseline??{name:'',members:[]});}
export function groupDraftConflict(draft:GroupDraft,layout:Layout):boolean{
 const current=layout.groups.find(g=>g.id===draft.editing)??null;
 if(draft.members.some(id=>!layout.components.some(c=>c.id===id)))return true;
 return !same(current,draft)&&!same(current,draft.baseline);
}
export function restoreGroupDraft(scope:string,layout:Layout,activeGroup:string):{draft:GroupDraft;conflict:boolean}{
 const saved=readGroupDraft(scope);if(!saved)return {draft:freshGroupDraft(layout,activeGroup),conflict:false};
 const current=layout.groups.find(g=>g.id===saved.editing)??null;
 if(current&&same(current,saved)){
  // The draft has already reached the current layout. Do not replay it over
  // later edits; keep its selected group and let the parent own persistence.
  clearGroupDraft(scope,saved.revision);return {draft:freshGroupDraft(layout,current.id),conflict:false};
 }
 return {draft:saved,conflict:groupDraftConflict(saved,layout)};
}
