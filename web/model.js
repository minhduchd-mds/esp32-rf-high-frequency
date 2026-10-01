export const MAX_BINS = 512;
export const MAX_RECORDS = 20000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const presets = {
  subghz: { label: 'Sub-GHz · 433 MHz', start: 433000000, stop: 434000000, step: 10000 },
  hf: { label: 'HF · 7 MHz', start: 7000000, stop: 7200000, step: 2000 },
};

export function validateSample(s) {
  if (!s || s.version !== 1 || s.type !== 'sample' || !['simulation', 'device'].includes(s.source))
    throw new Error('Bản ghi không đúng giao thức RF v1.');
  for (const k of ['sweep', 'index', 'total', 'frequency_hz', 'timestamp_ms'])
    if (!Number.isSafeInteger(s[k]) || s[k] < 0) throw new Error(`Trường ${k} không hợp lệ.`);
  if (s.sweep > 0xffffffff || s.frequency_hz < 1 || s.frequency_hz > 0xffffffff ||
      s.total < 1 || s.total > MAX_BINS || s.index >= s.total ||
      !Number.isFinite(s.rssi_dbm) || s.rssi_dbm < -160 || s.rssi_dbm > 20)
    throw new Error('Mẫu vượt giới hạn tần số, RSSI hoặc kích thước.');
  // Return known scalar fields only. Never pass arbitrary imported keys into the UI.
  return Object.fromEntries(['version','type','source','sweep','index','total','frequency_hz','rssi_dbm','timestamp_ms'].map(k => [k, s[k]]));
}

export function parseRecording(text) {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Tệp vượt 8 MB.');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length || lines.length > MAX_RECORDS) throw new Error('Tệp rỗng hoặc vượt 20.000 mẫu.');
  return lines.map((line, i) => {
    try { return validateSample(JSON.parse(line)); }
    catch (e) { throw new Error(`Dòng ${i + 1}: ${e.message}`); }
  });
}

// Drop incomplete/reordered sweeps instead of painting them as complete measurements.
export class SweepAssembler {
  constructor() { this.reset(); }
  reset() { this.pending = []; }
  accept(input) {
    const s = validateSample(input);
    if (s.index === 0) this.pending = [];
    const first = this.pending[0];
    const last = this.pending.at(-1);
    if (s.index !== this.pending.length || (first && (s.sweep !== first.sweep || s.total !== first.total || s.source !== first.source)) ||
        (last && (s.frequency_hz <= last.frequency_hz || s.timestamp_ms < last.timestamp_ms)) ||
        (this.pending.length >= 2 && s.frequency_hz - last.frequency_hz !== this.pending[1].frequency_hz - first.frequency_hz)) {
      this.reset(); throw new Error('Vòng quét thiếu mẫu hoặc sai thứ tự.');
    }
    this.pending.push(s);
    if (this.pending.length === s.total) {
      const complete = this.pending; this.reset(); return complete;
    }
    return null;
  }
}

export function demoSweep(profile, sweep) {
  const total = Math.floor((profile.stop - profile.start) / profile.step) + 1;
  return Array.from({ length: total }, (_, index) => {
    const x = index / (total - 1);
    const gaussian = (center, width, power) => power * Math.exp(-0.5 * ((x - center) / width) ** 2);
    const rssi = -111 + 3 * Math.sin(index * 2.3 + sweep * .8) + gaussian(.23, .012, 40) +
      gaussian(.63, .02, 31 + 3 * Math.sin(sweep * .3)) + gaussian(.92, .016, 58);
    return {version:1, type:'sample', source:'simulation', sweep, index, total,
      frequency_hz:profile.start + index * profile.step, rssi_dbm:Math.round(rssi * 100) / 100,
      timestamp_ms:sweep * 3000 + index * 20};
  });
}

export function findPeaks(samples, threshold = -85) {
  return samples.filter((s, i) => s.rssi_dbm >= threshold &&
    (i === 0 || s.rssi_dbm > samples[i-1].rssi_dbm) &&
    (i === samples.length-1 || s.rssi_dbm >= samples[i+1].rssi_dbm))
    .sort((a, b) => b.rssi_dbm - a.rssi_dbm).slice(0, 8);
}

export class ScanHistory {
  constructor() { this.clear(); }
  clear() { this.rows = []; this.hold = []; this.samples = []; this.key = ''; this.total = 0; }
  add(samples) {
    const key = `${samples[0].source}:${samples.map(s => s.frequency_hz).join(',')}`;
    if (key !== this.key) { this.clear(); this.key = key; }
    this.samples = samples;
    this.hold = samples.map((s, i) => Math.max(s.rssi_dbm, this.hold[i] ?? -160));
    this.rows.unshift(samples.map(s => s.rssi_dbm));
    this.rows.length = Math.min(this.rows.length, 100);
    ++this.total;
  }
}
