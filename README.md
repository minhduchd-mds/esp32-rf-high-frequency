# RF Observatory

Passive RF measurement and space-science workspace built around a portable C++17 scan engine, ESP-IDF firmware, deterministic simulation, browser mission console and an ESP32-S3 on-device HTTPS console.

**Current software version: v0.9.0.** Physical space observations still require a suitable receive-only RF front end / SDR, antenna, filtering and calibration.

## Implemented

- Portable fixed-capacity scan core shared by host and ESP-IDF.
- JSONL telemetry v1 and Spectrum v2 receive-only acquisition.
- Browser spectrum, polar frequency/RSSI view, peak hold and 360-row science waterfall.
- Science-session provenance, calibration, RFI quality masks and SHA-256 integrity.
- Weak Signal Lab: resonant weighting, multi-sweep persistence, time-domain synchronous detection, multi-sensor coincidence and bounded 3D WaveFieldMap.
- Local read-only SDR gateway.
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
