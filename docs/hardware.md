# Hardware integration plan

No board wiring is defined yet. v0.2 firmware touches no RF GPIO/SPI/I2C device and emits simulation only.

| Path | Intended use | Current status |
|---|---|---|
| CC1101 + SPI | Sub-GHz receive-only RSSI sweeps | Interface ready; physical driver pending |
| Si4735 + I2C | HF reception / receiver quality | Adapter and unit mapping pending |
| ESP32 PCNT / RMT + suitable input conditioning | Pulse counting / edge timing | Separate capture schema and driver pending |
| Receive-only SDR gateway | Space-science spectra | Software roadmap defined; adapter pending |

The CC1101 path remains a narrow receive-only laboratory milestone. The Si4735 path is separate from broadband space-science acquisition. ESP32 is not treated as a broadband RF ADC.

Before physical work, record the exact ESP32 board/revision, receiver module, schematic, oscillator/reference, power requirements, pin mapping, antenna connector and RF front-end characteristics. Validate power and bus communication before measurements.

## Space-science receive path

| Observation | Software profile | Physical acquisition direction |
|---|---|---|
| Solar / Jovian decametric emission | 14–30 MHz, 50 kHz grid | Suitable HF antenna + filtering + low-noise receive chain + SDR/receiver |
| Neutral hydrogen HI | 1400–1427 MHz, 100 kHz grid | L-band feed + 1420 MHz-region band-pass filtering + LNA + SDR/receiver |

For real observations, record the full receive chain, antenna, filter bandwidth, gain, oscillator/reference, sample/integration settings and calibration state. Characterize local RFI before classifying any candidate.

No transmit, jammer, protected-communications interception or targeting hardware belongs in the space-science path.
