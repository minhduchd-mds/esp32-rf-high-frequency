import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
export const S3_PINS=Object.freeze([...Array.from({length:22},(_,i)=>i),...Array.from({length:23},(_,i)=>i+26)]);
export function pinInventory() {
  return S3_PINS.map(gpio=>({gpio,adc:gpio>=1&&gpio<=10?'ADC1':gpio>=11&&gpio<=20?'ADC2':null,
    restrictions:[...([0,3,45,46].includes(gpio)?['strapping']:[]),...(gpio>=26&&gpio<=32?['flash-psram']:[]),
      ...(gpio>=33&&gpio<=37?['octal-memory-dependent']:[]),...([19,20].includes(gpio)?['usb']:[]),
      ...(gpio>=39&&gpio<=42?['possible-jtag']:[]),...([43,44].includes(gpio)?['possible-console']:[])],
    electrical_test:'blocked-until-board-and-fixture-reviewed'}));
}
// Conservative planning only. Never configures a pin or talks to hardware.
export function validatePinPlan(plan) {
  if(plan?.schema!=='rf-observatory/pin-plan-v1'||plan.target!=='esp32s3'||plan.receive_only!==true)
    throw new Error('Explicit receive-only ESP32-S3 plan required.');
  for(const key of ['board','revision','module','schematic','fixture'])
    if(typeof plan[key]!=='string'||!plan[key].trim()||plan[key].length>256)throw new Error(`Missing ${key}.`);
  if(!['quad','octal'].includes(plan.memory_bus)||typeof plan.usb_in_use!=='boolean'||typeof plan.console_in_use!=='boolean'||typeof plan.jtag_in_use!=='boolean')
    throw new Error('Memory/USB/console/JTAG configuration required.');
  if(!Array.isArray(plan.exposed_gpio)||!plan.exposed_gpio.length||plan.exposed_gpio.some(p=>!S3_PINS.includes(p))||new Set(plan.exposed_gpio).size!==plan.exposed_gpio.length)
    throw new Error('Board exposed GPIO list invalid.');
  if(!Array.isArray(plan.assignments)||!plan.assignments.length||plan.assignments.length>45)throw new Error('Assignments required.');
  const used=new Set();
  for(const a of plan.assignments){
    if(!a||!S3_PINS.includes(a.gpio)||!plan.exposed_gpio.includes(a.gpio)||used.has(a.gpio))throw new Error('Invalid, unavailable or duplicate GPIO.');
    used.add(a.gpio);
    if([0,3,45,46].includes(a.gpio)||a.gpio>=26&&a.gpio<=32||plan.memory_bus==='octal'&&a.gpio>=33&&a.gpio<=37)
      throw new Error('Boot/memory GPIO excluded from generic tests.');
    if(plan.usb_in_use&&[19,20].includes(a.gpio)||plan.console_in_use&&[43,44].includes(a.gpio)||plan.jtag_in_use&&a.gpio>=39&&a.gpio<=42)
      throw new Error('GPIO conflicts with active debug/console transport.');
    if(!['digital-input','adc-input','i2c-receiver','spi-receiver'].includes(a.role))throw new Error('Unsupported receive-side role.');
    if(a.role==='adc-input'&&(a.gpio<1||a.gpio>20))throw new Error('GPIO has no ADC channel.');
    if(typeof a.net!=='string'||!a.net.trim()||a.net.length>96)throw new Error('Named schematic net required.');
    if(a.test!=='passive-inspection')throw new Error('Electrical stimulus requires a separate reviewed fixture procedure.');
  }
  return {valid:true,electrical_execution_enabled:false,assignments:plan.assignments.length,
    message:'Planning validation only; not a hardware qualification or permission to drive GPIO.'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const file=process.argv[2];
  console.log(JSON.stringify(file?validatePinPlan(JSON.parse(fs.readFileSync(file,'utf8'))):{target:'esp32s3',pins:pinInventory()},null,2));
}
