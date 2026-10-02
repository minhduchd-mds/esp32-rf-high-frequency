import {MAX_FILE_BYTES, MAX_RECORDS, presets, validateSample, validateSpectrumFrame, spectrumFrameToSamples,
  SweepAssembler, averageSweeps, analyzePassiveSpectrum, validateHardwareManifest, validateCalibrationCurve,
  applyCalibrationCurve, validateRfiMasks, canonicalJson, sha256Hex} from './model.js';

export const BUNDLE_SCHEMA = 'rf-observatory/science-session-v2';
export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const copy = value => JSON.parse(JSON.stringify(value));
const grid = samples => samples.map(s=>s.frequency_hz).join(',');
const encodedSize = value => new TextEncoder().encode(JSON.stringify(value)).length;

export function parseEvidence(text) {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Tệp vượt 8 MB.');
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  if (!lines.length || lines.length > MAX_RECORDS) throw new Error('Bản ghi rỗng hoặc quá lớn.');
  const assembler = new SweepAssembler(), groups = [];
  let kind = null;
  for (const line of lines) {
    const raw = JSON.parse(line), nextKind = raw.version === 2 ? 'spectrum' : 'sample';
    if (kind && kind !== nextKind) throw new Error('Không trộn giao thức trong một bản ghi.');
    kind = nextKind;
    if (kind === 'spectrum') {
      const frame = validateSpectrumFrame(raw);
      groups.push({samples:spectrumFrameToSamples(frame), frame});
    } else {
      const samples = assembler.accept(raw);
      if (samples) groups.push({samples, frame:null});
    }
  }
  if (assembler.pending.length || !groups.length) throw new Error('Vòng quét chưa hoàn chỉnh.');
  return groups;
}

// Bounded evidence: stop at the limit instead of silently evicting raw data.
// This is an in-memory review session. Gateway journaling is the durable acquisition path.
export class ObservationSession {
  constructor({profileKey='subghz', integrationSweeps=1, manifest=null, curve=null, masks=[], startedAt=new Date().toISOString()}={}) {
    if (!presets[profileKey] || !Number.isSafeInteger(integrationSweeps) || integrationSweeps<1 || integrationSweeps>64)
      throw new Error('Cấu hình session không hợp lệ.');
    if (!Number.isFinite(Date.parse(startedAt))) throw new Error('Thời gian session không hợp lệ.');
    this.config = {profileKey,integrationSweeps,manifest:manifest?validateHardwareManifest(manifest):null,
      curve:curve?validateCalibrationCurve(curve):null,masks:validateRfiMasks(masks),startedAt};
    this.raw=[];this.bytes=0;this.sampleCount=0;this.sweeps=0;this.gaps=0;
    this.last=null;this.key=null;this.pending=[];this.display=[];this.processingError=null;
  }
  accept(input, inputFrame=null) {
    const samples=input.map(validateSample), assembler=new SweepAssembler();
    let complete; for(const s of samples) complete=assembler.accept(s);
    if (!complete || assembler.pending.length || samples.length!==samples[0].total) throw new Error('Cần một sweep hoàn chỉnh.');
    const frame=inputFrame?validateSpectrumFrame(inputFrame):null;
    if (frame && canonicalJson(spectrumFrameToSamples(frame))!==canonicalJson(samples)) throw new Error('Frame và mẫu không khớp.');
    const metadata=frame?{rbw_hz:frame.rbw_hz,integration_ms:frame.integration_ms,calibration_state:frame.calibration_state}:{rbw_hz:null,integration_ms:null,calibration_state:'uncalibrated'};
    const key=canonicalJson({source:samples[0].source,grid:grid(samples),metadata,protocol:frame?2:1});
    if(this.key && key!==this.key) throw new Error('Nguồn/lưới/điều kiện đo đã đổi. Xuất phiên rồi bắt đầu phiên mới.');
    const first=samples[0],last=samples.at(-1);
    if(this.last && (first.sweep<=this.last.sweep || first.timestamp_ms<this.last.timestamp_ms))
      throw new Error('Frame lặp, đảo thứ tự hoặc receiver reset. Bắt đầu phiên mới.');
    const rows=frame?[frame]:samples,bytes=rows.reduce((n,r)=>n+encodedSize(r)+1,0);
    if(this.sampleCount+samples.length>MAX_RECORDS || this.bytes+bytes>MAX_FILE_BYTES)
      throw new Error('Phiên đầy. Đã dừng trước khi mất raw; xuất dữ liệu rồi bắt đầu phiên mới.');
    this.raw.push(...copy(rows));this.bytes+=bytes;this.sampleCount+=samples.length;
    const gap=this.last?first.sweep-this.last.sweep-1:0;this.gaps+=gap;
    // Do not integrate across a missing sweep.
    if(gap) this.pending=[];
    this.last={sweep:first.sweep,timestamp_ms:last.timestamp_ms};this.key=key;this.metadata=metadata;this.sweeps++;
    this.pending.push(samples);
    if(this.pending.length<this.config.integrationSweeps) return null;
    const integrated=averageSweeps(this.pending);this.pending=[];
    try {
      if(this.config.curve && metadata.calibration_state==='calibrated')throw new Error('Frame đã calibrated; không tự áp dụng correction lần hai.');
      this.display=this.config.curve?applyCalibrationCurve(integrated,this.config.curve):integrated;
      this.processingError=null;return this.display;
    } catch(e) { this.processingError=e.message;this.display=[];throw e; }
  }
  setMasks(masks) { this.config.masks=validateRfiMasks(masks); }
  rawText() { return this.raw.map(r=>JSON.stringify(r)).join('\n')+'\n'; }
  async bundle() {
    if(!this.raw.length) throw new Error('Chưa có raw evidence.');
    // Snapshot synchronously before hashing; live ingestion cannot change the sealed payload.
    const raw=copy(this.raw),config=copy(this.config),metadata=copy(this.metadata);
    const payload={schema:BUNDLE_SCHEMA,started_at:config.startedAt,profile:config.profileKey,
      source:raw[0].source,integration_sweeps:config.integrationSweeps,
      acquisition:metadata,processing_state:config.curve?'correction-applied':'raw',
      physical_calibration_verified:false,hardware_manifest:config.manifest,calibration_curve:config.curve,
      rfi_masks:config.masks,raw_records:raw,raw_count:raw.length,sample_count:this.sampleCount,
      sweep_count:this.sweeps,missing_sweeps:this.gaps,pending_sweeps:this.pending.length,
      processing_error:this.processingError,derived_samples:copy(this.display),
      statement:'Content checksum only, not an authenticated signature or physical calibration certificate.'};
    const profile=presets[config.profileKey],first=raw[0];
    const start=first.version===2?first.start_hz:first.frequency_hz;
    const stop=first.version===2?first.start_hz+first.step_hz*(first.powers_dbm.length-1):raw[first.total-1].frequency_hz;
    payload.profile_grid_compatible=start>=profile.start&&stop<=profile.stop;
    payload.raw_sha256=await sha256Hex(raw);
    payload.hardware_manifest_fingerprint=config.manifest?await sha256Hex(config.manifest):null;
    payload.calibration_curve_fingerprint=config.curve?await sha256Hex(config.curve):null;
    return {...payload,integrity:{algorithm:'SHA-256',digest:await sha256Hex(payload)}};
  }
}

