import {test} from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createGatewayServer,createJournal} from '../scripts/gateway.mjs';
const f=n=>({version:2,type:'spectrum',source:'device',sequence:n,start_hz:433000000,step_hz:10000,powers_dbm:[-100,-90],timestamp_ms:n*100,rbw_hz:1000,integration_ms:100,calibration_state:'relative'});
test('real HTTP/SSE read-only boundary, origin policy, replay and durable archive',{timeout:15000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rf-gateway-')),file=path.join(dir,'raw.jsonl');
  const journal=createJournal(file),g=createGatewayServer({journal}),controllers=[];
  try{
    await new Promise((resolve,reject)=>{g.server.once('error',reject);g.server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+g.server.address().port;
    assert.equal((await fetch(base+'/events',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/health',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
    const badHost=await new Promise((resolve,reject)=>{http.get(base+'/health',{headers:{Host:'untrusted.invalid'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});
    assert.equal(badHost,403);
    const health=await fetch(base+'/health',{headers:{Origin:'http://localhost:8080'}});
    assert.equal(health.headers.get('access-control-allow-origin'),'http://localhost:8080');assert.equal((await health.json()).archive,true);
    const open=async headers=>{const c=new AbortController();controllers.push(c);return fetch(base+'/events',{headers,signal:c.signal});};
    const res=await open(),reader=res.body.getReader();await reader.read();g.broadcast(f(1));
    const text=new TextDecoder().decode((await reader.read()).value);assert.match(text,/"sequence":1/);const id=text.match(/id: ([^\n]+)/)[1];
    g.broadcast(f(2));controllers[0].abort();
    const replay=await open({'Last-Event-ID':id}),r=replay.body.getReader();
    let data='';while(!data.includes('"sequence":2'))data+=new TextDecoder().decode((await r.read()).value);
    assert.equal((await open({'Last-Event-ID':'wrong-stream:1'})).status,409);
    assert.deepEqual(fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse),[f(1),f(2)]);
    assert.throws(()=>createJournal(file));
    // Includes the reconnect stream; fill the remaining slots and reject client nine.
    while(g.clients.size<8)await open();
    assert.equal((await open()).status,503);
  }finally{controllers.forEach(c=>c.abort());g.server.closeAllConnections();await new Promise(r=>g.server.close(r));journal.close();fs.rmSync(dir,{recursive:true,force:true});}
});
