import { test } from 'node:test';
import assert from 'node:assert/strict';
import {demoSweep, presets, parseRecording, validateSample, SweepAssembler, ScanHistory, findPeaks, HI_REST_HZ, analyzePassiveSpectrum, MAX_BINS, averageSweeps, validateSpectrumFrame, spectrumFrameToSamples, buildScienceSession, validateRfiMasks, validateHardwareManifest, validateCalibrationCurve, applyCalibrationCurve, sha256Hex, sealScienceSession, verifyScienceSession, compareScienceSessions} from '../web/model.js';
const rows = demoSweep(presets.subghz, 1);
test('recording round trip preserves source and precision', () => {
  assert.deepEqual(parseRecording(rows.map(s => JSON.stringify(s)).join('\n')), rows);
});
test('reject untrusted or oversized samples', () => {
  for (const patch of [{rssi_dbm:NaN},{rssi_dbm:21},{frequency_hz:-1},{frequency_hz:2**32},{total:513},{index:101},{source:'live'},{version:2},{sweep:.5}])
    assert.throws(() => validateSample({...rows[0],...patch}));
  assert.throws(() => parseRecording(''));
  assert.throws(() => parseRecording('{bad}'), /Dòng 1/);
  assert.throws(() => parseRecording('x'.repeat(8*1024*1024+1)), /8 MB/);
});
test('assembler commits a full sweep only', () => {
  const a = new SweepAssembler();
  for (const row of rows.slice(0,-1)) assert.equal(a.accept(row),null);
  assert.deepEqual(a.accept(rows.at(-1)), rows);
  assert.equal(a.pending.length,0);
});
test('drop missing, mixed-source and nonmonotonic samples; recover at index zero', () => {
  const a = new SweepAssembler();
  a.accept(rows[0]); assert.throws(() => a.accept(rows[2]));
  a.accept(rows[0]); assert.throws(() => a.accept({...rows[1],source:'device'}));
  a.accept(rows[0]); assert.throws(() => a.accept({...rows[1],frequency_hz:1}));
  a.accept(rows[0]); assert.throws(() => a.accept({...rows[1],timestamp_ms:0}));
  a.accept(rows[0]); a.accept(rows[1]); assert.throws(() => a.accept({...rows[2],frequency_hz:rows[2].frequency_hz+1}));
  let result; for(const row of rows) result = a.accept(row);
  assert.equal(result.length,101);
});
test('history is configurable and peak hold resets on profile/source changes', () => {
  const h = new ScanHistory();
  for(let i=0;i<120;i++) h.add(demoSweep(presets.subghz,i));
  assert.equal(h.rows.length,100); assert.equal(h.total,120);
  const science = new ScanHistory(360);
  for(let i=0;i<400;i++) science.add(demoSweep(presets.subghz,i));
  assert.equal(science.rows.length,360);
  h.add(demoSweep(presets.hf,1)); assert.equal(h.rows.length,1);
  h.add(demoSweep(presets.hf,2).map(s=>({...s,source:'device'}))); assert.equal(h.total,1);
});
test('peak detector locates demo carriers and obeys threshold', () => {
  const peaks=findPeaks(rows);
  assert.equal(peaks[0].frequency_hz,433920000);
  assert.equal(findPeaks(rows,0).length,0);
  assert.equal(peaks.length,3);
});
test('space-science profiles fit the bounded scanner model and keep the HI reference explicit', () => {
  for (const key of ['solar','hydrogen']) {
    const p = presets[key];
    const bins = Math.floor((p.stop - p.start) / p.step) + 1;
    assert.equal(p.domain, 'space-science');
    assert.ok(bins > 1 && bins <= MAX_BINS);
  }
  assert.equal(presets.hydrogen.referenceHz, HI_REST_HZ);
  const result = analyzePassiveSpectrum(demoSweep(presets.hydrogen, 7), presets.hydrogen);
  assert.ok(result.candidates.some(c => c.type === 'reference_line_candidate'));
});
test('integration averages power in linear domain and rejects grid mismatch', () => {
  const a=demoSweep(presets.subghz,1), b=demoSweep(presets.subghz,2);
  const avg=averageSweeps([a,b]);
  assert.equal(avg.length,a.length);
  assert.equal(avg[0].sweep,b[0].sweep);
  const lo=Math.min(a[0].rssi_dbm,b[0].rssi_dbm), hi=Math.max(a[0].rssi_dbm,b[0].rssi_dbm);
  assert.ok(avg[0].rssi_dbm>=lo && avg[0].rssi_dbm<=hi);
  assert.throws(()=>averageSweeps([a,demoSweep(presets.hf,2)]));
});
test('read-only spectrum v2 frame validates and converts to v1 samples', () => {
  const frame=validateSpectrumFrame({version:2,type:'spectrum',source:'device',sequence:9,start_hz:1400000000,step_hz:100000,
    powers_dbm:[-110,-105,-95],timestamp_ms:1234,rbw_hz:100000,integration_ms:500,calibration_state:'relative'});
  const samples=spectrumFrameToSamples(frame);
  assert.equal(samples.length,3);
  assert.equal(samples[2].frequency_hz,1400200000);
  assert.equal(samples[0].source,'device');
  assert.throws(()=>validateSpectrumFrame({...frame,source:'simulation'}));
});
test('RFI masks flag candidates without silently deleting evidence', () => {
  const masks=validateRfiMasks([{start_hz:433900000,stop_hz:433940000,label:'local-test'}]);
  const result=analyzePassiveSpectrum(rows,presets.subghz,12,masks);
  assert.ok(result.candidates.some(c=>c.quality_flags.includes('rfi_mask:local-test')));
});
test('science session captures provenance and candidate summary', () => {
  const samples=demoSweep(presets.hydrogen,3);
  const analysis=analyzePassiveSpectrum(samples,presets.hydrogen);
  const session=buildScienceSession({profileKey:'hydrogen',samples,analysis,integrationSweeps:4,calibrationState:'relative',receiver:'test',startedAt:'2026-10-02T00:00:00.000Z'});
  assert.equal(session.schema,'rf-observatory/science-session-v1');
  assert.equal(session.grid.bins,samples.length);
  assert.equal(session.integration_sweeps,4);
  assert.match(session.statement,/Candidate review only/);
});

