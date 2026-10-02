import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ObservationSession,parseEvidence,verifyBundle,compareBundles} from '../web/science.js';
import {spectrumFrameToSamples,analyzePassiveSpectrum,presets,sha256Hex,validateSpectrumFrame} from '../web/model.js';
const manifest={schema:'rf-observatory/hardware-manifest-v1',receive_only:true,receiver:'rx-serial-1',antenna:'test-feed'};
const frame=(sequence=1)=>({version:2,type:'spectrum',source:'device',sequence,start_hz:433000000,step_hz:10000,powers_dbm:[-110,-100,-90],timestamp_ms:sequence*1000,rbw_hz:5000,integration_ms:500,calibration_state:'relative'});
const add=(s,f)=>s.accept(spectrumFrameToSamples(f),f);
const session=()=>new ObservationSession({manifest,startedAt:'2026-10-02T00:00:00Z'});
test('raw frames, RBW, integration and calibration survive bundle/export/replay',async()=>{
  const s=session(),f=frame();add(s,f);const b=await s.bundle();
  assert.deepEqual(b.raw_records,[f]);assert.equal(b.acquisition.rbw_hz,5000);assert.equal(b.acquisition.calibration_state,'relative');
  assert.equal(b.physical_calibration_verified,false);assert.equal(await verifyBundle(b),true);
  assert.deepEqual(parseEvidence(s.rawText())[0].frame,f);
});
test('integration preserves every raw input and applies to device frames',async()=>{
  const s=new ObservationSession({integrationSweeps:4});
  for(let i=1;i<=3;i++)assert.equal(add(s,frame(i)),null);
  const result=add(s,frame(4));assert.equal(result.length,3);
  const b=await s.bundle();assert.equal(b.raw_count,4);assert.equal(b.pending_sweeps,0);assert.equal(await verifyBundle(b),true);
});
test('missing frame breaks integration and duplicate/reversed timestamps fail without mutation',()=>{
  const s=new ObservationSession({integrationSweeps:4});add(s,frame());add(s,frame(3));
  assert.equal(s.gaps,1);assert.equal(s.pending.length,1);
  for(const f of [frame(3),frame(2),{...frame(4),timestamp_ms:0}])assert.throws(()=>add(s,f));
  assert.equal(s.sweeps,2);
});
test('changed acquisition conditions and mixed sources fail closed',()=>{
  const s=session();add(s,frame());
  for(const f of [{...frame(2),rbw_hz:10000},{...frame(2),integration_ms:1000},{...frame(2),start_hz:100},{...frame(2),calibration_state:'calibrated'}])assert.throws(()=>add(s,f));
  assert.throws(()=>s.accept(spectrumFrameToSamples(frame(2)).map(x=>({...x,source:'simulation'}))));
  assert.equal(s.raw.length,1);
});
test('calibration failure preserves raw and exports a verifiable processing error',async()=>{
  const curve={schema:'rf-observatory/calibration-v1',points:[{frequency_hz:1,correction_db:0},{frequency_hz:2,correction_db:0}]};
  const s=new ObservationSession({curve});assert.throws(()=>add(s,frame()));
  assert.equal(s.raw.length,1);const b=await s.bundle();assert.ok(b.processing_error);assert.equal(b.derived_samples.length,0);assert.equal(await verifyBundle(b),true);
});
test('correction never claims physical calibration and raw remains unchanged',async()=>{
  const curve={schema:'rf-observatory/calibration-v1',points:[{frequency_hz:433000000,correction_db:2},{frequency_hz:434000000,correction_db:2}]};
  const s=new ObservationSession({curve});add(s,frame());const b=await s.bundle();
  assert.equal(b.processing_state,'correction-applied');assert.equal(b.physical_calibration_verified,false);
  assert.equal(b.raw_records[0].powers_dbm[0],-110);assert.equal(b.derived_samples[0].rssi_dbm,-108);assert.equal(await verifyBundle(b),true);
});
test('archive bound stops without evicting raw',()=>{
  const s=session();for(let i=1;i<=39;i++)add(s,{...frame(i),powers_dbm:Array(512).fill(-100)});
  assert.throws(()=>add(s,{...frame(40),powers_dbm:Array(512).fill(-100)}),/đầy/);assert.equal(s.raw.length,39);assert.equal(s.raw[0].sequence,1);
});
test('seal is an immutable snapshot while new frames arrive',async()=>{
  const s=session();add(s,frame());const pending=s.bundle();add(s,frame(2));
  const b=await pending;assert.equal(b.raw_count,1);assert.equal(await verifyBundle(b),true);
});
test('comparison rejects tamper and incompatible hardware or acquisition',async()=>{
  const a=session(),b=session();add(a,frame());add(b,frame(2));
  const aa=await a.bundle(),bb=await b.bundle();assert.equal((await compareBundles(aa,bb)).comparable,true);
  await assert.rejects(()=>compareBundles(aa,{...bb,source:'simulation'}));
  const other=new ObservationSession({manifest:{...manifest,receiver:'rx-2'}});add(other,frame());
  assert.equal((await compareBundles(aa,await other.bundle())).comparable,false);
});
test('resealed inconsistent derived data fails scientific replay',async()=>{
  const s=session();add(s,frame());const b=await s.bundle();b.derived_samples[0].rssi_dbm=0;
  const clean={...b};delete clean.integrity;b.integrity.digest=await sha256Hex(clean);
  assert.equal(await verifyBundle(b),false);
});
test('malformed session and mixed/incomplete evidence rejected',async()=>{
  assert.equal(await verifyBundle({schema:'rf-observatory/science-session-v2'}),false);
  assert.throws(()=>parseEvidence(JSON.stringify(spectrumFrameToSamples(frame())[0])));
  assert.throws(()=>parseEvidence(JSON.stringify(frame())+'\n'+JSON.stringify(spectrumFrameToSamples(frame())[0])));
  assert.throws(()=>validateSpectrumFrame({...frame(),calibration_state:'trust-me'}));
});
test('masked strong peaks do not crowd out clean candidates; baseline uses clean bins',()=>{
  const powers=Array(40).fill(-120);for(let i=0;i<9;i++)powers[2*i+1]=-40;powers[35]=-80;
  const samples=spectrumFrameToSamples({...frame(),powers_dbm:powers});
  const masks=[{start_hz:samples[0].frequency_hz,stop_hz:samples[20].frequency_hz,label:'local'}];
  const a=analyzePassiveSpectrum(samples,presets.subghz,12,masks);
  assert.ok(a.candidates.some(c=>c.frequency_hz===samples[35].frequency_hz&&!c.quality_flags.length));assert.equal(a.peak_dbm,-80);
  assert.equal(analyzePassiveSpectrum(samples,presets.subghz,12,[{...masks[0],stop_hz:samples.at(-1).frequency_hz}]).baseline_dbm,null);
});
test('deterministic malformed input corpus never creates a valid bundle',async()=>{
  const s=session();add(s,frame());const b=await s.bundle();
  for(let i=0;i<100;i++){const bad=structuredClone(b);bad.raw_records[0].powers_dbm[i%3]=i;assert.equal(await verifyBundle(bad),false);}
});
test('already calibrated input is archived but not corrected twice',async()=>{
  const curve={schema:'rf-observatory/calibration-v1',points:[{frequency_hz:433000000,correction_db:2},{frequency_hz:434000000,correction_db:2}]};
  const s=new ObservationSession({curve});assert.throws(()=>add(s,{...frame(),calibration_state:'calibrated'}),/lần hai/);
  assert.equal(s.raw.length,1);assert.equal(await verifyBundle(await s.bundle()),true);
});
