# ESP32-S3 pin-by-pin validation plan

This is receive-only instrumentation and civilian reliability testing. No military-standard certification, RF transmission, radar targeting or electrical qualification is implied.

## Authoritative references

- Espressif ESP-IDF 5.4.2 GPIO guide: https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32s3/api-reference/peripherals/gpio.html
- Espressif hardware design checklist: https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/schematic-checklist.html

The chip has GPIO0–21 and GPIO26–48; board/module exposure varies. Chip GPIO numbering is not connector pin numbering.

## Per-pin inventory and configuration gate

```sh
node scripts/hardware-plan.mjs
node scripts/hardware-plan.mjs /path/to/reviewed-board-plan.json
```

The first command emits one entry for each of 45 GPIOs, ADC category and restrictions. The second validates a `rf-observatory/pin-plan-v1` configuration with target `esp32s3`, receive_only=true, board/revision/module/schematic/fixture identifiers, memory_bus (`quad` or `octal`), USB/console/JTAG in-use booleans, exposed_gpio and assignments (`gpio`, `net`, `role`, `test`).

Supported planning roles are digital-input, adc-input, i2c-receiver and spi-receiver. `test` must be `passive-inspection`. Output is always `electrical_execution_enabled:false`. This validator checks planning conflicts; it is not a firmware driver or authorization to apply electrical stimulus.

| GPIO | Generic test policy |
|---|---|
| 0, 3, 45, 46 | Exclude strapping pins from generic test assignments |
| 1–10 | ADC1-capable; GPIO3 remains excluded by strapping policy |
| 11–20 | ADC2-capable; peripheral restrictions still apply |
| 19, 20 | Exclude while USB is in use |
| 21 | Board-reviewed digital/peripheral assignment only |
| 22–25 | Not valid chip GPIOs |
| 26–32 | Exclude flash/PSRAM connections |
| 33–37 | Exclude for octal-memory configurations |
| 38, 47, 48 | Board-reviewed assignment only; onboard peripherals may occupy them |
| 39–42 | Exclude while external JTAG is in use |
| 43, 44 | Exclude while UART console is in use |

No universal pin map is provided without the exact board schematic. A valid chip GPIO can still be unavailable or connected to another peripheral on a board.

## Firmware inspection

Optional menuconfig `RF_GPIO_DIAGNOSTICS` dumps current mux/pull/direction and memory-reservation information once at boot via `gpio_dump_io_configuration`. It does not call gpio_config, reset, set_level, change pull resistors or drive test signals. Boot logs are not measurement records. S3 CI compiles this option; physical execution is still unverified.

## Required record for each physically exposed pin

Board connector reference → chip GPIO → schematic net → voltage domain → attached component → allowed input range/current from its datasheet → protection/level-shift circuit → expected idle state → measured idle state → instrument/reference/uncertainty → result → operator/date → evidence file.

Unknown values stay UNKNOWN and block active electrical tests. Do not connect RF antenna outputs directly to MCU GPIO/ADC; use a suitable receiver or protected signal-conditioning circuit.

## Staged physical tests (pending hardware)

1. Unpowered schematic/continuity review and power-domain verification with the actual fixture.
2. Power/current/brownout and reset behavior, boot strap states, flash/PSRAM and console stability.
3. Passive pin inspection against the board netlist; instrument measurements with datasheet-derived limits.
4. Receive-only bus adapter tests: disconnected device, timeout, stuck bus, invalid sample, partial transfer and recovery. No adapter is supplied until the receiver/module is known.
5. Known-source RF gain/noise/RBW/calibration and clock drift measurements through the receive chain.
6. Controlled disconnects, storage failure, restart, network loss, 24-hour then 72-hour acquisition. Record missing frames, memory high-water marks, archive/replay integrity and temperature.
7. Environmental/EMC testing only to an explicitly selected standard and fixture. Software stress tests do not substitute for accredited laboratory evidence.

## Automated scope delivered

Every GPIO is checked against conservative planning restrictions. Fake-receiver fault injection covers all 512 sample positions, with recovery checks, nonfinite values and 1,000 jittered scan cycles. These are host simulations, not physical pin tests.
