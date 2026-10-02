import {test} from 'node:test';import assert from 'node:assert/strict';
import {S3_PINS,pinInventory,validatePinPlan} from '../scripts/hardware-plan.mjs';
const base={schema:'rf-observatory/pin-plan-v1',target:'esp32s3',receive_only:true,board:'fixture-only',revision:'test',module:'test-module',schematic:'test-schematic',fixture:'fake-bus',memory_bus:'octal',usb_in_use:true,console_in_use:true,jtag_in_use:true,exposed_gpio:[...S3_PINS],assignments:[]};
const assignment=gpio=>({gpio,net:'test-net',role:'digital-input',test:'passive-inspection'});
test('inventory covers every S3 GPIO, excluding nonexistent 22-25',()=>{assert.equal(pinInventory().length,45);assert.equal(new Set(S3_PINS).size,45);for(const p of [22,23,24,25,49,-1])assert.equal(S3_PINS.includes(p),false);});
test('unknown board and non-receive-only plans are blocked',()=>{assert.throws(()=>validatePinPlan({}));assert.throws(()=>validatePinPlan({...base,receive_only:false,assignments:[assignment(4)]}));for(const key of ['board','revision','module','schematic','fixture'])assert.throws(()=>validatePinPlan({...base,[key]:'',assignments:[assignment(4)]}));});
test('each GPIO is checked for reserved and active transport conflicts',()=>{
  const blocked=[0,3,45,46,19,20,43,44,39,40,41,42,...Array.from({length:12},(_,i)=>i+26)];
  for(const gpio of S3_PINS){const plan={...base,assignments:[assignment(gpio)]};if(blocked.includes(gpio))assert.throws(()=>validatePinPlan(plan));else assert.equal(validatePinPlan(plan).electrical_execution_enabled,false);}
});
test('reject duplicate pins, unexposed pins, RF-output roles and active stimulus',()=>{
  for(const patch of [{assignments:[assignment(4),assignment(4)]},{exposed_gpio:[5],assignments:[assignment(4)]},{assignments:[{...assignment(4),role:'transmit'}]},{assignments:[{...assignment(4),test:'drive-high'}]},{assignments:[{...assignment(48),role:'adc-input'}]}])assert.throws(()=>validatePinPlan({...base,...patch}));
});
