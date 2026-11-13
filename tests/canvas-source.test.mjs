import test from 'node:test';import assert from 'node:assert/strict';
import {canvasControls,normalizeCanvasParameters,secureCanvasDocument} from '../desktop/canvas-source.mjs';
import {canvasTemplates} from '../shared/canvas-templates.mjs';
test('Canvas metadata validates controls and bounds numeric/color input',()=>{
 const controls=canvasControls(canvasTemplates[0].source);assert.equal(controls.length,2);
 assert.deepEqual(normalizeCanvasParameters(controls,{speed:100,color:'url(file:///x)'}),{speed:10,color:'#a378ef'});
 assert.deepEqual(normalizeCanvasParameters(controls,{speed:NaN,color:'#123456'}),{speed:1,color:'#123456'});
 assert.equal(canvasControls('<meta property="constructor" type="number" default="42">').length,0);
});
test('Canvas document policy precedes user code and denies external capabilities',()=>{
 const html=secureCanvasDocument('<script>window.test=1</script>');assert(html.indexOf('Content-Security-Policy')<html.indexOf('<script>'));
 assert(html.includes("connect-src 'none'"));assert(html.includes("frame-src 'none'"));assert.throws(()=>secureCanvasDocument('x'.repeat(200001)));
});
