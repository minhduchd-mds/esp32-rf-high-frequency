import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoSweep,presets,analyzePassiveSpectrum} from '../web/model.js';
import {resonantPowerEstimate,CandidatePersistence,synchronousDetect,groupCoincidentObservations,WaveFieldMap} from '../web/weak-signal.js';

test('resonant estimate concentrates on a tuned window',()=>{
  const s=demoSweep(presets.hydrogen,2);
  const r=resonantPowerEstimate(s,presets.hydrogen.referenceHz,5000);
  assert.equal(r.center_hz,presets.hydrogen.referenceHz);assert.ok(r.bandwidth_hz>0);assert.ok(Number.isFinite(r.power_dbm));
});
test('candidate persistence requires repeated clean detections',()=>{
  const p=new CandidatePersistence({minHits:3,maxGap:1}),profile=presets.hydrogen;
  let out;
  for(let n=1;n<=3;n++) out=p.update(analyzePassiveSpectrum(demoSweep(profile,n),profile),profile.step);
  assert.ok(out.persistent.length>0);
  p.reset();assert.equal(p.state.size,0);
});
test('synchronous detector recovers a weak reference tone under deterministic interference',()=>{
  const fs=4096,f=128,n=4096,amp=0.002;
  const values=Array.from({length:n},(_,i)=>amp*Math.cos(2*Math.PI*f*i/fs)+0.1*Math.sin(2*Math.PI*777*i/fs));
  const r=synchronousDetect(values,fs,f);
  assert.ok(Math.abs(r.amplitude-amp)<1e-4);
});
test('coincidence requires independent sensor classes',()=>{
  const groups=groupCoincidentObservations([
    {sensor:'h_field',frequency_hz:1000,value:1,timestamp_ms:100},
    {sensor:'e_field',frequency_hz:1004,value:2,timestamp_ms:110},
    {sensor:'h_field',frequency_hz:5000,value:3,timestamp_ms:100}
  ],{frequencyToleranceHz:10,timeToleranceMs:50,minSensors:2});
  assert.equal(groups.length,1);assert.deepEqual(groups[0].sensors,['e_field','h_field']);
});
test('wave-field map preserves spatial/frequency coordinates and remains bounded',()=>{
  const m=new WaveFieldMap(2);
  m.add({sensor:'h_field',x:0,y:0,z:0,frequency_hz:1000,value:1,timestamp_ms:1});
  m.add({sensor:'e_field',x:10,y:0,z:0,frequency_hz:1000,value:2,timestamp_ms:2});
  m.add({sensor:'rf_antenna',x:10,y:10,z:0,frequency_hz:2000,value:-80,timestamp_ms:3});
  const s=m.summary();assert.equal(s.count,2);assert.deepEqual(s.bounds.x,[10,10]);assert.deepEqual(s.bounds.y,[0,10]);
});
