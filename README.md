# RF Observatory

Passive RF measurement and space-science workspace built around a portable C++17 scan engine, ESP-IDF firmware, deterministic simulation and a browser mission console.

**Current software version: v0.7.0.** Physical space observations still require a suitable receive-only RF front end / SDR, antenna, filtering and calibration.

## Implemented

- Portable fixed-capacity scan core shared by host and ESP-IDF.
- JSONL telemetry v1 with complete-sweep validation.
- Spectrum v2 contract for read-only pre-channelized SDR frames.
- Browser spectrum, polar frequency/RSSI view, peak hold and 360-row science waterfall.
- Raw JSONL import/export.
- Science-session export with provenance, grid, integration and calibration state.
- Profiles for 433 MHz, HF, Solar/Jovian 14–30 MHz and HI 1400–1427 MHz.
- Power-domain sweep integration: 1×, 4× or 8× in the UI.
- Median-baseline candidate triage.
- RFI masks that flag candidates rather than removing evidence.
- ESP32 and ESP32-S3 CI builds.

## Run

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Open <http://localhost:8080>.

## Verification

```sh
bash scripts/check.sh
SANITIZE=1 bash scripts/check.sh
npm run test:browser
```

## Architecture

```text
Passive antenna / feed
        ↓
 Filter + LNA
        ↓
Receive-only SDR / science receiver
        ↓
 Spectrum v2
        ↓
 Validation
        ↓
 Integration
        ↓
 Baseline + RFI flags
        ↓
 Candidate triage
        ↓
 Mission Console
        ├── raw JSONL
        └── science-session metadata
```

ESP32 remains useful as a supervisor/telemetry endpoint, but the project does not claim that ESP32 itself is a broadband radio-astronomy ADC.

Read [Space Science Roadmap](docs/space-science.md), [SDR Gateway](docs/sdr-gateway.md), [Protocol](docs/protocol.md), [Architecture](docs/architecture.md) and [Hardware](docs/hardware.md).

## Scope boundary

RF Observatory is receive-only scientific instrumentation. It does not implement RF transmission, jamming, communications interception/decryption, weapon guidance or military target tracking.


## Local receive-only gateway

Bridge a physical acquisition process to the browser without exposing an RF command channel:

```sh
some_receive_only_spectrum_source | npm run gateway
```

The gateway binds only to `127.0.0.1:8787`, accepts Spectrum v2 NDJSON from **stdin**, and exposes GET-only SSE at `/events`. Browser content cannot send tuner/RF commands through this path.

## Physical-ready metadata

v0.7 adds receive-only hardware-manifest fingerprints, calibration-curve import, raw/calibrated separation, RFI quality-mask editing, SHA-256 sealed science sessions and two-session integrity comparison.