export async function verifyBundle(bundle) {
  try {
    if(!bundle || bundle.schema!==BUNDLE_SCHEMA || encodedSize(bundle)>MAX_BUNDLE_BYTES || !Array.isArray(bundle.raw_records)) return false;
    if(bundle.integrity?.algorithm!=='SHA-256')return false;
    const clean={...bundle};delete clean.integrity;
    if(await sha256Hex(clean)!==bundle.integrity.digest)return false;
    const session=new ObservationSession({profileKey:bundle.profile,integrationSweeps:bundle.integration_sweeps,
      manifest:bundle.hardware_manifest,curve:bundle.calibration_curve,masks:bundle.rfi_masks,startedAt:bundle.started_at});
    const groups=parseEvidence(bundle.raw_records.map(r=>JSON.stringify(r)).join('\n'));
    for(const g of groups){
      try{session.accept(g.samples,g.frame);}catch(e){if(!session.processingError)throw e;}
    }
    // Replay validates structure, raw linkage, acquisition metadata and derived values together.
    return canonicalJson(await session.bundle())===canonicalJson(bundle);
  } catch { return false; }
}

export async function compareBundles(a,b) {
  if(!await verifyBundle(a)||!await verifyBundle(b))throw new Error('Integrity/schema/replay không hợp lệ. Không so sánh.');
  const reasons=[];
  for(const key of ['profile','source','integration_sweeps','acquisition','processing_state','hardware_manifest_fingerprint','calibration_curve_fingerprint','rfi_masks'])
    if(canonicalJson(a[key])!==canonicalJson(b[key]))reasons.push(key);
  if(!a.profile_grid_compatible||!b.profile_grid_compatible)reasons.push('profile does not cover observed grid');
  if(!a.hardware_manifest || !b.hardware_manifest)reasons.push('missing hardware manifest');
  if(a.acquisition.rbw_hz===null||a.acquisition.integration_ms===null)reasons.push('missing acquisition settings');
  if(!a.derived_samples.length||!b.derived_samples.length)reasons.push('incomplete integration or processing error');
  if(grid(a.derived_samples)!==grid(b.derived_samples))reasons.push('frequency grid');
  if(a.missing_sweeps||b.missing_sweeps)reasons.push('missing sweeps');
  if(reasons.length)return {comparable:false,reasons,baseline_delta_db:null,peak_frequency_delta_hz:null};
  const aa=analyzePassiveSpectrum(a.derived_samples,presets[a.profile],12,a.rfi_masks);
  const bb=analyzePassiveSpectrum(b.derived_samples,presets[b.profile],12,b.rfi_masks);
  if(aa.baseline_dbm===null||bb.baseline_dbm===null)return {comparable:false,reasons:['all bins masked'],baseline_delta_db:null,peak_frequency_delta_hz:null};
  return {comparable:true,reasons:[],baseline_delta_db:Math.round((bb.baseline_dbm-aa.baseline_dbm)*100)/100,
    peak_frequency_delta_hz:bb.peak_frequency_hz-aa.peak_frequency_hz};
}
