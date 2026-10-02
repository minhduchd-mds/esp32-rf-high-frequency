export const MAX_BINS = 512;
export const MAX_RECORDS = 20000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const SCIENCE_HISTORY_ROWS = 360;
export const HI_REST_HZ = 1420405752;

export const presets = {
  subghz: { label: 'Sub-GHz · 433 MHz', start: 433000000, stop: 434000000, step: 10000, domain: 'lab', target: 'generic-rf' },
  hf: { label: 'HF · 7 MHz', start: 7000000, stop: 7200000, step: 2000, domain: 'lab', target: 'generic-rf' },
  solar: {
    label: 'Space · Solar/Jupiter · 14–30 MHz',
    start: 14000000, stop: 30000000, step: 50000,
    domain: 'space-science', target: 'solar-jovian'
  },
  hydrogen: {
    label: 'Space · HI 21 cm · 1400–1427 MHz',
    start: 1400000000, stop: 1427000000, step: 100000,
    domain: 'space-science', target: 'neutral-hydrogen', referenceHz: HI_REST_HZ
  },
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

export class SweepAssembler {
  constructor() { this.reset(); }
  reset() { this.pending = []; }
  accept(input) {
    const s = validateSample(input);
    if (s.index === 0) this.pending = [];
    const first = this.pending[0];
    const last = this.pending.at(-1);
    if (s.index !== this.pending.length ||
        (first && (s.sweep !== first.sweep || s.total !== first.total || s.source !== first.source)) ||
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
    let rssi = -111 + 3 * Math.sin(index * 2.3 + sweep * .8) + gaussian(.23, .012, 40) +
      gaussian(.63, .02, 31 + 3 * Math.sin(sweep * .3)) + gaussian(.92, .016, 58);
    if (profile.referenceHz) {
      const referenceX = (profile.referenceHz - profile.start) / Math.max(1, profile.stop - profile.start);
      rssi += gaussian(referenceX, .006, 50);
    }
    if (profile.target === 'solar-jovian')
      rssi += gaussian(.48, .14, 10 + 5 * Math.sin(sweep * .23));
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
  constructor(limit = 100) { this.limit = Math.max(1, Math.min(1000, limit)); this.clear(); }
  clear() { this.rows = []; this.hold = []; this.samples = []; this.key = ''; this.total = 0; }
  add(samples) {
    const key = `${samples[0].source}:${samples.map(s => s.frequency_hz).join(',')}`;
    if (key !== this.key) { this.clear(); this.key = key; }
    this.samples = samples;
    this.hold = samples.map((s, i) => Math.max(s.rssi_dbm, this.hold[i] ?? -160));
    this.rows.unshift(samples.map(s => s.rssi_dbm));
    this.rows.length = Math.min(this.rows.length, this.limit);
    ++this.total;
  }
}

function median(values) {
  const ordered = [...values].sort((a,b)=>a-b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function sameGrid(a, b) {
  return a.length === b.length && a.every((s,i)=>s.frequency_hz === b[i].frequency_hz && s.source === b[i].source);
}

export function averageSweeps(sweeps) {
  if (!Array.isArray(sweeps) || !sweeps.length) throw new Error('Cần ít nhất một vòng quét để tích phân.');
  const base = sweeps[0].map(validateSample);
  for (const sweep of sweeps.slice(1)) {
    const checked = sweep.map(validateSample);
    if (!sameGrid(base, checked)) throw new Error('Không thể tích phân các vòng quét khác lưới hoặc khác nguồn.');
  }
  const last = sweeps.at(-1);
  return base.map((s, i) => {
    const meanMw = sweeps.reduce((sum,row)=>sum + 10 ** (row[i].rssi_dbm / 10), 0) / sweeps.length;
    return {
      ...s,
      sweep: last[i].sweep,
      timestamp_ms: last[i].timestamp_ms,
      rssi_dbm: Math.round(10 * Math.log10(meanMw) * 100) / 100
    };
  });
}

export function validateRfiMasks(masks = []) {
  if (!Array.isArray(masks) || masks.length > 64) throw new Error('Danh sách RFI mask không hợp lệ.');
  return masks.map((m,i)=>{
    if (!m || !Number.isSafeInteger(m.start_hz) || !Number.isSafeInteger(m.stop_hz) ||
        m.start_hz < 1 || m.stop_hz < m.start_hz || m.stop_hz > 0xffffffff)
      throw new Error(`RFI mask ${i + 1} không hợp lệ.`);
    return {start_hz:m.start_hz, stop_hz:m.stop_hz, label:String(m.label || 'rfi').slice(0,48)};
  });
}

export function analyzePassiveSpectrum(samples, profile, deltaDb = 12, masks = []) {
  if (!samples.length) return {baseline_dbm:null, peak_dbm:null, peak_frequency_hz:null, candidates:[]};
  const safeMasks = validateRfiMasks(masks);
  const baseline = median(samples.map(s=>s.rssi_dbm));
  const threshold = baseline + deltaDb;
  const candidates = findPeaks(samples, threshold).map(s => {
    const reference = Number.isFinite(profile?.referenceHz) ? profile.referenceHz : null;
    const nearReference = reference !== null &&
      Math.abs(s.frequency_hz - reference) <= Math.max((profile.step || 0) * 2, 250000);
    const mask = safeMasks.find(m=>s.frequency_hz >= m.start_hz && s.frequency_hz <= m.stop_hz);
    return {
      type: nearReference ? 'reference_line_candidate' : 'spectral_peak_candidate',
      frequency_hz: s.frequency_hz,
      rssi_dbm: s.rssi_dbm,
      delta_db: Math.round((s.rssi_dbm - baseline) * 100) / 100,
      reference_offset_hz: reference === null ? null : s.frequency_hz - reference,
      quality_flags: mask ? [`rfi_mask:${mask.label}`] : []
    };
  });
  const peak = samples.reduce((best,s)=>!best||s.rssi_dbm>best.rssi_dbm?s:best,null);
  return {
    baseline_dbm: Math.round(baseline * 100) / 100,
    peak_dbm: peak.rssi_dbm,
    peak_frequency_hz: peak.frequency_hz,
    candidates
  };
}

export function validateSpectrumFrame(frame) {
  if (!frame || frame.version !== 2 || frame.type !== 'spectrum' || frame.source !== 'device')
    throw new Error('SDR frame không đúng giao thức spectrum v2.');
  for (const k of ['sequence','start_hz','step_hz','timestamp_ms'])
    if (!Number.isSafeInteger(frame[k]) || frame[k] < 0) throw new Error(`Trường ${k} không hợp lệ.`);
  if (frame.sequence > 0xffffffff || frame.start_hz < 1 || frame.start_hz > 0xffffffff ||
      frame.step_hz < 1 || !Array.isArray(frame.powers_dbm) ||
      frame.powers_dbm.length < 1 || frame.powers_dbm.length > MAX_BINS)
    throw new Error('SDR frame vượt giới hạn.');
  const end = frame.start_hz + frame.step_hz * (frame.powers_dbm.length - 1);
  if (!Number.isSafeInteger(end) || end > 0xffffffff) throw new Error('Lưới SDR frame vượt miền tần số.');
  if (frame.powers_dbm.some(v=>!Number.isFinite(v) || v < -160 || v > 20))
    throw new Error('Công suất SDR frame không hợp lệ.');
  const calibration = ['uncalibrated','relative','calibrated'].includes(frame.calibration_state) ?
    frame.calibration_state : 'uncalibrated';
  const rbw = frame.rbw_hz == null ? null : frame.rbw_hz;
  const integration = frame.integration_ms == null ? null : frame.integration_ms;
  if (rbw !== null && (!Number.isSafeInteger(rbw) || rbw < 1)) throw new Error('RBW không hợp lệ.');
  if (integration !== null && (!Number.isSafeInteger(integration) || integration < 1 || integration > 3600000))
    throw new Error('Integration time không hợp lệ.');
  return {
    version:2, type:'spectrum', source:'device', sequence:frame.sequence,
    start_hz:frame.start_hz, step_hz:frame.step_hz,
    powers_dbm:[...frame.powers_dbm], timestamp_ms:frame.timestamp_ms,
    rbw_hz:rbw, integration_ms:integration, calibration_state:calibration
  };
}

export function spectrumFrameToSamples(frame) {
  const f = validateSpectrumFrame(frame);
  return f.powers_dbm.map((rssi_dbm,index)=>({
    version:1, type:'sample', source:'device', sweep:f.sequence, index, total:f.powers_dbm.length,
    frequency_hz:f.start_hz + index * f.step_hz, rssi_dbm, timestamp_ms:f.timestamp_ms
  }));
}

export function buildScienceSession({profileKey, samples, analysis, integrationSweeps = 1, calibrationState = 'uncalibrated', receiver = 'simulation', startedAt}) {
  if (!presets[profileKey]) throw new Error('Profile khoa học không hợp lệ.');
  if (!samples?.length) throw new Error('Chưa có dữ liệu để tạo science session.');
  if (!Number.isSafeInteger(integrationSweeps) || integrationSweeps < 1 || integrationSweeps > 64)
    throw new Error('Integration sweeps không hợp lệ.');
  if (!['uncalibrated','relative','calibrated'].includes(calibrationState))
    throw new Error('Calibration state không hợp lệ.');
  const first=samples[0], last=samples.at(-1);
  return {
    schema:'rf-observatory/science-session-v1',
    started_at:startedAt || new Date().toISOString(),
    profile:profileKey,
    target:presets[profileKey].target,
    source:first.source,
    receiver:String(receiver).slice(0,64),
    calibration_state:calibrationState,
    integration_sweeps:integrationSweeps,
    grid:{start_hz:first.frequency_hz, stop_hz:last.frequency_hz, bins:samples.length,
      step_hz:samples.length > 1 ? samples[1].frequency_hz-first.frequency_hz : 0},
    analysis:{
      baseline_dbm:analysis?.baseline_dbm ?? null,
      peak_dbm:analysis?.peak_dbm ?? null,
      peak_frequency_hz:analysis?.peak_frequency_hz ?? null,
      candidate_count:analysis?.candidates?.filter(c=>!c.quality_flags?.length).length ?? 0
    },
    statement:'Candidate review only; astronomical origin requires calibration, RFI rejection, repeatability and independent confirmation.'
  };
}


function cleanText(value, max = 128) {
  return String(value ?? '').trim().slice(0, max);
}
export function validateHardwareManifest(input) {
  if (!input || input.schema !== 'rf-observatory/hardware-manifest-v1' || input.receive_only !== true)
    throw new Error('Hardware manifest phải là receive-only schema v1.');
  const receiver=cleanText(input.receiver), antenna=cleanText(input.antenna);
  if(!receiver||!antenna) throw new Error('Manifest cần receiver và antenna.');
  const front=input.front_end ?? {};
  return {schema:'rf-observatory/hardware-manifest-v1',receive_only:true,receiver,antenna,
    front_end:{lna:cleanText(front.lna,96),filters:Array.isArray(front.filters)?front.filters.map(x=>cleanText(x,96)).filter(Boolean).slice(0,16):[],clock_reference:cleanText(front.clock_reference,96)},
    station:cleanText(input.station,96),notes:cleanText(input.notes,256)};
}
export function validateCalibrationCurve(input) {
  if(!input||input.schema!=='rf-observatory/calibration-v1'||!Array.isArray(input.points)||input.points.length<2||input.points.length>128)
    throw new Error('Calibration curve không đúng schema hoặc số điểm.');
  const points=input.points.map((p,i)=>{
    if(!p||!Number.isSafeInteger(p.frequency_hz)||p.frequency_hz<1||p.frequency_hz>0xffffffff||!Number.isFinite(p.correction_db)||p.correction_db<-40||p.correction_db>40)
      throw new Error(`Điểm calibration ${i+1} không hợp lệ.`);
    return {frequency_hz:p.frequency_hz,correction_db:Math.round(p.correction_db*1000)/1000};
  });
  if(points.some((p,i)=>i&&p.frequency_hz<=points[i-1].frequency_hz)) throw new Error('Tần số calibration phải tăng nghiêm ngặt.');
  return {schema:'rf-observatory/calibration-v1',points,note:cleanText(input.note,256)};
}
function interpolateCorrection(points,hz){
  if(hz<points[0].frequency_hz||hz>points.at(-1).frequency_hz) throw new Error('Calibration curve không phủ toàn bộ dải quan sát.');
  let hi=1;while(hi<points.length&&points[hi].frequency_hz<hz)++hi;
  if(hi>=points.length)return points.at(-1).correction_db;
  const a=points[hi-1],b=points[hi];
  if(hz===a.frequency_hz)return a.correction_db;if(hz===b.frequency_hz)return b.correction_db;
  return a.correction_db+(b.correction_db-a.correction_db)*(hz-a.frequency_hz)/(b.frequency_hz-a.frequency_hz);
}
export function applyCalibrationCurve(samples,input){
  const curve=validateCalibrationCurve(input);
  return samples.map(sample=>{const s=validateSample(sample),v=s.rssi_dbm+interpolateCorrection(curve.points,s.frequency_hz);
    if(v<-160||v>20)throw new Error('Calibration đưa RSSI vượt miền hợp lệ.');return {...s,rssi_dbm:Math.round(v*100)/100};});
}
export function canonicalJson(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
}
export async function sha256Hex(value){
  const bytes=new TextEncoder().encode(typeof value==='string'?value:canonicalJson(value));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function sealScienceSession(session){
  if(!session||session.schema!=='rf-observatory/science-session-v1')throw new Error('Science session không đúng schema.');
  const clean={...session};delete clean.integrity;
  return {...clean,integrity:{algorithm:'SHA-256',digest:await sha256Hex(clean)}};
}
export async function verifyScienceSession(session){
  if(!session?.integrity||session.integrity.algorithm!=='SHA-256')return false;
  const clean={...session};delete clean.integrity;return (await sha256Hex(clean))===session.integrity.digest;
}
export function compareScienceSessions(a,b){
  if(a?.schema!=='rf-observatory/science-session-v1'||b?.schema!=='rf-observatory/science-session-v1')throw new Error('Cần hai science session v1.');
  const gridMatch=a.grid?.start_hz===b.grid?.start_hz&&a.grid?.stop_hz===b.grid?.stop_hz&&a.grid?.step_hz===b.grid?.step_hz&&a.grid?.bins===b.grid?.bins;
  return {profile_match:a.profile===b.profile,grid_match:gridMatch,calibration_match:a.calibration_state===b.calibration_state,
    baseline_delta_db:Number.isFinite(a.analysis?.baseline_dbm)&&Number.isFinite(b.analysis?.baseline_dbm)?Math.round((b.analysis.baseline_dbm-a.analysis.baseline_dbm)*100)/100:null,
    peak_frequency_delta_hz:Number.isSafeInteger(a.analysis?.peak_frequency_hz)&&Number.isSafeInteger(b.analysis?.peak_frequency_hz)?b.analysis.peak_frequency_hz-a.analysis.peak_frequency_hz:null,
    candidate_count_delta:Number.isSafeInteger(a.analysis?.candidate_count)&&Number.isSafeInteger(b.analysis?.candidate_count)?b.analysis.candidate_count-a.analysis.candidate_count:null};
}
