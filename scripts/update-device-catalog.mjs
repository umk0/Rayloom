import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseSupportCsv,extractDetectors,extractLiteralMatrices,consolidateDetectors,sha256} from '../shared/catalog-builder.mjs';

const root=path.resolve(import.meta.dirname,'..');
const target=path.join(root,'data/device-catalog.json');
const url='https://openrgb.org/data/supported_devices_1.1.csv';
const existing=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):null;
let upstreamDevices,fetchedAt,sourceHash;
if(process.argv.includes('--offline')) {
  if(!existing)throw Error('No cached upstream catalog; run without --offline first');
  upstreamDevices=existing.upstreamDevices??existing.devices;
  fetchedAt=existing.fetchedAt;sourceHash=existing.sha256;
} else {
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const source=await response.text();upstreamDevices=parseSupportCsv(source);
  fetchedAt=new Date().toISOString();sourceHash=sha256(source);
}
if(upstreamDevices.length<100)throw Error('Unexpectedly small upstream catalog');
const detectors=[],layouts=[],sourceFiles=[];
const controllers=path.join(root,'core/Controllers');
for(const relative of fs.readdirSync(controllers,{recursive:true}).filter(file=>file.endsWith('.cpp')).sort()) {
  const sourcePath='core/Controllers/'+relative.replaceAll('\\','/');
  const source=fs.readFileSync(path.join(controllers,relative),'utf8');
  const foundDetectors=extractDetectors(source,sourcePath),foundLayouts=extractLiteralMatrices(source,sourcePath);
  if(foundDetectors.length||foundLayouts.length)sourceFiles.push({path:sourcePath,sha256:sha256(source)});
  detectors.push(...foundDetectors);layouts.push(...foundLayouts);
}
const models=consolidateDetectors(detectors);
if(models.length<1000)throw Error('Unexpectedly few native detector registrations');
let coreRevision='unknown';
try{coreRevision=execFileSync('git',['-C',path.join(root,'core'),'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
const references=JSON.parse(fs.readFileSync(path.join(root,'data/catalog-sources.json'),'utf8'));
const data={schemaVersion:2,source:url,release:'1.1',fetchedAt,sha256:sourceHash,generatedAt:new Date().toISOString(),
  license:'Native source-derived entries and matrices: GPL-2.0-or-later; see individual provenance and core/LICENSE.',
  geometry:'Templates require exact model/variant and LED-count verification. A matching name or catalog entry does not authorize a hardware driver or replace its LED order.',
  sources:references.sources,coreRevision,coreSourceSha256:sha256(JSON.stringify(sourceFiles)),
  counts:{upstreamRows:upstreamDevices.length,detectorRegistrations:detectors.length,namedDetectorRecords:models.length,uniqueDetectorNames:new Set(models.map(d=>d.Name)).size,layoutTemplates:layouts.length},
  devices:[...models,...upstreamDevices.map(d=>({...d,SourceId:'openrgb-support-csv',Support:'upstream-support-table',Geometry:'runtime-controller'}))],
  layouts,upstreamDevices};
const temporary=target+'.tmp';fs.writeFileSync(temporary,JSON.stringify(data,null,2)+'\n');fs.renameSync(temporary,target);
console.log(JSON.stringify({devices:data.devices.length,...data.counts,coreRevision}));
