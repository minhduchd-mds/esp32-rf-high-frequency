# RF telemetry v1

Transport: UTF-8 JSON, one object per line. Serial is 115200 baud. ESP-IDF boot/log lines are ignored by the browser when they do not start with `{`. A JSON sample is limited to 2048 characters at ingestion.

```json
{"version":1,"type":"sample","source":"simulation","sweep":1,"index":0,"total":101,"frequency_hz":433000000,"rssi_dbm":-108.00,"timestamp_ms":20}
```

| Field | Contract |
|---|---|
| `version` | Integer 1 |
| `type` | `sample` |
| `source` | `simulation` or `device`; simulation firmware always uses `simulation` |
| `sweep` | Unsigned 32-bit identifier; can restart on reboot |
| `index` | Zero-based sample index within sweep |
| `total` | 1–512 samples |
| `frequency_hz` | Positive unsigned 32-bit integer |
| `rssi_dbm` | Finite number in [−160, 20] |
| `timestamp_ms` | Nonnegative safe integer, monotonic within a sweep; device uptime, not wall clock |

All samples in one sweep must share source, sweep ID and total count. Frequencies must increase and the grid must have uniform steps. Timestamps cannot decrease. Missing, duplicate, reordered or mixed-source samples discard the in-progress sweep. A new index zero starts recovery. Charts update only when the complete sweep arrives. A timestamp gap does not imply a missing RF event because dwell and output scheduling can vary.

An imported recording must contain only complete sweeps, one source and one frequency grid. Import validation completes before replacing current data. Partial or malformed files leave the current view intact. Export records exactly the retained raw samples; peak hold is not substituted for real samples.

USB errors can be emitted as `{"version":1,"type":"error","code":"scan_failed"}`. v0.1 has no inbound command or RF transmit message. Sample source is metadata supplied by the sender and cannot prove a physical measurement occurred.
