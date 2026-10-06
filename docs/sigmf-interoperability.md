# SigMF Interoperability Plan

## Why this is separate from Spectrum v2

RF Observatory currently stores validated **frequency-domain power sweeps** and sealed science-session evidence. SigMF is best used for the original receiver sample stream (for example real/complex I/Q) plus metadata. A derived dBm spectrum must not be mislabeled as raw SigMF sample data.

Therefore the current Spectrum v2 bundle remains the authoritative format for the existing power-sweep path. SigMF interoperability is introduced at the future SDR acquisition adapter, before FFT/integration/calibration.

## Target data path

```text
SDR hardware
  -> immutable raw sample file
  -> SigMF metadata sidecar
  -> sample/frame integrity digest
  -> FFT / channelization
  -> Spectrum v2 frames
  -> gateway journal
  -> integration / calibration correction
  -> sealed science-session bundle
```

## Required capture metadata

The SDR adapter should preserve at least:

- datatype and byte order
- sample rate
- center frequency
- receiver/hardware identity
- antenna/front-end description or manifest fingerprint
- clock/time source
- capture start time and timestamp uncertainty
- gain stages
- bandwidth / filter settings
- dropped-sample or discontinuity accounting
- calibration reference identifier
- raw sample digest

Derived processing must record the exact raw-capture identifier rather than overwrite the raw sample file.

## Interoperability boundary

A SigMF capture may feed GNU Radio, SoapySDR-based tools or offline Python/C++ analysis, but importing one does not imply that RF Observatory has physically calibrated the receiver. Physical calibration and clock accuracy remain separate evidence.

## Implementation gate

Do not add a SigMF export button for the current power-spectrum-only browser session. Add it only when the SDR gateway has a real raw-sample capture path and tests can replay a capture into the existing Spectrum v2 model without inventing missing metadata.
