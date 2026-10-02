# Space Science Roadmap

RF Observatory is evolving as a **passive radio-science observatory** with a mission-control UI and reproducible data pipeline.

## v0.2 — space profiles

Completed:

- Solar/Jovian 14–30 MHz simulation profile.
- Neutral-hydrogen 1400–1427 MHz simulation profile.
- Explicit 21-cm reference frequency.
- Passive candidate triage.

## v0.3 — ground-station data discipline

Completed in software:

- 360-row science history.
- science-session export with provenance.
- calibration-state metadata.
- configurable sweep integration.
- read-only Spectrum v2 gateway contract.

## v0.4 — science processing

Completed foundation:

- power-domain integration across matching sweeps;
- median baseline estimation;
- candidate delta above baseline;
- RFI masks that **flag rather than delete** evidence;
- reference-line candidate classification.

Still pending physical validation:

- measured gain/noise calibration;
- receiver-specific RBW verification;
- long-duration clock stability;
- laboratory RFI characterization.

## v0.5 — observatory pipeline

Completed foundation:

- Mission Console exposes baseline, candidate count and integration factor.
- JSONL raw evidence and separate science-session export.
- bounded SDR frame validator/converter.
- provenance remains simulation/device specific.

## v0.6 — ground-station bridge

Completed:

- localhost-only, GET-only SSE gateway for Spectrum v2;
- gateway input from stdin so browser content cannot command the RF device;
- bounded clients and frame validation;
- observation hardware manifest with SHA-256 fingerprint.

## v0.7 — reproducibility layer

Completed:

- calibration-curve import and interpolation with full-band coverage checks;
- raw evidence preserved separately from calibrated display values;
- user-defined RFI quality-mask editor;
- SHA-256 sealed science-session exports;
- integrity verification and two-session comparison.

Still future work:

- physical receiver calibration in the lab;
- actual antenna/front-end commissioning;
- optional public scientific context feeds;
- independent cross-station confirmation workflows.

## v1.0 target

A science station should be reproducible: receiver chain, calibration, spectral grid, integration, source provenance, RFI flags and raw evidence must all be recoverable.

No RF transmission, jamming, protected-communications interception/decryption, weapon guidance, military target tracking or covert collection is part of this roadmap.
