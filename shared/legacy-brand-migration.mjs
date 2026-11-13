// SPDX-License-Identifier: GPL-2.0-or-later
// Historical identifiers are read only here so old scenes retain their LEDs.
const oldVirtual={vendor:'LumenRGB',name:'LumenRGB Virtual Strip',serial:'preview-001',location:'LumenRGB:virtual'};
const newVirtual={vendor:'Rayloom',name:'Rayloom Virtual Strip',serial:'preview-001',location:'Rayloom:virtual'};
const oldKey=`${oldVirtual.vendor}|${oldVirtual.name}|${oldVirtual.serial}`;
const newKey=`${newVirtual.vendor}|${newVirtual.name}|${newVirtual.serial}`;
export function migrateLegacyLayout(layout){
 if(!layout||!Array.isArray(layout.components))return layout;
 const next=structuredClone(layout),ids=new Map();
 for(const component of next.components){
  if(component.deviceKey!==oldKey)continue;
  const before=component.id;
  component.deviceKey=newKey;
  if(typeof before==='string'&&before.startsWith(oldKey+'/'))component.id=newKey+before.slice(oldKey.length);
  if(component.device&&typeof component.device==='object')component.device={...component.device,...newVirtual};
  if(component.name===oldVirtual.name)component.name=newVirtual.name;
  else if(typeof component.name==='string'&&component.name.startsWith(oldVirtual.name+' · '))component.name=newVirtual.name+component.name.slice(oldVirtual.name.length);
  ids.set(before,component.id);
 }
 if(!ids.size)return layout;
 for(const group of next.groups??[])if(Array.isArray(group.members))group.members=group.members.map(id=>ids.get(id)??id);
 if(next.deviceAliases&&Object.hasOwn(next.deviceAliases,oldKey)){
  next.deviceAliases[newKey]??=next.deviceAliases[oldKey];delete next.deviceAliases[oldKey];
 }
 return next;
}
export function migrateLegacyEffectsProfile(profile){
 if(!profile||!Array.isArray(profile.Effects))return profile;
 let changed=false;const next=structuredClone(profile);
 for(const effect of next.Effects)for(const zone of effect.ControllerZones??[]){
  if(zone.location!==oldVirtual.location)continue;
  Object.assign(zone,newVirtual);changed=true;
 }
 return changed?next:profile;
}
