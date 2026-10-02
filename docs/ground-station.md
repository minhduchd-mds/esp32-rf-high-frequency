# Ground Station Commissioning — v0.10

Status: tested software foundation for supervised receive-only experiments. Not a physically commissioned or certified station.

## Fixed data path

Acquisition → validate/sequence-check → fsync gateway journal → SSE → bounded browser raw session → integration → optional correction → RFI analysis → sealed evidence bundle.
The gateway journal preserves each accepted Spectrum v2 frame before publishing, even with no browser connected. Invalid/out-of-order frames are rejected and counted. No browser RF command path exists.

The browser stores pre-integration inputs. At 20,000 samples or 8 MiB it stops rather than evicting evidence. JSONL retains v2 RBW/integration/calibration fields; v1 remains v1 and cannot invent missing metadata. Browser memory is not durable storage; use the gateway journal for device acquisition. A new stream after reset requires a new session.

## Science bundle v2

Contains raw records and digest, complete normalized hardware manifest and correction curve plus fingerprints, acquisition metadata, actual integration count, missing-sweep count, incomplete integration count, derived samples and processing errors. Export snapshots the payload before hashing.
Verification validates the checksum, schema and deterministic replay. Comparison requires verified bundles, compatible source/grid/profile/hardware/curve/RBW/integration/masks and available acquisition settings. Missing sweeps block comparison.

`correction-applied` never upgrades the station to physically calibrated. Already calibrated input is not corrected again. A correction failure remains exportable with raw intact. SHA-256 is a content checksum, not an authenticated signature.
RFI masks are a review policy applied to raw evidence; changing them resets candidate persistence. Clean-bin baseline and peak exclude masked bins; masked candidates remain annotated. All bins masked produces no baseline/candidate claim.

## Required physical evidence

1. Exact board/module/revision, receiver serial, antenna/feed and complete receive chain.
2. Schematic, pin allocation and protected input/fixture review.
3. Traceable calibration source, gain settings, RBW, temperature, date and uncertainty budget.
4. Known-source gain/noise measurements and oscillator stability.
5. Local RFI survey; separate assessment of Wi-Fi console interference.
6. Power-loss, full-disk, receiver reset, disconnection and long-duration recovery trials.
7. Repeat observation and independent confirmation before astronomical attribution.

No transmission, jamming, communications interception/decryption or targeting functionality is added.
