import { test } from 'node:test';
import assert from 'node:assert/strict';
import {demoSweep, presets, parseRecording, validateSample, SweepAssembler, ScanHistory, findPeaks, HI_REST_HZ, analyzePassiveSpectrum, MAX_BINS} from '../web/model.js';
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
test('history bounded; peak hold resets on profile/source changes', () => {
  const h = new ScanHistory();
  for(let i=0;i<120;i++) h.add(demoSweep(presets.subghz,i));
  assert.equal(h.rows.length,100); assert.equal(h.total,120);
  assert.ok(h.hold.every((v,i) => v >= h.samples[i].rssi_dbm));
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
  assert.ok(result.candidates.every(c => c.delta_db >= 12));
});
