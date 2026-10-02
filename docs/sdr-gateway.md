# Read-only SDR Gateway

## Purpose

The SDR gateway is the boundary between a physical science receiver and RF Observatory. Its job is deliberately narrow: accept or produce **pre-channelized receive-only power spectra**, validate them, and hand them to the existing science pipeline.

RF Observatory does not need direct access to arbitrary SDR driver APIs to perform visualization and candidate triage.

## Data flow

```text
Antenna / feed
   ↓
Filter + LNA
   ↓
Receive-only SDR / science receiver
   ↓
Vendor/local acquisition process
   ↓
Spectrum v2 frame
   ↓
Validation
   ↓
spectrumFrameToSamples()
   ↓
Integration / RFI flags / candidate triage
   ↓
Science session + raw evidence
```

## Trust boundary

The gateway must never infer that a signal is astronomical just because it is strong or near a reference frequency. The receiver process supplies acquisition metadata; RF Observatory validates structure and preserves provenance.

Recommended gateway rules:

- bind locally by default;
- read-only ingestion;
- bounded frame size and bin count;
- explicit sample/grid units;
- explicit calibration state;
- no generic shell execution;
- no arbitrary device commands;
- no automatic retuning initiated by remote content;
- preserve raw frame evidence separately from derived analysis.

## v0.5 implementation

Implemented in the browser model layer:

- `validateSpectrumFrame()`
- `spectrumFrameToSamples()`
- bounds for sequence/frequency/bin count/RSSI/RBW/integration
- calibration-state preservation
- tests for invalid source and frequency-grid conversion

A later physical adapter can feed this contract from a local receiver process without coupling the UI to one SDR vendor.
