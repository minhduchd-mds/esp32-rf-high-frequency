# RF telemetry and science acquisition

## Telemetry v1 — sample stream

Transport: UTF-8 JSON, one object per line. Serial is 115200 baud. ESP-IDF boot/log lines are ignored by the browser when they do not start with `{`.

```json
{"version":1,"type":"sample","source":"simulation","sweep":1,"index":0,"total":101,"frequency_hz":433000000,"rssi_dbm":-108.00,"timestamp_ms":20}
```

All samples in one sweep must share source, sweep ID and total count. Frequencies must increase on a uniform grid. Missing, duplicate, reordered or mixed-source samples discard the in-progress sweep.

## Spectrum v2 — read-only SDR gateway

v0.5 defines a receive-only pre-channelized spectrum frame. It is intentionally one-way into RF Observatory; there is no transmit, tuner-control, remote-control or command message in this schema.

```json
{
  "version":2,
  "type":"spectrum",
  "source":"device",
  "sequence":42,
  "start_hz":1400000000,
  "step_hz":100000,
  "powers_dbm":[-111.2,-110.9,-104.5],
  "timestamp_ms":512340,
  "rbw_hz":100000,
  "integration_ms":1000,
  "calibration_state":"relative"
}
```

| Field | Contract |
|---|---|
| `version` | Integer 2 |
| `type` | `spectrum` |
| `source` | `device` |
| `sequence` | Unsigned 32-bit frame ID |
| `start_hz` | Positive unsigned 32-bit start frequency |
| `step_hz` | Positive integer channel spacing |
| `powers_dbm` | 1–512 finite values in [−160, 20] |
| `timestamp_ms` | Nonnegative monotonic receiver timestamp |
| `rbw_hz` | Optional positive resolution-bandwidth metadata |
| `integration_ms` | Optional 1–3,600,000 ms integration metadata |
| `calibration_state` | `uncalibrated`, `relative`, or `calibrated` |

A spectrum frame is converted into the existing internal sample grid only after validating bounds and frequency overflow. Calibration state is metadata; software must not upgrade an uncalibrated frame to calibrated.

## Science session v1

Science-session export records provenance rather than replacing raw samples. It stores profile, source, receiver label, calibration state, integration sweeps, frequency grid and candidate summary.

A science candidate is not a statement about extraterrestrial origin. Physical observations require calibration, RFI rejection, repeatability and independent confirmation.

## Scope

Protocols are receive-side only. RF Observatory contains no RF transmit, jamming, decryption/interception, target-control or weapon-guidance message family.


## Science session v2 (v0.10)

See ground-station.md for the raw-linked, deterministic-replay bundle. V1 remains a legacy checksum format and is refused for scientific comparison. Spectrum v2 calibration_state is required and never silently coerced. Receiver-monotonic timing is checked across frames in a stream; absolute station time synchronization still requires acquisition-hardware evidence.
