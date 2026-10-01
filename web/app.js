import {presets, demoSweep, parseRecording, SweepAssembler, ScanHistory, findPeaks, MAX_RECORDS, MAX_FILE_BYTES} from './model.js';
const $ = id => document.getElementById(id);
const history = new ScanHistory();
let mode = 'demo', running = false, timer = null, sweep = 0, records = [], port = null, reader = null, connecting = false;
let serialSession = 0;
const mhz = hz => (hz / 1e6).toFixed(3);
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function sourceLabel(samples) {
  const simulated = !samples.length || samples[0].source === 'simulation';
  $('source').textContent = `${mode === 'file' ? 'BẢN GHI · ' : ''}${simulated ? 'MÔ PHỎNG' : 'THIẾT BỊ'}`;
  $('source').classList.toggle('live', !simulated);
}
function clear() {
  history.clear(); records = []; sweep = 0;
  $('export').disabled = true;
  render();
}
function accept(samples) {
  if (history.samples.length && (samples[0].source !== history.samples[0].source ||
      samples.length !== history.samples.length || samples.some((s,i)=>s.frequency_hz !== history.samples[i].frequency_hz))) records = [];
  history.add(samples);
  records.push(...samples);
  // Evict complete oldest sweeps so an export always begins at index zero.
  while (records.length > MAX_RECORDS) records.splice(0, records[0].total);
  $('export').disabled = false;
  sourceLabel(samples); render();
}
function runningState(value) {
  running = value; document.body.classList.toggle('running', value);
  $('scan').textContent = value ? 'Tạm dừng' : 'Bắt đầu quét';
  $('status').textContent = value ? 'Đang quét' : 'Đã dừng';
}
function stop() { clearInterval(timer); timer = null; runningState(false); }
function demoTick() { accept(demoSweep(presets[$('profile').value], ++sweep)); }
$('scan').addEventListener('click', () => {
  if (running) { stop(); return; }
  if (mode !== 'demo') { mode = 'demo'; clear(); }
  runningState(true); demoTick(); timer = setInterval(demoTick, 700);
  notice('Chế độ mô phỏng · Không phát sóng RF.');
});
$('profile').addEventListener('change', () => { clear(); if(running) demoTick(); });
$('reset').addEventListener('click', () => { clear(); notice('Đã xóa lịch sử và peak hold.'); });
$('threshold').addEventListener('input', () => { $('threshold-value').textContent = `${$('threshold').value} dBm`; render(); });
$('hold').addEventListener('change', render);
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('Tệp vượt 8 MB.');
    const rows = parseRecording(await file.text());
    const assembler = new SweepAssembler(), sweeps = [];
    for(const row of rows) { const complete=assembler.accept(row); if(complete) sweeps.push(complete); }
    if (!sweeps.length || assembler.pending.length) throw new Error('Bản ghi không chứa các vòng quét hoàn chỉnh.');
    const source = sweeps[0][0].source;
    const frequencies = sweeps[0].map(s=>s.frequency_hz).join(',');
    if(sweeps.some(s=>s[0].source !== source || s.map(r=>r.frequency_hz).join(',') !== frequencies))
      throw new Error('Một bản ghi chỉ được chứa một nguồn và một dải quét.');
    stop(); mode='file'; clear(); for(const samples of sweeps) accept(samples);
    $('status').textContent = 'Bản ghi';
    notice(`Đã mở ${sweeps.length} vòng quét · ${rows.length} mẫu.`);
  } catch(e) { notice(e.message,true); }
  finally { $('file').value=''; }
});
$('export').addEventListener('click', () => {
  const blob = new Blob([records.map(s=>JSON.stringify(s)).join('\n')+'\n'], {type:'application/x-ndjson'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`rf-${history.samples[0]?.source || 'simulation'}-${Date.now()}.jsonl`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

function serialControls(connected) {
  for(const id of ['scan','profile','import']) $(id).disabled=connected;
  $('serial').textContent=connected?'Ngắt USB':'Kết nối USB';
  $('connection').textContent=connected?'USB · 115200 baud':'Chưa kết nối ESP32';
}
async function disconnect() {
  ++serialSession;
  const oldReader=reader, oldPort=port; reader=null; port=null;
  try { await oldReader?.cancel(); } catch { /* Device may already be unplugged. */ }
  try { oldReader?.releaseLock(); await oldPort?.close(); } catch { /* OS closed port. */ }
  stop(); serialControls(false); mode='file';
  sourceLabel(history.samples);
  notice('Đã ngắt USB · Dữ liệu đang hiển thị là bản ghi cuối.');
}
$('serial').addEventListener('click', async () => {
  if(connecting) return;
  if(port) { await disconnect(); return; }
  if(!('serial' in navigator)) { notice('Web Serial cần Chrome/Edge trên HTTPS hoặc localhost.',true); return; }
  connecting=true; $('serial').disabled=true;
  let selected;
  try {
    selected=await navigator.serial.requestPort();
    await selected.open({baudRate:115200});
    stop(); clear(); mode='serial'; port=selected; serialControls(true); runningState(true);
    $('source').textContent='USB · CHỜ MẪU'; $('source').classList.remove('live');
    $('status').textContent='Đang nhận USB';
    notice('Đọc JSONL từ thiết bị · Nhãn nguồn theo firmware.');
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
        if(!line.startsWith('{')) continue; // Ignore ESP-IDF boot/log lines.
        try {
          if(line.length>2048) throw new Error('Bản tin USB quá dài.');
          const message=JSON.parse(line);
          if(message.type==='error') { assembler.reset(); throw new Error('Firmware báo lỗi quét.'); }
          const complete=assembler.accept(message); if(complete) accept(complete);
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
    c.fillRect(i*w/row.length,ri*h/100,Math.ceil(w/row.length),Math.ceil(h/100));
  }));
}
function render() {
  const samples=history.samples,peaks=findPeaks(samples,Number($('threshold').value));
  const strongest=samples.reduce((best,s)=>!best||s.rssi_dbm>best.rssi_dbm?s:best,null);
  $('strongest').replaceChildren(document.createTextNode(strongest?strongest.rssi_dbm.toFixed(1)+' ':'— '));
  const unit=document.createElement('small');unit.textContent='dBm';$('strongest').append(unit);
  $('peak-frequency').textContent=strongest?`${mhz(strongest.frequency_hz)} MHz`:'Chưa có dữ liệu';
  $('peak-count').textContent=String(peaks.length).padStart(2,'0');
  $('sweep-count').textContent=String(history.total).padStart(3,'0');
  $('sample-count').textContent=`${samples.length} mẫu / vòng`;
  const profile=presets[$('profile').value],start=samples[0]?.frequency_hz??profile.start,end=samples.at(-1)?.frequency_hz??profile.stop;
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
