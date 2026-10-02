import http from 'node:http';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateSpectrumFrame} from '../web/model.js';
export const MAX_LINE_BYTES=65536;
export function parseGatewayLine(line) {
  if(typeof line!=='string'||Buffer.byteLength(line)>MAX_LINE_BYTES)throw new Error('Gateway line too large.');
  return validateSpectrumFrame(JSON.parse(line));
}
// Reject an oversized line while receiving it, not after readline has buffered it.
export function createLineDecoder(onLine,onError) {
  let buffer=Buffer.alloc(0),discard=false;
  const feed=chunk=>{
    const bytes=Buffer.from(chunk);let start=0;
    for(let i=0;i<=bytes.length;i++) {
      if(i!==bytes.length&&bytes[i]!==10)continue;
      const part=bytes.subarray(start,i);
      if(!discard){
        if(buffer.length+part.length>MAX_LINE_BYTES){buffer=Buffer.alloc(0);discard=true;onError(new Error('Gateway line too large.'));}
        else buffer=Buffer.concat([buffer,part]);
      }
      if(i<bytes.length){if(!discard&&buffer.length)onLine(buffer.toString('utf8').trim());buffer=Buffer.alloc(0);discard=false;}
      start=i+1;
    }
  };
  feed.end=()=>{if(buffer.length&&!discard)onError(new Error('Incomplete input frame at EOF.'));buffer=Buffer.alloc(0);discard=false;};
  return feed;
}
export function createJournal(filename) {
  // Exclusive creation prevents accidental overwrite, appending into an unrelated session or following a symlink.
  const fd=fs.openSync(filename,'wx',0o600);let closed=false;
  return {append(frame){if(closed)throw new Error('Archive closed.');fs.writeFileSync(fd,JSON.stringify(frame)+'\n');fs.fsyncSync(fd);},
    close(){if(!closed){closed=true;fs.closeSync(fd);}}};
}
export function createGatewayServer({journal=null,origins=['http://localhost:8080','http://127.0.0.1:8080'],heartbeatMs=15000}={}) {
  const clients=new Set(),replay=[],stream=randomUUID();let next=0,last=null;
  const stats={accepted:0,rejected:0,missing:0,slow_clients:0,archive_error:false};
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const host=req.headers.host;
    if(!host||!/^((127\.0\.0\.1)|(localhost)):\d+$/.test(host)){res.writeHead(403).end('local host required\n');return;}
    const origin=req.headers.origin;
    if(origin&&!origins.includes(origin)){res.writeHead(403).end('origin denied\n');return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method!=='GET'){res.writeHead(405).end('read-only\n');return;}
    if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:!stats.archive_error,mode:'receive-only',archive:!!journal,clients:clients.size,...stats}));return;}
    if(req.url!=='/events'){res.writeHead(404).end();return;}
    if(clients.size>=8){res.writeHead(503).end('too many clients\n');return;}
    let backlog=[];
    const id=req.headers['last-event-id'];
    if(id){const index=replay.findIndex(e=>e.id===id);if(index<0){res.writeHead(409).end('replay unavailable; open a new session\n');return;}backlog=replay.slice(index+1);}
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(': receive-only\n\n');
    clients.add(res);res.on('close',()=>clients.delete(res));
    for(const e of backlog)if(!send(res,e.payload))break;
  });
  function send(res,payload){if(!res.write(payload)){stats.slow_clients++;clients.delete(res);res.destroy();return false;}return true;}
  const heartbeat=setInterval(()=>{for(const res of clients)send(res,': heartbeat\n\n');},heartbeatMs);heartbeat.unref();
  server.on('close',()=>clearInterval(heartbeat));
  function broadcast(input) {
    try {
      if(stats.archive_error)throw new Error('Archive failed; restart into a new journal.');
      const frame=validateSpectrumFrame(input);
      if(last&&(frame.sequence<=last.sequence||frame.timestamp_ms<last.timestamp_ms))throw new Error('Duplicate/out-of-order frame or receiver reset.');
      if(journal){try{journal.append(frame);}catch(e){stats.archive_error=true;throw e;}}
      if(last)stats.missing+=frame.sequence-last.sequence-1;
      last=frame;stats.accepted++;
      const id=stream+':'+(++next),payload=`id: ${id}\ndata: ${JSON.stringify(frame)}\n\n`;
      replay.push({id,payload});if(replay.length>64)replay.shift();
      for(const res of [...clients])send(res,payload);
      return frame;
    }catch(e){stats.rejected++;throw e;}
  }
  return {server,broadcast,clients,stats};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.RF_GATEWAY_PORT||8787);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid RF_GATEWAY_PORT.');
  if(!process.env.RF_ARCHIVE_PATH)throw new Error('Set RF_ARCHIVE_PATH to a new JSONL file. Durable raw archive is required.');
  const journal=createJournal(process.env.RF_ARCHIVE_PATH);
  const {server,broadcast,stats}=createGatewayServer({journal});
  const fail=e=>process.stderr.write(`drop frame: ${e.message}\n`);
  const reject=e=>{stats.rejected++;fail(e);};
  const decode=createLineDecoder(line=>{if(!line)return;let frame;try{frame=parseGatewayLine(line);}catch(e){reject(e);return;}try{broadcast(frame);}catch(e){fail(e);}},reject);
  process.stdin.on('data',decode);process.stdin.on('end',()=>decode.end());
  server.listen(port,'127.0.0.1',()=>process.stderr.write(`Receive-only gateway: http://127.0.0.1:${port}; raw archive enabled\n`));
  const close=()=>{process.stdin.pause();server.closeAllConnections();server.close();journal.close();};
  server.on('error',e=>{fail(e);close();process.exitCode=1;});
  process.on('SIGINT',close);process.on('SIGTERM',close);
}
