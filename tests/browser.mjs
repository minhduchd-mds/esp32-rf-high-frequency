// Optional browser integration test. Install playwright and its Chromium locally,
// or provide RF_PLAYWRIGHT_PATH and RF_CHROMIUM for an existing test runtime.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { demoSweep, presets } from '../web/model.js';
import {verifyBundle} from '../web/science.js';
const { chromium } = await import(process.env.RF_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server = http.createServer(async (req,res) => {
  const filename = path.resolve(root,'web','.'+(new URL(req.url,'http://localhost').pathname === '/'?'/index.html':new URL(req.url,'http://localhost').pathname));
  if(!filename.startsWith(root+'/web/')) {res.writeHead(403).end();return;}
  try {res.setHeader('Content-Type',types[path.extname(filename)] || 'text/plain');res.end(await fs.readFile(filename));}
  catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const errors=[];
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.RF_CHROMIUM || undefined,args:['--no-sandbox','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Bắt đầu quét'}).click();
  await page.waitForFunction(()=>document.getElementById('peak-count').textContent==='03');
  await page.getByRole('button',{name:'Tạm dừng'}).click();
  const stopped=await page.locator('#sweep-count').textContent();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#sweep-count').textContent(),stopped);
  await page.locator('#threshold').fill('-30');
  assert.equal(await page.locator('#peak-count').textContent(),'00');
  await page.locator('#threshold').fill('-85');
  const downloadWait=page.waitForEvent('download');
  await page.locator('#export').click();
  const download=await downloadWait;
  const exported=await fs.readFile(await download.path(),'utf8');
  assert.ok(exported.includes('"source":"simulation"'));
  const sessionDownload=page.waitForEvent('download');await page.locator('#export-session').click();
  const session=JSON.parse(await fs.readFile(await (await sessionDownload).path(),'utf8'));
  assert.equal(await verifyBundle(session),true);
  assert.equal(session.raw_records[0].source,'simulation');
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/desktop.png'),fullPage:true});
  await page.locator('#profile').selectOption('hf');
  await page.locator('#scan').click(); await page.locator('#scan').click();
  assert.ok((await page.locator('#band').textContent()).startsWith('7.000'));
  await page.locator('#file').setInputFiles({name:'recording.jsonl',mimeType:'text/plain',buffer:Buffer.from(exported)});
  await page.waitForFunction(()=>document.getElementById('source').textContent.startsWith('BẢN GHI'));
  const before=await page.locator('#sweep-count').textContent();
  await page.locator('#file').setInputFiles({name:'bad.jsonl',mimeType:'text/plain',buffer:Buffer.from('{bad}')});
  await page.waitForFunction(()=>document.getElementById('notice').classList.contains('error'));
  assert.equal(await page.locator('#sweep-count').textContent(),before);
  await page.locator('#reset').click();
  assert.equal(await page.locator('#sweep-count').textContent(),'000');
  assert.equal(await page.locator('#export').isDisabled(),true);
  await page.locator('#scan').click(); await page.locator('#scan').click();
  for(const [width,height] of [[1366,768],[768,1024],[390,844]]) {
    await page.setViewportSize({width,height}); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`horizontal overflow at ${width}`);
    if(width===1366) assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false,'desktop should fit 1366×768');
    assert.deepEqual(await page.locator('.stats strong').evaluateAll(els=>els.filter(el=>el.scrollWidth>el.clientWidth).map(el=>el.id)),[],`stat overflow at ${width}`);
  }
  await page.screenshot({path:path.join(root,'test-results/mobile.png'),fullPage:true});
  await page.locator('#reset').click();
  // Exercise USB lifecycle without requesting access to any real user device.
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>{throw new DOMException('cancelled','NotFoundError');}}});
  });
  await page.locator('#serial').click();
  await page.waitForFunction(()=>document.getElementById('notice').textContent==='Chưa chọn thiết bị USB.');
  assert.equal(await page.locator('#serial').isDisabled(),false);
  await page.evaluate(()=>{
    window.fakeClosed=false;
    Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>({
      open:async()=>{},close:async()=>{window.fakeClosed=true;},
      readable:new ReadableStream({start(controller){window.rfStream=controller;}})
    })}});
  });
  await page.locator('#serial').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Đang nhận USB');
  assert.equal(await page.locator('#scan').isDisabled(),true);
  const simulated=demoSweep(presets.subghz,1);
  await page.evaluate(lines=>{
    const data=new TextEncoder().encode('ESP-ROM boot log\n'+lines);
    window.rfStream.enqueue(data.slice(0,83));window.rfStream.enqueue(data.slice(83));
  },simulated.map(s=>JSON.stringify(s)).join('\n')+'\n');
  await page.waitForFunction(()=>document.getElementById('sweep-count').textContent==='001');
  assert.equal(await page.locator('#source').textContent(),'MÔ PHỎNG');
  assert.equal(await page.locator('#gateway').isDisabled(),true);
  await page.locator('#reset').click();
  await page.evaluate(lines=>window.rfStream.enqueue(new TextEncoder().encode(lines)),simulated.map(s=>JSON.stringify({...s,source:'device',sweep:2})).join('\n')+'\n');
  await page.waitForFunction(()=>document.getElementById('source').textContent==='THIẾT BỊ');
  assert.equal(await page.locator('#sweep-count').textContent(),'001'); // Source change resets history.
  await page.locator('#serial').click();
  await page.waitForFunction(()=>window.fakeClosed && document.getElementById('serial').textContent==='Kết nối USB');
  assert.equal(await page.locator('#scan').isDisabled(),false);
  assert.equal(await page.locator('#source').textContent(),'BẢN GHI · THIẾT BỊ');
  // New v0.10 paths: metadata imports, bounded Spectrum v2 ingestion and sealed download.
  await page.locator('#reset').click();
  const manifest={schema:'rf-observatory/hardware-manifest-v1',receive_only:true,receiver:'browser-fixture',antenna:'fixture'};
  await page.locator('#manifest-file').setInputFiles({name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});
  await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Đã nạp hardware'));
  const curve={schema:'rf-observatory/calibration-v1',points:[{frequency_hz:433000000,correction_db:2},{frequency_hz:434000000,correction_db:2}]};
  await page.locator('#calibration-file').setInputFiles({name:'curve.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(curve))});
  await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Đã nạp correction'));
  await page.locator('#profile').selectOption('subghz');
  await page.locator('#integration').selectOption('4');
  await page.evaluate(()=>{window.EventSource=class{constructor(){window.fakeGateway=this;}close(){this.closed=true;}};});
  await page.locator('#gateway').click();
  assert.equal(await page.locator('#serial').isDisabled(),true);
  const f=n=>({version:2,type:'spectrum',source:'device',sequence:n,start_hz:433000000,step_hz:10000,powers_dbm:[-110,-90,-100],timestamp_ms:n*1000,rbw_hz:5000,integration_ms:500,calibration_state:'relative'});
  for(let n=1;n<=4;n++)await page.evaluate(frame=>window.fakeGateway.onmessage({data:JSON.stringify(frame)}),f(n));
  assert.equal(await page.locator('#sweep-count').textContent(),'001');
  const rawDownload=page.waitForEvent('download');await page.locator('#export').click();
  const raw=await fs.readFile(await (await rawDownload).path(),'utf8');
  assert.equal(raw.trim().split('\n').length,4);assert.deepEqual(JSON.parse(raw.split('\n')[0]),f(1));
  const scienceDownload=page.waitForEvent('download');await page.locator('#export-session').click();
  const bundle=JSON.parse(await fs.readFile(await (await scienceDownload).path(),'utf8'));
  assert.equal(await verifyBundle(bundle),true);assert.equal(bundle.derived_samples[0].rssi_dbm,-108);
  assert.equal(bundle.acquisition.rbw_hz,5000);assert.equal(bundle.processing_state,'correction-applied');
  await page.locator('#rfi-btn').click();await page.locator('#rfi-start').fill('433');await page.locator('#rfi-stop').fill('433.02');await page.locator('#rfi-add').click();
  assert.equal(await page.locator('#rfi-count').textContent(),'1');assert.equal(await page.locator('#candidate-count').textContent(),'00');
  assert.equal(await page.locator('#persistent-count').textContent(),'00');await page.locator('#rfi-close').click();
  await page.locator('#compare-file').setInputFiles(['a','b'].map(name=>({name:name+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))})));
  await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Integrity OK'));
  await page.locator('#compare-file').setInputFiles([bundle,{...bundle,source:'simulation'}].map((b,i)=>({name:i+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(b))})));
  await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Không so sánh'));
  await page.evaluate(frame=>window.fakeGateway.onmessage({data:JSON.stringify(frame)}),f(4));
  assert.equal(await page.evaluate(()=>window.fakeGateway.closed),true);
  assert.equal(await page.locator('#serial').isDisabled(),false);
  assert.ok((await page.locator('#notice').textContent()).includes('Frame lặp'));
  assert.deepEqual(errors,[]);
  console.log('PASS: browser simulation controls, threshold, profile, import/export, invalid import, clear, 3 viewports, USB cancel/ingest/disconnect, source isolation, science export, manifest/calibration, RFI, comparison, fake SSE, zero console errors');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}

