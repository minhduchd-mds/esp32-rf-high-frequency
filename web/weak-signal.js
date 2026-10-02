const MAX_TIME_SAMPLES = 100000;
const MAX_MAP_POINTS = 10000;

function finite(v,name){ if(!Number.isFinite(v)) throw new Error(`${name} không hợp lệ.`); return v; }

export const sensorKinds = Object.freeze({
  direct_voltage:{label:'Direct voltage',domain:'conducted',quantity:'V',best_for:'weak conducted voltage'},
  e_field:{label:'E-field probe',domain:'near-field',quantity:'V/m',best_for:'electric-field coupling'},
  h_field:{label:'H-field loop',domain:'near-field',quantity:'A/m',best_for:'AC magnetic field / current loops'},
  search_coil:{label:'Search coil',domain:'magnetic',quantity:'V',best_for:'weak changing magnetic flux'},
  fluxgate:{label:'Fluxgate',domain:'magnetic',quantity:'T',best_for:'DC / low-frequency magnetic field'},
  rf_antenna:{label:'RF antenna',domain:'far-field',quantity:'dBm',best_for:'propagating RF'},
});

export function resonantPowerEstimate(samples, centerHz, q = 100) {
  if(!Array.isArray(samples)||!samples.length) throw new Error('Cần spectrum samples.');
  if(!Number.isFinite(centerHz)||centerHz<=0||!Number.isFinite(q)||q<1||q>1e6) throw new Error('Center/Q không hợp lệ.');
  const bandwidthHz=centerHz/q;
  let weighted=0,weights=0;
  for(const s of samples){
    const detuning=(s.frequency_hz-centerHz)/(bandwidthHz/2);
    const w=1/(1+detuning*detuning);
    weighted += w * 10 ** (s.rssi_dbm/10);
    weights += w;
  }
  const powerDbm=10*Math.log10(weighted/Math.max(weights,Number.EPSILON));
  return {center_hz:centerHz,q,bandwidth_hz:bandwidthHz,power_dbm:Math.round(powerDbm*100)/100};
}

export class CandidatePersistence {
  constructor({minHits=3,maxGap=1}={}) {
    if(!Number.isSafeInteger(minHits)||minHits<2||minHits>100||!Number.isSafeInteger(maxGap)||maxGap<0||maxGap>20)
      throw new Error('Persistence config không hợp lệ.');
    this.minHits=minHits;this.maxGap=maxGap;this.reset();
  }
  reset(){this.tick=0;this.state=new Map();}
  update(analysis,stepHz=1){
    ++this.tick;
    const clean=(analysis?.candidates||[]).filter(c=>!(c.quality_flags||[]).length);
    const seen=new Set();
    for(const c of clean){
      const key=Math.round(c.frequency_hz/Math.max(1,stepHz))*Math.max(1,stepHz);
      seen.add(key);
      const prev=this.state.get(key)||{frequency_hz:key,hits:0,consecutive:0,gaps:0,last_tick:0,best_delta_db:-Infinity};
      prev.hits++;prev.consecutive=prev.last_tick===this.tick-1?prev.consecutive+1:1;prev.gaps=0;prev.last_tick=this.tick;
      prev.best_delta_db=Math.max(prev.best_delta_db,c.delta_db);prev.type=c.type;this.state.set(key,prev);
    }
    for(const [key,v] of this.state){
      if(!seen.has(key)){v.gaps++;if(v.gaps>this.maxGap)v.consecutive=0;if(this.tick-v.last_tick>100)this.state.delete(key);}
    }
    const all=[...this.state.values()].sort((a,b)=>b.consecutive-a.consecutive||b.best_delta_db-a.best_delta_db);
    return {all,persistent:all.filter(v=>v.consecutive>=this.minHits)};
  }
}

