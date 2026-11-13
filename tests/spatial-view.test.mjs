import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCamera,projectPoint,screenDeltaToWorld,screenDeltaAlongAxis,zoomAt,fitCamera,screenBounds,boundsVisible,keepPointInView,edgeIndicator,panCamera,MIN_ZOOM,MAX_ZOOM} from '../shared/spatial-view.mjs';
const view={width:900,height:420};
const almost=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('default 2D camera preserves XY and ignores depth',()=>{
 const c=defaultCamera();assert.equal(c.yaw,0);assert.equal(c.pitch,0);
 const a=projectPoint({x:12,y:34,z:500},c,view),b=projectPoint({x:12,y:34,z:-500},c,view);
 almost(a.x,b.x);almost(a.y,b.y);almost(a.x,462);almost(a.y,244);
});
test('cursor anchored zoom does not move the world point under the pointer in 2D or 3D',()=>{
 for(const mode of ['2d','3d']){
  const c={...defaultCamera(mode),cx:600,cy:-300,cz:200,zoom:.45},anchor={x:153,y:370};
  const delta=screenDeltaToWorld(anchor.x-view.width/2,anchor.y-view.height/2,c),world={x:c.cx+delta.x,y:c.cy+delta.y,z:c.cz+delta.z};
  const next=zoomAt(c,2.75,anchor,view),p=projectPoint(world,next,view);almost(p.x,anchor.x);almost(p.y,anchor.y);
 }
});
test('screen translation and inverse world mapping agree for rotated 3D cameras',()=>{
 const c=defaultCamera('3d'),world={x:80,y:-20,z:50},delta=screenDeltaToWorld(53,-81,c),p=projectPoint(world,c,view),q=projectPoint({x:world.x+delta.x,y:world.y+delta.y,z:world.z+delta.z},c,view);
 almost(q.x-p.x,53);almost(q.y-p.y,-81);
 const pan=projectPoint(world,panCamera(c,53,-81),view);almost(pan.x-p.x,53);almost(pan.y-p.y,-81);
});
test('fit all recovers a component moved far beyond the old viewport',()=>{
 const points=[{x:0,y:0,z:0},{x:100,y:30,z:0},{x:95000,y:-80000,z:50000}];
 for(const mode of ['2d','3d']){
  const c=fitCamera(points,defaultCamera(mode),view);const b=screenBounds(points,c,view);
  assert(b.left>=55&&b.right<=view.width-55&&b.top>=55&&b.bottom<=view.height-55);assert(boundsVisible(b,view));
 }
});
test('drag auto-pan keeps the selected component center visible and edge marker recoverable',()=>{
 const c=defaultCamera('3d'),p={x:18000,y:-9000,z:2200};assert(!boundsVisible(screenBounds([p],c,view),view));
 const marker=edgeIndicator(p,c,view);assert(marker.x>=24&&marker.x<=view.width-24&&marker.y>=24&&marker.y<=view.height-24);
 const next=keepPointInView(c,p,view);const screen=projectPoint(p,next,view);assert(screen.x>=47.9&&screen.x<=view.width-47.9&&screen.y>=47.9&&screen.y<=view.height-47.9);
});
test('zoom limits and empty layouts stay finite',()=>{
 const c=defaultCamera();assert.equal(zoomAt(c,0,{x:0,y:0},view).zoom,MIN_ZOOM);assert.equal(zoomAt(c,Infinity,{x:0,y:0},view).zoom,c.zoom);assert.equal(zoomAt(c,9999,{x:0,y:0},view).zoom,MAX_ZOOM);assert.deepEqual(fitCamera([],c,view),c);
});
test('axis handles recover exact world displacement and ignore an invisible depth axis',()=>{
 const c={...defaultCamera('3d'),zoom:.7},origin=projectPoint({x:0,y:0,z:0},c,view);
 for(const axis of ['x','y','z']){
  const point={x:0,y:0,z:0};point[axis]=25;const moved=projectPoint(point,c,view);
  almost(screenDeltaAlongAxis(moved.x-origin.x,moved.y-origin.y,axis,c),25);
 }
 assert.equal(screenDeltaAlongAxis(10,20,'z',defaultCamera()),0);
});
