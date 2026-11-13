import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseSupportCsv,extractDetectors,extractLiteralMatrices,consolidateDetectors} from '../shared/catalog-builder.mjs';

test('upstream CSV handles quoted commas, escaped quotes and CRLF',()=>{
  assert.deepEqual(parseSupportCsv('Name,RGBController\r\n"Board, \"\"Pro\"\"",Demo\r\n'),[{Name:'Board, "Pro"',RGBController:'Demo'}]);
  assert.throws(()=>parseSupportCsv('Name,RGBController\n"broken'),/quote/);
});
test('detector extraction ignores comments and consolidates registrations without inventing VID/PID',()=>{
  const source='// REGISTER_HID_DETECTOR("Fake", fn, 1, 2);\nREGISTER_HID_DETECTOR("Real", fn, VID, PID);\n/* REGISTER_HID_DETECTOR("Fake2", fn, 1, 2); */\nREGISTER_HID_DETECTOR_IPU("Real", fn, VID, PID2, 0, 1, 6);';
  const records=extractDetectors(source,'core/Controllers/Test/TestDetect.cpp');
  assert.equal(records.length,2);assert.equal(records[0].Name,'Real');assert.equal(records[0].VID,undefined);
  assert.equal(consolidateDetectors(records)[0].variants.length,2);
});
test('matrix extraction preserves holes and refuses unknown constants or truncated rows',()=>{
  const source='#define NA 0xFFFFFFFF\nstatic unsigned int test_matrix[2][3]={{0,NA,2},{3,4,5}};';
  const [matrix]=extractLiteralMatrices(source,'core/Controllers/Test/RGBController_Test.cpp');
  assert.deepEqual(matrix.matrix,[[0,null,2],[3,4,5]]);assert.equal(matrix.requiredLedCount,6);assert.equal(matrix.ledCount,5);
  assert.equal(extractLiteralMatrices(source.replace('3,4,5','3,UNKNOWN,5'),'x').length,0);
  assert.equal(extractLiteralMatrices(source.replace('3,4,5','3,4'),'x').length,0);
});
test('VK99 and VK99 Pro matrices remain distinct and match their exact LED counts',()=>{
  const source=fs.readFileSync(new URL('../core/Controllers/ValkyrieKeyboardController/RGBController_ValkyrieKeyboard.cpp',import.meta.url),'utf8');
  const templates=extractLiteralMatrices(source,'core/Controllers/ValkyrieKeyboardController/RGBController_ValkyrieKeyboard.cpp');
  assert.equal(templates.find(m=>m.name==='normal_matrix_map').requiredLedCount,102);
  assert.equal(templates.find(m=>m.name==='matrix_map').requiredLedCount,98);
});
