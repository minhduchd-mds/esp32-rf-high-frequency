# Hardware integration plan

No board wiring is defined yet. v0.1 firmware touches no RF GPIO/SPI/I2C device and emits simulation only.

| Path | Intended use | Current status |
|---|---|---|
| CC1101 + SPI | Sub-GHz receive-only RSSI sweeps | Interface ready; physical driver pending |
| Si4735 + I2C | HF broadcast reception / receiver quality | Adapter and unit mapping pending |
| ESP32 PCNT / RMT + suitable input conditioning | Pulse counting / edge timing | Separate capture schema and driver pending |

The CC1101 IC supports discontinuous ranges of 300–348, 387–464 and 779–928 MHz according to TI. A module's matching network/antenna may support a narrower band. A requested sweep must fit inside one supported band; the core `within` helper rejects sweeps crossing gaps. The UI's 433 MHz preset is a simulation example, not a declaration of usable hardware bandwidth.

The Si4735 HF direction from the initial brief remains planned; exact part suffix, board capabilities, command reference, settling time and RSSI units must be checked during adapter implementation. Do not extrapolate the brief's 26.1 MHz limit to a 30 MHz-capable receiver without verifying another frontend.

Before hardware work, record the exact ESP32 board/revision, module markings, schematic, oscillator value, logic/power requirements, pin mapping and antenna connector. Validate power and bus communication before measuring a known signal. Keep laboratory measurements separate from simulated fixtures.

Sources:

- [TI CC1101 product and datasheet](https://www.ti.com/product/CC1101)
- [Skyworks Si47xx evaluation board guide](https://www.skyworksinc.com/-/media/Skyworks/SL/documents/public/user-guides/Si47xxEVB.pdf)
- [ESP-IDF v5.4.2 programming guide](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32/)
- [ESP-IDF component build system](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32/api-guides/build-system.html)
- [Espressif GitHub CI action](https://github.com/espressif/esp-idf-ci-action)