export function synchronousDetect(values, sampleRateHz, referenceHz) {
  if(!Array.isArray(values)||values.length<8||values.length>MAX_TIME_SAMPLES) throw new Error('Time series phải có 8–100000 mẫu.');
  finite(sampleRateHz,'sampleRateHz');finite(referenceHz,'referenceHz');
  if(sampleRateHz<=0||referenceHz<=0||referenceHz>=sampleRateHz/2) throw new Error('Reference phải nằm dưới Nyquist.');
  let i=0,q=0;
  for(let n=0;n<values.length;n++){
    const v=finite(values[n],`sample ${n}`);
    const a=2*Math.PI*referenceHz*n/sampleRateHz;
    i+=v*Math.cos(a);q-=v*Math.sin(a);
  }
  i=2*i/values.length;q=2*q/values.length;
  return {i,q,amplitude:Math.hypot(i,q),phase_rad:Math.atan2(q,i),sample_count:values.length,reference_hz:referenceHz};
}

export function groupCoincidentObservations(observations,{frequencyToleranceHz=0,timeToleranceMs=1000,minSensors=2}={}) {
  if(!Array.isArray(observations)||observations.length>5000) throw new Error('Observation list không hợp lệ.');
  if(!Number.isFinite(frequencyToleranceHz)||frequencyToleranceHz<0||!Number.isFinite(timeToleranceMs)||timeToleranceMs<0)
    throw new Error('Coincidence tolerance không hợp lệ.');
  const rows=observations.map((o,i)=>{
    if(!o||!sensorKinds[o.sensor]) throw new Error(`Sensor ${i+1} không hợp lệ.`);
    finite(o.frequency_hz,'frequency_hz');finite(o.timestamp_ms,'timestamp_ms');finite(o.value,'value');
    return {...o};
  }).sort((a,b)=>a.timestamp_ms-b.timestamp_ms);
  const groups=[];
  for(const row of rows){
    let g=groups.find(x=>Math.abs(x.frequency_hz-row.frequency_hz)<=frequencyToleranceHz&&Math.abs(x.timestamp_ms-row.timestamp_ms)<=timeToleranceMs);
    if(!g){g={frequency_hz:row.frequency_hz,timestamp_ms:row.timestamp_ms,observations:[],sensors:new Set()};groups.push(g);}
    g.observations.push(row);g.sensors.add(row.sensor);
    g.frequency_hz=g.observations.reduce((s,x)=>s+x.frequency_hz,0)/g.observations.length;
    g.timestamp_ms=Math.min(g.timestamp_ms,row.timestamp_ms);
  }
  return groups.filter(g=>g.sensors.size>=minSensors).map(g=>({frequency_hz:Math.round(g.frequency_hz),timestamp_ms:g.timestamp_ms,
    sensor_count:g.sensors.size,sensors:[...g.sensors].sort(),observations:g.observations}));
}

export class WaveFieldMap {
  constructor(maxPoints=MAX_MAP_POINTS){this.maxPoints=Math.max(1,Math.min(MAX_MAP_POINTS,maxPoints));this.points=[];}
  clear(){this.points=[];}
  add(input){
    if(!input||!sensorKinds[input.sensor]) throw new Error('Wave-map sensor không hợp lệ.');
    for(const k of ['x','y','z','frequency_hz','value','timestamp_ms']) finite(input[k],k);
    const point={x:input.x,y:input.y,z:input.z,frequency_hz:input.frequency_hz,value:input.value,
      unit:String(input.unit||sensorKinds[input.sensor].quantity).slice(0,16),sensor:input.sensor,timestamp_ms:input.timestamp_ms};
    this.points.push(point);if(this.points.length>this.maxPoints)this.points.splice(0,this.points.length-this.maxPoints);return point;
  }
  summary(){
    if(!this.points.length)return {count:0,sensors:[],bounds:null};
    const axis=k=>[Math.min(...this.points.map(p=>p[k])),Math.max(...this.points.map(p=>p[k]))];
    return {count:this.points.length,sensors:[...new Set(this.points.map(p=>p.sensor))].sort(),
      bounds:{x:axis('x'),y:axis('y'),z:axis('z'),frequency_hz:axis('frequency_hz')}};
  }
}
