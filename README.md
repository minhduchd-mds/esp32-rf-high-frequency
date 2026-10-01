# RF Observatory

Passive RF measurement and space-science workspace: a portable C++17 scan engine, ESP-IDF firmware, deterministic simulation, browser observatory console and a roadmap for real receive-only front ends.

**v0.2 remains receive-only and simulation-first.** The current ESP32 firmware still emits simulated RF measurements; it does not turn an ESP32 into a broadband radio telescope. Real sky observations require a suitable analog front end / SDR, antenna, filtering, calibration and a verified device adapter.

## Current capabilities

- Portable fixed-capacity scan engine shared by host and ESP-IDF.
- JSONL telemetry with complete-sweep validation and source provenance.
- Browser spectrum, polar frequency/RSSI view, peak hold, 100-sweep waterfall and Top-8 peaks.
- JSONL import/export and read-only Web Serial ingestion.
- Simulation profiles for 433 MHz, HF, Solar/Jovian 14–30 MHz and the 1400–1427 MHz neutral-hydrogen observation window.
- Passive spectrum triage that reports spectral candidates relative to a robust median baseline. A candidate is never presented as proof of an astronomical or extraterrestrial origin.
- Host, browser and ESP32 / ESP32-S3 CI builds.

## Run the console

Requires Python 3. No frontend CDN, API key or production build step.

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Open <http://localhost:8080>. Select an observation profile and **Bắt đầu quét**.

The polar view maps frequency to angle and RSSI to radius. It does **not** measure direction, distance, object position or velocity. The waterfall shows sequential sweeps rather than simultaneous broadband IQ capture. Displayed kHz is tuning step, not receiver resolution bandwidth.

## Test

Requires GCC/Clang with C++17 and Node.js 22 or newer.

```sh
bash scripts/check.sh
SANITIZE=1 bash scripts/check.sh
```

The repository also supports CMake/CTest and Playwright browser verification.

## ESP32 simulation firmware

CI targets ESP-IDF **v5.4.2** for ESP32 and ESP32-S3. The firmware currently runs the 433–434 MHz simulation fixture and outputs JSONL at 115200 baud. Browser controls do not command hardware in v0.2.

## Space-science direction

1. **Solar / Jovian decametric observations** — 14–30 MHz science profile.
2. **Neutral hydrogen HI** — 1400–1427 MHz profile around the 21-cm line at ~1420.406 MHz.
3. **RFI rejection and calibration** — characterize gain, noise floor, filter response and local interference.
4. **SDR acquisition gateway** — future receive-only adapter for calibrated spectra.
5. **Reproducible science records** — observation metadata, hardware chain and calibration provenance.

See [Space science roadmap](docs/space-science.md), [architecture](docs/architecture.md), [hardware plan](docs/hardware.md), [protocol](docs/protocol.md) and [verification](docs/verification.md).

## Scope boundary

Passive scientific observation only. No RF transmission, jamming, communications interception/decryption, weapon guidance or military target tracking.
