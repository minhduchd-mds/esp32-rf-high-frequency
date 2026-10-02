import {test} from 'node:test';import assert from 'node:assert/strict';import {parseGatewayLine,createGatewayServer} from '../scripts/gateway.mjs';
const frame={version:2,type:'spectrum',source:'device',sequence:1,start_hz:1400000000,step_hz:100000,powers_dbm:[-110,-109],timestamp_ms:10,rbw_hz:100000,integration_ms:1000,calibration_state:'relative'};
test('gateway accepts bounded receive-only spectrum v2',()=>{assert.deepEqual(parseGatewayLine(JSON.stringify(frame)),frame);assert.throws(()=>parseGatewayLine(JSON.stringify({...frame,source:'simulation'})));assert.throws(()=>parseGatewayLine('x'.repeat(65537)));});
test('gateway exposes local read-only server primitives',()=>{const{server,clients}=createGatewayServer();assert.equal(server.listening,false);assert.equal(clients.size,0);server.close();});


import {createLineDecoder} from '../scripts/gateway.mjs';
test('streaming line limit rejects before newline and recovers',()=>{
  const lines=[],errors=[];const feed=createLineDecoder(x=>lines.push(x),e=>errors.push(e));
  for(let i=0;i<100;i++)feed(Buffer.alloc(1024,120));
  assert.equal(errors.length,1);feed(Buffer.from('\n'+JSON.stringify(frame)+'\n'));
  assert.equal(lines.length,1);assert.deepEqual(parseGatewayLine(lines[0]),frame);
});
test('split UTF8 and CRLF lines preserve frame',()=>{
  const lines=[],feed=createLineDecoder(x=>lines.push(x),()=>assert.fail());
  const b=Buffer.from(JSON.stringify(frame)+'\r\n');for(const byte of b)feed(Buffer.from([byte]));
  assert.deepEqual(parseGatewayLine(lines[0]),frame);
});
test('archive happens before publication, sequence guards reject duplicates and regressions',()=>{
  const saved=[],g=createGatewayServer({journal:{append:f=>saved.push(f)}});
  g.broadcast(frame);assert.equal(saved.length,1);assert.throws(()=>g.broadcast(frame));
  assert.throws(()=>g.broadcast({...frame,sequence:2,timestamp_ms:0}));
  g.broadcast({...frame,sequence:3,timestamp_ms:30});assert.equal(g.stats.missing,1);assert.equal(saved.length,2);g.server.close();
});
test('disk failure is latched and never publishes unarchived frames',()=>{
  const g=createGatewayServer({journal:{append:()=>{throw new Error('disk full');}}});
  assert.throws(()=>g.broadcast(frame));assert.equal(g.stats.accepted,0);assert.equal(g.stats.archive_error,true);
  assert.throws(()=>g.broadcast({...frame,sequence:2}));g.server.close();
});
test('slow clients are disconnected instead of growing an unbounded queue',()=>{
  const g=createGatewayServer();let destroyed=false;g.clients.add({write:()=>false,destroy:()=>{destroyed=true;}});
  g.broadcast(frame);assert.equal(destroyed,true);assert.equal(g.clients.size,0);assert.equal(g.stats.slow_clients,1);g.server.close();
});
