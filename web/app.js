import {ObservationSession, parseEvidence, compareBundles, MAX_BUNDLE_BYTES} from './science.js';
import {presets, demoSweep, SweepAssembler, ScanHistory, findPeaks, MAX_FILE_BYTES, SCIENCE_HISTORY_ROWS, analyzePassiveSpectrum, validateSpectrumFrame, spectrumFrameToSamples, validateHardwareManifest, validateCalibrationCurve, sha256Hex, validateRfiMasks} from './model.js';
import {CandidatePersistence, resonantPowerEstimate} from './weak-signal.js';
const $ = id => document.getElementById(id);
const history = new ScanHistory(SCIENCE_HISTORY_ROWS);
const persistence = new CandidatePersistence({minHits:3,maxGap:1});
let mode = 'demo', running = false, timer = null, sweep = 0, port = null, reader = null, connecting = false;
let serialSession = 0;
let calibrationCurve=null, hardwareManifest=null, rfiMasks=[], gateway=null, persistentCandidates=[], resonantEstimate=null;
const mhz = hz => (hz / 1e6).toFixed(3);
const integrationCount = () => Number($('integration').value);
let observation;
function newObservation() { return new ObservationSession({profileKey:$('profile').value,integrationSweeps:integrationCount(),manifest:hardwareManifest,curve:calibrationCurve,masks:rfiMasks}); }
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function sourceLabel(samples) {
  const simulated = !samples.length || samples[0].source === 'simulation';
  const prefix=mode==='file'?'BẢN GHI · ':mode==='gateway'?'GATEWAY · ':'';
  $('source').textContent = `${prefix}${simulated ? 'MÔ PHỎNG' : 'THIẾT BỊ'}`;
  $('source').classList.toggle('live', !simulated);
}
function clear() {
  observation=newObservation();
  history.clear(); persistence.reset(); persistentCandidates=[]; resonantEstimate=null; sweep = 0;
  $('export').disabled = true; $('export-session').disabled = true;
  renderRfiMasks();
render();
}
function accept(samples, frame=null) {
  observation ??= newObservation();
  let displaySamples;
  const gapsBefore=observation.gaps;
  try { displaySamples=observation.accept(samples,frame); }
  finally { $('export').disabled=!observation.raw.length; $('export-session').disabled=!observation.raw.length; }
  if(observation.gaps!==gapsBefore){persistence.reset();persistentCandidates=[];}
  if (!displaySamples) { notice(`Đã lưu raw · chờ tích phân ${observation.pending.length}/${integrationCount()}`); return; }
  history.add(displaySamples);
  const activeProfile=presets[$('profile').value];
  const weakAnalysis=analyzePassiveSpectrum(displaySamples,activeProfile,12,rfiMasks);
  persistentCandidates=persistence.update(weakAnalysis,displaySamples.length>1?displaySamples[1].frequency_hz-displaySamples[0].frequency_hz:1).persistent;
  const center=Number.isFinite(activeProfile.referenceHz) ? activeProfile.referenceHz : weakAnalysis.peak_frequency_hz;
  resonantEstimate=center ? resonantPowerEstimate(displaySamples,center,100) : null;
  sourceLabel(samples); render();
}
function runningState(value) {
  running = value; document.body.classList.toggle('running', value);
  $('scan').textContent = value ? 'Tạm dừng' : 'Bắt đầu quét';
  $('status').textContent = value ? 'Đang quét' : 'Đã dừng';
}
function stop() { clearInterval(timer); timer = null; runningState(false); }
function demoTick() {
  try { accept(demoSweep(presets[$('profile').value], ++sweep)); }
  catch(e) { stop(); notice(e.message,true); }
}
$('scan').addEventListener('click', () => {
  if (running) { stop(); return; }
  if (mode !== 'demo') { if(observation?.raw.length){notice('Xuất và xóa phiên trước khi chuyển sang mô phỏng.',true);return;} mode = 'demo'; clear(); }
  runningState(true); demoTick(); if(running) timer = setInterval(demoTick, 700);
  if(running) notice('Mô phỏng thu thụ động · Candidate cần hiệu chuẩn, loại RFI và xác nhận độc lập.');
});
$('profile').addEventListener('change', () => { clear(); if(running) demoTick(); });
$('integration').addEventListener('change', () => { clear(); if(running) demoTick(); });
$('reset').addEventListener('click', () => { clear(); notice('Đã xóa lịch sử, peak hold và science session.'); });
$('threshold').addEventListener('input', () => { $('threshold-value').textContent = `${$('threshold').value} dBm`; render(); });
$('hold').addEventListener('change', render);
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('Tệp vượt 8 MB.');
    const groups=parseEvidence(await file.text());
    const candidate=newObservation();
    for (const g of groups) candidate.accept(g.samples,g.frame);
    stop(); mode='file'; clear();
    for (const g of groups) accept(g.samples,g.frame);
    $('status').textContent = 'Bản ghi';
    notice(`Đã mở ${groups.length} vòng quét · raw và metadata được giữ nguyên.`);
  } catch(e) { notice(e.message,true); }
  finally { $('file').value=''; }
});
$('export').addEventListener('click', () => {
  const blob = new Blob([observation.rawText()], {type:'application/x-ndjson'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`rf-${observation.raw[0]?.source || 'simulation'}-${Date.now()}.jsonl`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('export-session').addEventListener('click', async () => {
  try {
    const session=await observation.bundle();
    const blob=new Blob([JSON.stringify(session)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`rf-science-session-${session.profile}-${Date.now()}.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    notice('Đã xuất raw + metadata + kết quả · checksum SHA-256.');
  } catch(e) { notice(e.message,true); }
});

async function readSmallJson(file,limit=65536) {
  if(file.size>limit)throw new Error('Tệp vượt giới hạn dung lượng.');
  return JSON.parse(await file.text());
}
function requireEmptySession() {
  if(observation?.raw.length)throw new Error('Xuất dữ liệu và xóa phiên trước khi đổi hardware/calibration.');
}
$('calibration-btn').addEventListener('click',()=>$('calibration-file').click());
$('calibration-file').addEventListener('change',async()=>{const file=$('calibration-file').files[0];if(!file)return;try{
  requireEmptySession();const next=validateCalibrationCurve(await readSmallJson(file));await sha256Hex(next);
  requireEmptySession();calibrationCurve=next;clear();notice('Đã nạp correction curve · chưa xác nhận hiệu chuẩn vật lý.');
}catch(e){notice(e.message,true);}finally{$('calibration-file').value='';}});
$('manifest-btn').addEventListener('click',()=>$('manifest-file').click());
$('manifest-file').addEventListener('change',async()=>{const file=$('manifest-file').files[0];if(!file)return;try{
  requireEmptySession();const next=validateHardwareManifest(await readSmallJson(file));await sha256Hex(next);
  requireEmptySession();hardwareManifest=next;clear();notice('Đã nạp hardware manifest receive-only.');
}catch(e){notice(e.message,true);}finally{$('manifest-file').value='';}});
function masksChanged() {
  observation?.setMasks(rfiMasks);persistence.reset();persistentCandidates=[];renderRfiMasks();render();
}
function renderRfiMasks(){$('rfi-count').textContent=String(rfiMasks.length);$('rfi-list').replaceChildren();for(const [i,m] of rfiMasks.entries()){const row=document.createElement('div'),span=document.createElement('span'),del=document.createElement('button');span.textContent=`${(m.start_hz/1e6).toFixed(3)}–${(m.stop_hz/1e6).toFixed(3)} MHz · ${m.label}`;del.textContent='×';del.addEventListener('click',()=>{rfiMasks.splice(i,1);masksChanged();});row.append(span,del);$('rfi-list').append(row);}}
$('rfi-btn').addEventListener('click',()=>$('rfi-dialog').showModal());$('rfi-close').addEventListener('click',()=>$('rfi-dialog').close());
$('rfi-add').addEventListener('click',()=>{try{rfiMasks=validateRfiMasks([...rfiMasks,{start_hz:Math.round(Number($('rfi-start').value)*1e6),stop_hz:Math.round(Number($('rfi-stop').value)*1e6),label:$('rfi-label').value||'local-rfi'}]);masksChanged();notice('RFI mask added as quality flag; raw evidence untouched.');}catch(e){notice(e.message,true);}});
function gatewayControls(connected){for(const id of ['scan','profile','integration','import','serial','manifest-btn','calibration-btn'])$(id).disabled=connected;$('gateway').textContent=connected?'Ngắt Gateway':'Gateway local';}
async function disconnectGateway(){gateway?.close();gateway=null;gatewayControls(false);stop();mode='file';sourceLabel(history.samples);notice('Đã ngắt local gateway.');}
$('gateway').addEventListener('click',async()=>{
  if(gateway){await disconnectGateway();return;}
  if(port||connecting){notice('Ngắt USB trước khi mở Gateway.',true);return;}
  try{requireEmptySession();stop();clear();mode='gateway';gatewayControls(true);runningState(true);
    $('status').textContent='Gateway local';$('source').textContent='GATEWAY · CHỜ PHỔ';
    gateway=new EventSource('http://127.0.0.1:8787/events');
    gateway.onmessage=event=>{try{const frame=validateSpectrumFrame(JSON.parse(event.data));accept(spectrumFrameToSamples(frame),frame);}
      catch(e){gateway?.close();gateway=null;gatewayControls(false);stop();notice(`Gateway đã dừng: ${e.message}`,true);}};
    gateway.onerror=()=>{gateway?.close();gateway=null;gatewayControls(false);stop();notice('Gateway mất kết nối. Raw còn ở archive; xuất phiên trước khi kết nối lại.',true);};
    notice('Gateway chỉ đọc · raw được lưu tại acquisition host.');
  }catch(e){gateway?.close();gateway=null;gatewayControls(false);stop();notice(e.message,true);}
});
$('compare-btn').addEventListener('click',()=>$('compare-file').click());
$('compare-file').addEventListener('change',async()=>{const fs=[...$('compare-file').files];try{
  if(fs.length!==2)throw new Error('Chọn đúng 2 science session v2.');
  const [a,b]=await Promise.all(fs.map(f=>readSmallJson(f,MAX_BUNDLE_BYTES))),c=await compareBundles(a,b);
  notice(c.comparable?`Integrity OK · Δbaseline ${c.baseline_delta_db} dB · Δpeak ${c.peak_frequency_delta_hz} Hz`:`Không thể so sánh: ${c.reasons.join(', ')}`,!c.comparable);
}catch(e){notice(e.message,true);}finally{$('compare-file').value='';}});

function serialControls(connected) {
  for(const id of ['scan','profile','integration','import','gateway','manifest-btn','calibration-btn']) $(id).disabled=connected;
  $('serial').textContent=connected?'Ngắt USB':'Kết nối USB';
  $('connection').textContent=connected?'USB · 115200 baud':'Chưa kết nối ESP32';
}
async function disconnect() {
  ++serialSession;
  const oldReader=reader, oldPort=port; reader=null; port=null;
  try { await oldReader?.cancel(); } catch {}
  try { oldReader?.releaseLock(); await oldPort?.close(); } catch {}
  stop(); serialControls(false); mode='file';
  sourceLabel(history.samples);
  notice('Đã ngắt USB · Dữ liệu đang hiển thị là bản ghi cuối.');
}
$('serial').addEventListener('click', async () => {
  if(connecting || gateway) return;
  if(port) { await disconnect(); return; }
  if(!('serial' in navigator)) { notice('Web Serial cần Chrome/Edge trên HTTPS hoặc localhost.',true); return; }
  try{requireEmptySession();}catch(e){notice(e.message,true);return;}
  connecting=true; $('serial').disabled=true;
  let selected;
  try {
    selected=await navigator.serial.requestPort();
    await selected.open({baudRate:115200});
    stop(); clear(); mode='serial'; port=selected; serialControls(true); runningState(true);
    $('source').textContent='USB · CHỜ MẪU'; $('source').classList.remove('live');
    $('status').textContent='Đang nhận USB';
    notice('Đọc JSONL thụ động từ thiết bị · Nhãn nguồn theo firmware.');
    const token=++serialSession;
    reader=selected.readable.getReader();
    const activeReader=reader, decoder=new TextDecoder(), assembler=new SweepAssembler();
    let buffer='';
    connecting=false; $('serial').disabled=false;
    while(token===serialSession) {
      const {value,done}=await activeReader.read(); if(done) break;
      buffer+=decoder.decode(value,{stream:true});
      let newline;
      while((newline=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,newline).trim(); buffer=buffer.slice(newline+1);
        if(!line.startsWith('{')) continue;
        try {
          if(line.length>2048) throw new Error('Bản tin USB quá dài.');
          const message=JSON.parse(line);
          if(message.type==='error') { assembler.reset(); throw new Error('Firmware báo lỗi quét.'); }
          const complete=assembler.accept(message);
          if(complete) { try { accept(complete); } catch(e) { await disconnect(); notice(e.message,true); return; } }
        } catch(e) { assembler.reset(); notice(e.message,true); }
      }
      if(buffer.length>2048) { buffer=''; assembler.reset(); notice('Đã bỏ dòng USB quá dài.',true); }
    }
    if(token===serialSession) { await disconnect(); notice('Luồng USB đã đóng.',true); }
  } catch(e) {
    if(port===selected) await disconnect();
    else { try { await selected?.close(); } catch {} }
    notice(e.name==='NotFoundError'?'Chưa chọn thiết bị USB.':`USB: ${e.message}`, e.name!=='NotFoundError');
  } finally { connecting=false; $('serial').disabled=false; }
});

function canvas(id) {
  const el=$(id), rect=el.getBoundingClientRect(), dpr=Math.min(devicePixelRatio || 1,2);
  const width=Math.max(1,rect.width), height=Math.max(1,rect.height);
  el.width=Math.round(width*dpr); el.height=Math.round(height*dpr);
  const ctx=el.getContext('2d'); ctx.scale(dpr,dpr); ctx.font='10px system-ui';
  return {ctx,width,height};
}
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
function drawPolar() {
  const {ctx:c,width:w,height:h}=canvas('polar'), cx=w/2,cy=h/2-5,r=Math.max(10,Math.min(w,h)/2-32);
  c.strokeStyle='#203a3d'; c.lineWidth=1;
  for(let i=1;i<=4;i++) { c.beginPath(); c.arc(cx,cy,r*i/4,0,Math.PI*2); c.stroke(); }
  for(let i=0;i<12;i++) { const a=i*Math.PI/6; c.beginPath(); c.moveTo(cx,cy); c.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r); c.stroke(); }
  c.fillStyle='#63858b'; c.font='8px system-ui'; c.fillText('−120',cx+4,cy-5); c.fillText('−30 dBm',cx+6,cy-r+11);
  const samples=history.samples;
  if(samples.length) {
    const n=samples.length;
    c.beginPath();
    samples.forEach((s,i)=> { const a=(i/n)*Math.PI*2-Math.PI/2,rr=r*clamp((s.rssi_dbm+120)/90,.06,1),x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr; i?c.lineTo(x,y):c.moveTo(x,y); });
    c.closePath(); c.fillStyle='#68e7ba10'; c.fill(); c.strokeStyle='#6fe6bd70'; c.stroke();
    for(const s of findPeaks(samples,Number($('threshold').value))) {
      const a=s.index/n*Math.PI*2-Math.PI/2, rr=r*clamp((s.rssi_dbm+120)/90,.06,1),x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr;
      c.fillStyle='#6fe6bd18'; c.beginPath(); c.arc(x,y,12,0,Math.PI*2);c.fill();
      c.fillStyle='#89ffd1';c.beginPath();c.arc(x,y,3,0,Math.PI*2);c.fill();
      c.fillStyle='#cee5df'; c.fillText(`${mhz(s.frequency_hz)}`,clamp(x+8,4,w-58),y-8);
    }
    const a=(history.total%36)/36*Math.PI*2-Math.PI/2;
    c.strokeStyle='#6fe6bd80';c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);c.stroke();
  } else { c.fillStyle='#8799a4'; c.textAlign='center'; c.fillText('CHƯA CÓ DỮ LIỆU',cx,cy+25); }
}
function drawSpectrum() {
  const {ctx:c,width:w,height:h}=canvas('spectrum'),left=42,right=w-20,top=14,bottom=h-26;
  const y=v=>bottom-clamp((v+120)/90,0,1)*(bottom-top);
  c.font='9px system-ui';c.fillStyle='#708995';c.strokeStyle='#24343b';
  for(const v of [-120,-90,-60,-30]) { c.fillText(String(v),10,y(v)+3);c.beginPath();c.moveTo(left,y(v));c.lineTo(right,y(v));c.stroke(); }
  const samples=history.samples;
  if(!samples.length) return;
  const first=samples[0].frequency_hz,last=samples.at(-1).frequency_hz;
  const x=i=>left+(samples[i].frequency_hz-first)/Math.max(1,last-first)*(right-left);
  const path=values=> { c.beginPath();values.forEach((v,i)=>i?c.lineTo(x(i),y(v)):c.moveTo(x(i),y(v))); };
  if($('hold').checked) { path(history.hold); c.strokeStyle='#b99b5d';c.setLineDash([3,3]);c.stroke();c.setLineDash([]); }
  path(samples.map(s=>s.rssi_dbm));c.strokeStyle='#6fe6bd';c.lineWidth=1.6;c.stroke();
  c.lineTo(x(samples.length-1),bottom);c.lineTo(left,bottom);c.closePath();
  const gradient=c.createLinearGradient(0,top,0,bottom);gradient.addColorStop(0,'#6fe6bd35');gradient.addColorStop(1,'#6fe6bd00');c.fillStyle=gradient;c.fill();
  c.lineWidth=1;c.setLineDash([3,5]);c.strokeStyle='#8799a450';c.beginPath();c.moveTo(left,y(Number($('threshold').value)));c.lineTo(right,y(Number($('threshold').value)));c.stroke();c.setLineDash([]);
  c.fillStyle='#8799a4';c.textAlign='left';c.fillText(mhz(first),left,h-8);c.textAlign='right';c.fillText(`${mhz(last)} MHz`,right,h-8);
}
function drawWaterfall() {
  const {ctx:c,width:w,height:h}=canvas('waterfall');c.fillStyle='#0b141c';c.fillRect(0,0,w,h);
  const rows=history.rows;
  rows.forEach((row,ri)=>row.forEach((v,i)=> {
    const t=clamp((v+120)/90,0,1);
    c.fillStyle=`hsl(${205-t*155} ${45+t*25}% ${8+t*49}%)`;
    c.fillRect(i*w/row.length,ri*h/history.limit,Math.ceil(w/row.length),Math.ceil(h/history.limit));
  }));
}
function render() {
  const samples=history.samples,peaks=findPeaks(samples,Number($('threshold').value));
  const profile=presets[$('profile').value];
  const analysis=analyzePassiveSpectrum(samples,profile,12,rfiMasks);
  const scienceCandidates=analysis.candidates.filter(c=>!c.quality_flags.length);
  const strongest=samples.reduce((best,s)=>!best||s.rssi_dbm>best.rssi_dbm?s:best,null);
  $('strongest').replaceChildren(document.createTextNode(strongest?strongest.rssi_dbm.toFixed(1)+' ':'— '));
  const unit=document.createElement('small');unit.textContent='dBm';$('strongest').append(unit);
  $('peak-frequency').textContent=strongest?`${mhz(strongest.frequency_hz)} MHz`:'Chưa có dữ liệu';
  $('baseline').textContent=analysis.baseline_dbm==null?'—':`${analysis.baseline_dbm.toFixed(1)}`;
  $('candidate-count').textContent=String(scienceCandidates.length).padStart(2,'0');
  $('persistent-count').textContent=String(persistentCandidates.length).padStart(2,'0');
  $('resonant-level').textContent=resonantEstimate?`${resonantEstimate.power_dbm.toFixed(1)} dBm · Q100`:'Chưa khóa cộng hưởng';
  $('peak-count').textContent=String(peaks.length).padStart(2,'0');
  $('sweep-count').textContent=String(history.total).padStart(3,'0');
  $('sample-count').textContent=`${samples.length} mẫu / vòng · ×${integrationCount()}`;
  const start=samples[0]?.frequency_hz??profile.start,end=samples.at(-1)?.frequency_hz??profile.stop;
  $('band').textContent=`${mhz(start)}–${mhz(end)}`;
  const step=samples.length>1?samples[1].frequency_hz-samples[0].frequency_hz:profile.step;
  const uniform=samples.length<3||samples.slice(1).every((s,i)=>s.frequency_hz-samples[i].frequency_hz===step);
  $('resolution').textContent=`MHz · ${uniform?'Bước '+(step/1000)+' kHz':'Bước không đều'}`;
  $('signals').replaceChildren();
  for(const s of peaks) {
    const tr=document.createElement('tr');
    for(const text of [`${mhz(s.frequency_hz)} MHz`,`${s.rssi_dbm.toFixed(1)}`]) { const td=document.createElement('td');td.textContent=text;tr.append(td); }
    const td=document.createElement('td'),meter=document.createElement('span'),bar=document.createElement('i');
    meter.className='meter';bar.style.width=`${clamp((s.rssi_dbm+120)/90*100,0,100)}%`;meter.append(bar);td.append(meter);tr.append(td);$('signals').append(tr);
  }
  if(!peaks.length) {const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.className='empty';td.textContent=samples.length?'Không có đỉnh vượt ngưỡng':'Bắt đầu quét để xem tín hiệu';tr.append(td);$('signals').append(tr);}
  drawPolar();drawSpectrum();drawWaterfall();
}
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(render,80);});
render();

