# Weak Signal Lab

RF Observatory v0.8 applies the useful, testable parts of the historical Faraday–Maxwell–Tesla line of work to modern weak-signal instrumentation.

## What is carried forward

### Faraday: changing flux → measurable EMF

Search coils and H-field loops belong to the changing-magnetic-flux path. They are not universal sensors and should not be treated as DC magnetometers.

### Maxwell: fields are spatial and time-dependent

The software model therefore distinguishes conducted, near-field and far-field measurements and adds a bounded 3D `WaveFieldMap` data structure instead of treating every measurement as one RF scalar.

### Tesla: resonance, selectivity and accumulation

Tesla's tuned/resonant receiver ideas are translated into a modern receive-only method: `resonantPowerEstimate()` applies a narrow Lorentzian weighting around a selected center frequency/Q. This is a software analysis window, not energy creation and not proof of signal origin.

Repeated weak peaks are handled by `CandidatePersistence`. A candidate must recur across multiple independent sweeps before becoming persistent.

### Modern phase-sensitive detection

A true lock-in detector needs time-domain samples and a known reference. `synchronousDetect()` therefore operates only on sampled values with a declared sample rate/reference frequency and returns I, Q, amplitude and phase. It is intentionally not faked from RSSI-only spectra.

## Multi-sensor coincidence

`groupCoincidentObservations()` combines observations only when independent sensor classes agree within explicit time/frequency tolerances.

Supported model classes:

- direct voltage;
- E-field;
- H-field loop;
- search coil;
- fluxgate;
- RF antenna.

Coincidence increases confidence that an event is physically repeatable, but does not identify its cause.

## Wave-field map

Each map point preserves:

```text
x, y, z
sensor kind
frequency
measured value + unit
timestamp
```

This enables later E/H/RF spatial heat maps and frequency × space cubes without confusing them with target location or radar ranging.

## Scientific discipline

The pipeline is:

```text
sensor
  ↓
low-noise front end
  ↓
bounded acquisition
  ↓
selective/resonant analysis
  ↓
integration / synchronous detection
  ↓
RFI flags
  ↓
multi-sweep persistence
  ↓
multi-sensor coincidence
  ↓
candidate review
  ↓
repeat observation / independent confirmation
```

A persistent or coincident candidate is still not evidence of extraterrestrial origin.

## Historical references

- Nikola Tesla, US 645576 A — tuned/resonant transmission and receiving system.
- Nikola Tesla, US 685012 A — increasing intensity of electrical oscillations.
- Nikola Tesla, US 725605 A — selective signalling with tuned receiving circuits.
- Michael Faraday — electromagnetic induction.
- James Clerk Maxwell — *A Treatise on Electricity and Magnetism*.

The project uses these as engineering/history references; physical claims are evaluated with reproducible measurement, calibration and independent confirmation.
