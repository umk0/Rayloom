// SPDX-License-Identifier: GPL-2.0-or-later
// Orthographic camera math. Distances are millimetres; zoom is pixels per mm.
export const MIN_ZOOM = 0.001;
export const MAX_ZOOM = 32;
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function defaultCamera(mode = '2d') {
  return {cx:0, cy:0, cz:0, zoom:1, yaw:mode === '3d' ? -.48 : 0, pitch:mode === '3d' ? .66 : 0};
}
export function cameraBasis(camera) {
  const co = Math.cos(camera.yaw), si = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  return {right:[co,0,si], down:[si*sp,cp,-co*sp], depth:[-si*cp,sp,co*cp]};
}
export function projectPoint(point, camera, viewport) {
  const p = [finite(point.x)-camera.cx,finite(point.y)-camera.cy,finite(point.z)-camera.cz], b = cameraBasis(camera);
  const dot = axis => p.reduce((sum,n,i)=>sum+n*axis[i],0);
  return {x:viewport.width/2+dot(b.right)*camera.zoom,y:viewport.height/2+dot(b.down)*camera.zoom,depth:dot(b.depth)};
}
export function screenDeltaToWorld(dx, dy, camera) {
  const b = cameraBasis(camera), scale = Math.max(MIN_ZOOM, camera.zoom);
  const values = b.right.map((r,i)=>(r*dx+b.down[i]*dy)/scale);
  return {x:values[0],y:values[1],z:values[2]};
}
export function screenDeltaAlongAxis(dx, dy, axis, camera) {
  const index={x:0,y:1,z:2}[axis];if(index===undefined)return 0;
  const b=cameraBasis(camera),x=b.right[index]*camera.zoom,y=b.down[index]*camera.zoom,denominator=x*x+y*y;
  // An axis pointing straight towards the camera cannot be dragged in projection.
  return denominator<1e-10?0:(dx*x+dy*y)/denominator;
}
export function panCamera(camera, dx, dy) {
  const delta = screenDeltaToWorld(dx,dy,camera);
  return {...camera,cx:camera.cx-delta.x,cy:camera.cy-delta.y,cz:camera.cz-delta.z};
}
export function zoomAt(camera, nextZoom, anchor, viewport) {
  const zoom = clamp(finite(nextZoom,camera.zoom),MIN_ZOOM,MAX_ZOOM);
  const oldDelta = screenDeltaToWorld(anchor.x-viewport.width/2,anchor.y-viewport.height/2,camera);
  const nextDelta = screenDeltaToWorld(anchor.x-viewport.width/2,anchor.y-viewport.height/2,{...camera,zoom});
  return {...camera,zoom,cx:camera.cx+oldDelta.x-nextDelta.x,cy:camera.cy+oldDelta.y-nextDelta.y,cz:camera.cz+oldDelta.z-nextDelta.z};
}
export function boundsOfPoints(points) {
  if(!points.length) return null;
  const bounds={minX:Infinity,minY:Infinity,minZ:Infinity,maxX:-Infinity,maxY:-Infinity,maxZ:-Infinity};
  for(const p of points) {
    bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);
    bounds.minY=Math.min(bounds.minY,p.y);bounds.maxY=Math.max(bounds.maxY,p.y);
    bounds.minZ=Math.min(bounds.minZ,finite(p.z));bounds.maxZ=Math.max(bounds.maxZ,finite(p.z));
  }
  return bounds;
}
export function screenBounds(points, camera, viewport, padding = 0) {
  const bounds=boundsOfPoints(points.map(p=>projectPoint(p,camera,viewport)));
  return bounds ? {left:bounds.minX-padding,top:bounds.minY-padding,right:bounds.maxX+padding,bottom:bounds.maxY+padding} : null;
}
export function boundsVisible(bounds, viewport, margin = 0) {
  return !!bounds && bounds.right>=margin && bounds.left<=viewport.width-margin && bounds.bottom>=margin && bounds.top<=viewport.height-margin;
}
export function fitCamera(points, camera, viewport, padding = 56) {
  const world=boundsOfPoints(points);if(!world)return camera;
  const center={...camera,cx:(world.minX+world.maxX)/2,cy:(world.minY+world.maxY)/2,cz:(world.minZ+world.maxZ)/2,zoom:1};
  const b=screenBounds(points,center,viewport);
  const offset=screenDeltaToWorld((b.left+b.right)/2-viewport.width/2,(b.top+b.bottom)/2-viewport.height/2,center);
  const zoom=clamp(Math.min(3,Math.max(40,viewport.width-padding*2)/Math.max(40,b.right-b.left),Math.max(40,viewport.height-padding*2)/Math.max(40,b.bottom-b.top)),MIN_ZOOM,MAX_ZOOM);
  return {...center,cx:center.cx+offset.x,cy:center.cy+offset.y,cz:center.cz+offset.z,zoom};
}
export function keepPointInView(camera, point, viewport, margin = 48) {
  const p=projectPoint(point,camera,viewport), x=clamp(p.x,margin,viewport.width-margin),y=clamp(p.y,margin,viewport.height-margin);
  return panCamera(camera,x-p.x,y-p.y);
}
export function edgeIndicator(point, camera, viewport, margin = 24) {
  const p=projectPoint(point,camera,viewport),cx=viewport.width/2,cy=viewport.height/2,dx=p.x-cx,dy=p.y-cy;
  const scale=Math.min((cx-margin)/Math.max(.001,Math.abs(dx)),(cy-margin)/Math.max(.001,Math.abs(dy)),1);
  return {x:cx+dx*scale,y:cy+dy*scale,angle:Math.atan2(dy,dx)*180/Math.PI};
}
export function gridStep(zoom, targetPixels = 64) {
  const desired=targetPixels/Math.max(MIN_ZOOM,zoom),power=10**Math.floor(Math.log10(desired));
  return [1,2,5,10].map(n=>n*power).find(n=>n>=desired)??power*10;
}