test('hardware manifest is receive-only and fingerprintable',async()=>{const m=validateHardwareManifest({schema:'rf-observatory/hardware-manifest-v1',receive_only:true,receiver:'science-rx',antenna:'L-band feed',front_end:{lna:'LNA',filters:['BPF'],clock_reference:'TCXO'}});assert.equal(m.receive_only,true);assert.equal((await sha256Hex(m)).length,64);assert.throws(()=>validateHardwareManifest({...m,receive_only:false}));});
test('calibration interpolates corrections without mutating raw',()=>{const raw=demoSweep(presets.subghz,1),curve=validateCalibrationCurve({schema:'rf-observatory/calibration-v1',points:[{frequency_hz:433000000,correction_db:1},{frequency_hz:434000000,correction_db:3}]});const calibrated=applyCalibrationCurve(raw,curve);assert.equal(raw[0].rssi_dbm+1,calibrated[0].rssi_dbm);assert.equal(raw.at(-1).rssi_dbm+3,calibrated.at(-1).rssi_dbm);assert.notDeepEqual(raw,calibrated);});
test('science sessions seal and compare deterministically',async()=>{const samples=demoSweep(presets.hydrogen,4),analysis=analyzePassiveSpectrum(samples,presets.hydrogen),base=buildScienceSession({profileKey:'hydrogen',samples,analysis,integrationSweeps:1,calibrationState:'relative',receiver:'sim',startedAt:'2026-10-02T00:00:00.000Z'}),sealed=await sealScienceSession(base);assert.equal(await verifyScienceSession(sealed),true);assert.equal(await verifyScienceSession({...sealed,profile:'solar'}),false);const c=compareScienceSessions(sealed,{...sealed,analysis:{...sealed.analysis,baseline_dbm:sealed.analysis.baseline_dbm+2}});assert.equal(c.grid_match,true);assert.equal(c.baseline_delta_db,null);assert.equal(c.comparable,false);});

