# RF Observatory

Passive RF measurement and space-science workspace built around a portable C++17 scan engine, ESP-IDF firmware, deterministic simulation, browser mission console and an ESP32-S3 on-device HTTPS console.

**Current software version: v0.10.0.** Physical space observations still require a suitable receive-only RF front end / SDR, antenna, filtering and calibration.

## Implemented

- Portable fixed-capacity scan core shared by host and ESP-IDF.
- JSONL telemetry v1 and Spectrum v2 receive-only acquisition.
- Browser spectrum, polar frequency/RSSI view, peak hold and 360-row science waterfall.
- Recoverable science-session v2 bundles: raw evidence, acquisition metadata, correction provenance and deterministic SHA-256/replay verification.
- Weak Signal Lab: resonant weighting, multi-sweep persistence, time-domain synchronous detection, multi-sensor coincidence and bounded 3D WaveFieldMap.
- Local read-only SDR gateway with mandatory fsync raw journal, sequence checks and bounded SSE replay.
- Conservative per-GPIO ESP32-S3 planning validator and optional read-only boot diagnostics.
- **ESP32-S3 HTTPS Device Console on port 443 by default** with device status and latest complete spectrum.
- ESP32 and ESP32-S3 CI builds.

## Desktop Mission Console

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Open <http://localhost:8080>.

## ESP32-S3 HTTPS Device Console

The S3 hosts a compact dependency-free web UI through ESP-IDF `esp_https_server`.

```text
Browser
  ↓ HTTPS :443
ESP32-S3
  ├── /
  ├── /api/status
  └── /api/spectrum
```

Configure Wi-Fi locally:

```sh
cd firmware
idf.py menuconfig
```

Under **RF Observatory device console**, set the Wi-Fi SSID/password. Generate a local TLS certificate/key as described in [Device HTTPS](docs/device-https.md), then build and flash. Real credentials, certificates and private keys are excluded from git.

If Wi-Fi or TLS material is absent, scanning/serial telemetry continues and only the device web surface stays offline.

## Nạp firmware ESP32-S3

Thư mục [`flash/`](flash/) cung cấp script build + flash một lệnh cho Windows PowerShell và macOS/Linux.

Windows:

```powershell
.\flash\flash-esp32s3.ps1 -Port COM5 -Monitor
```

macOS/Linux:

```bash
MONITOR=1 ./flash/flash-esp32s3.sh /dev/ttyACM0
```

## Reliability upgrade v0.10

Calibration correction is not physical calibration certification. Browser raw sessions stop at capacity; Gateway journals preserve accepted frames before broadcast. Session comparison fails closed on incompatible evidence. Legacy v1 session comparison is disabled. See [pin validation](docs/esp32s3-validation.md) and [commissioning](docs/ground-station.md) for the remaining hardware gates.

## Verification

```sh
bash scripts/check.sh
SANITIZE=1 bash scripts/check.sh
npm run test:browser
```

CI additionally generates a one-run TLS certificate and compiles the HTTPS-enabled ESP32-S3 path.

## Architecture

```text
Passive sensor / antenna
        ↓
Receive-only front end
        ↓
Scanner / SDR acquisition
        ↓
Validation + Weak Signal Lab
        ↓
        ├──────── Desktop Mission Console
        │
        └──────── ESP32-S3 HTTPS Device Console
                       ├── status
                       └── latest spectrum
```

ESP32-S3 is a supervisor/edge telemetry node; this project does not claim the MCU itself is a broadband radio-astronomy ADC.

Read [Device HTTPS](docs/device-https.md), [Weak Signal Lab](docs/weak-signal-lab.md), [Space Science Roadmap](docs/space-science.md), [Ground Station](docs/ground-station.md), [SDR Gateway](docs/sdr-gateway.md), [Protocol](docs/protocol.md) and [Architecture](docs/architecture.md).

## Scope boundary

RF Observatory is receive-only scientific instrumentation. It does not implement RF transmission, jamming, communications interception/decryption, weapon guidance or military target tracking.

