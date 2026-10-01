# Space Science Roadmap

RF Observatory's space direction is a **passive radio-science observatory**. The engineering goal is to collect reproducible receive-only spectra from natural or openly documented scientific sources while preserving enough provenance to separate simulation, local interference and physical observations.

## Mission profiles

### Solar and Jovian radio

The browser includes a 14–30 MHz simulation profile for decametric radio work. NASA's Radio JOVE program demonstrates amateur/citizen-science observation of natural radio emissions from Jupiter, the Sun and the Galactic background.

A future physical station needs an appropriate HF antenna, local-RFI survey, receive filtering and a receiver/SDR that exposes measured power spectra. ESP32 can supervise the station but is not the broadband digitizer.

### Neutral hydrogen — 21 cm

The HI profile covers 1400–1427 MHz with a 100 kHz software grid and stores a rounded rest-frequency reference of 1,420,405,752 Hz.

A physical HI station requires an L-band feed, low-noise receive chain, filtering around the radio-astronomy band, a suitable SDR/receiver and calibration. A software peak near the reference is only a **candidate** until terrestrial RFI, receiver artifacts, gain drift and calibration errors have been excluded.

## Acquisition architecture

```text
Antenna / feed
      │
      ▼
Passive filter + LNA
      │
      ▼
Receive-only SDR / science receiver
      │
      ▼
Channelized power spectrum
      │
      ├── calibration metadata
      ├── RFI mask / quality flags
      └── observation timestamps
      │
      ▼
RF Observatory ingestion
      │
      ├── complete-grid validation
      ├── bounded history
      ├── passive spectrum triage
      └── JSONL science recording
```

## v0.2 — software foundation

Implemented:

- Solar/Jovian and HI browser simulation profiles.
- Explicit neutral-hydrogen reference frequency.
- Bounded passive-spectrum triage based on median baseline and peak delta.
- Simulation/device provenance remains mandatory.
- ESP32 and ESP32-S3 firmware remain simulation-only.

## v0.3 — physical ground station

Planned:

- Read-only SDR gateway with a narrow, versioned ingestion API.
- Calibration fixtures and noise-floor/gain characterization.
- Session metadata and RFI quality flags.
- Long-duration waterfall optimized for scientific sessions.
- Hardware watchdog/health telemetry isolated from RF data.

## v0.4 — science processing

Planned:

- Integration/averaging with explicit time constants.
- Baseline subtraction and calibration curves.
- RFI masks and repeat-observation comparison.
- Candidate export preserving raw evidence and processing parameters.
- Cross-check against public scientific context data without claiming causality.

## v1.0 — observatory discipline

A v1.0 science station should answer:

1. Which antenna/front-end/receiver produced this spectrum?
2. What calibration was active?
3. What was the exact spectral grid and integration time?
4. Was the sample simulated, recorded or physically measured?
5. What RFI/quality flags were applied?
6. Can the result be repeated or independently checked?

## Scope

Receive only. No RF transmission, jamming, protected-communications interception/decryption, weapon guidance, military target tracking or covert collection is part of the Space Science roadmap.
