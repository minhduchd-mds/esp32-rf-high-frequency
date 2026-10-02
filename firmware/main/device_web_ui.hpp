#pragma once

namespace rf_web {
inline constexpr char kDeviceHtml[] = R"HTML(<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>RF Observatory · ESP32-S3</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#071014;color:#d8e8e4;font:14px/1.45 system-ui,-apple-system,sans-serif}
header{min-height:68px;padding:14px 20px;border-bottom:1px solid #173036;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#0a151a}
.brand{display:flex;align-items:center;gap:10px}.orb{font-size:30px;color:#6fe6bd}.brand b{font-size:17px}.brand small{display:block;color:#789198;font-size:8px;letter-spacing:1.8px}
.badge{font-size:9px;letter-spacing:1px;color:#83f2cb;border:1px solid #295a4d;background:#102a24;border-radius:4px;padding:5px 8px}
main{max-width:1200px;margin:auto;padding:20px}.eyebrow{font-size:9px;letter-spacing:1.7px;color:#789198;margin:0 0 5px}h1{font-size:26px;letter-spacing:-.8px;margin:0 0 18px;font-weight:560}
.stats{display:grid;grid-template-columns:repeat(6,1fr);border:1px solid #173036;background:#0b171c;border-radius:10px;overflow:hidden}
.stat{padding:14px;border-right:1px solid #173036;min-width:0}.stat:last-child{border:0}.stat span{display:block;color:#789198;font-size:8px;letter-spacing:1.1px}
.stat strong{display:block;margin-top:5px;font-size:20px;font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grid{display:grid;grid-template-columns:1.65fr .8fr;gap:14px;margin-top:14px}.panel{border:1px solid #173036;background:#0b171c;border-radius:10px;overflow:hidden}
.ph{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #13282e}.ph h2{font-size:12px;margin:0;font-weight:560}.ph span{font-size:9px;color:#789198}
canvas{display:block;width:100%;height:330px}.list{padding:8px 14px 14px}.row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:8px 0;border-bottom:1px solid #ffffff08;font-variant-numeric:tabular-nums}.row:last-child{border:0}.muted{color:#789198}
footer{display:flex;justify-content:space-between;gap:14px;color:#789198;font-size:9px;padding:14px 0 2px}
@media(max-width:850px){.stats{grid-template-columns:repeat(3,1fr)}.stat:nth-child(3){border-right:0}.grid{grid-template-columns:1fr}}
@media(max-width:520px){main{padding:16px 12px}.stats{grid-template-columns:1fr 1fr}.stat:nth-child(odd){border-right:1px solid #173036}.stat:nth-child(even){border-right:0}canvas{height:250px}header{padding:12px}.brand b{font-size:15px}}
</style>
</head>
<body>
<header><div class="brand"><span class="orb">◎</span><div><b>RF Observatory</b><small>ESP32-S3 DEVICE CONSOLE</small></div></div><span class="badge">HTTPS · RECEIVE ONLY</span></header>
<main>
<p class="eyebrow">ON-DEVICE TELEMETRY / PORT 443</p><h1>Weak Signal Edge Node</h1>
<section class="stats">
<div class="stat"><span>IP</span><strong id="ip">—</strong></div>
<div class="stat"><span>RSSI WIFI</span><strong id="wifi">—</strong></div>
<div class="stat"><span>FREE HEAP</span><strong id="heap">—</strong></div>
<div class="stat"><span>SWEEP</span><strong id="sweep">000</strong></div>
<div class="stat"><span>BINS</span><strong id="bins">0</strong></div>
<div class="stat"><span>UPTIME</span><strong id="uptime">—</strong></div>
</section>
<div class="grid">
<section class="panel"><div class="ph"><h2>Phổ mới nhất</h2><span>RSSI / MHz</span></div><canvas id="spectrum"></canvas></section>
<section class="panel"><div class="ph"><h2>Đỉnh tín hiệu</h2><span>TOP 6</span></div><div id="peaks" class="list"><div class="muted">Chưa có dữ liệu</div></div></section>
</div>
<footer><span id="state">Đang kết nối telemetry…</span><span>ESP32-S3 · TLS local console · Không có RF command API</span></footer>
</main>
<script>
const $=id=>document.getElementById(id), clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function fmtTime(ms){let s=Math.floor(ms/1000),h=Math.floor(s/3600);s%=3600;let m=Math.floor(s/60);s%=60;return h+'h '+m+'m '+s+'s'}
async function status(){try{let r=await fetch('/api/status',{cache:'no-store'}),d=await r.json();$('ip').textContent=d.ip;$('wifi').textContent=d.wifi_rssi+' dBm';$('heap').textContent=Math.round(d.free_heap/1024)+' KB';$('sweep').textContent=String(d.sweep).padStart(3,'0');$('bins').textContent=d.bins;$('uptime').textContent=fmtTime(d.uptime_ms);$('state').textContent='HTTPS online · '+d.target+' · '+d.mode}catch(e){$('state').textContent='Telemetry unavailable'}}
function draw(d){const c=$('spectrum'),rect=c.getBoundingClientRect(),pr=Math.min(devicePixelRatio||1,2),w=Math.max(1,rect.width),h=Math.max(1,rect.height);c.width=w*pr;c.height=h*pr;let x=c.getContext('2d');x.scale(pr,pr);x.fillStyle='#071014';x.fillRect(0,0,w,h);if(!d.samples.length)return;let l=42,r=w-16,t=16,b=h-28,y=v=>b-clamp((v+120)/90,0,1)*(b-t);x.font='9px system-ui';x.strokeStyle='#173036';x.fillStyle='#789198';[-120,-90,-60,-30].forEach(v=>{x.fillText(v,7,y(v)+3);x.beginPath();x.moveTo(l,y(v));x.lineTo(r,y(v));x.stroke()});let f0=d.samples[0][0],f1=d.samples.at(-1)[0],xx=f=>l+(f-f0)/Math.max(1,f1-f0)*(r-l);x.beginPath();d.samples.forEach((p,i)=>i?x.lineTo(xx(p[0]),y(p[1])):x.moveTo(xx(p[0]),y(p[1])));x.strokeStyle='#6fe6bd';x.lineWidth=1.5;x.stroke();x.fillStyle='#789198';x.fillText((f0/1e6).toFixed(3),l,h-8);x.textAlign='right';x.fillText((f1/1e6).toFixed(3)+' MHz',r,h-8)}
function peaks(d){let a=d.samples.map((p,i)=>({f:p[0],v:p[1],i})).filter((p,i,a)=>(i===0||p.v>a[i-1].v)&&(i===a.length-1||p.v>=a[i+1].v)).sort((a,b)=>b.v-a.v).slice(0,6);$('peaks').replaceChildren(...a.map(p=>{let q=document.createElement('div');q.className='row';let f=document.createElement('span'),v=document.createElement('b');f.textContent=(p.f/1e6).toFixed(3)+' MHz';v.textContent=p.v.toFixed(1)+' dBm';q.append(f,v);return q}));if(!a.length)$('peaks').innerHTML='<div class="muted">Chưa có dữ liệu</div>'}
async function spectrum(){try{let r=await fetch('/api/spectrum',{cache:'no-store'}),d=await r.json();draw(d);peaks(d)}catch(e){}}
status();spectrum();setInterval(status,1000);setInterval(spectrum,1200);addEventListener('resize',spectrum);
</script>
</body></html>)HTML";
}
