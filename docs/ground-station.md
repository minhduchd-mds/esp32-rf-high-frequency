# Ground Station Commissioning

RF Observatory v0.7 is software-ready for a passive physical receiver, but physical commissioning is a separate verification milestone.

## Required evidence before calling a station calibrated

1. Hardware manifest identifying receive-only receiver, antenna/feed, filters, LNA and clock reference.
2. Calibration curve covering the complete observation frequency grid.
3. Known-source or laboratory reference measurements documenting gain/noise behavior.
4. Local RFI survey and explicit quality masks.
5. Receiver RBW/integration settings preserved with every frame.
6. Raw evidence archived separately from calibrated/derived views.
7. Repeated observation and independent confirmation before attributing a candidate to an astronomical source.

## Gateway boundary

`scripts/gateway.mjs` binds to loopback only. Spectrum frames enter on stdin and leave through a GET-only SSE endpoint. There is no network RF command path.

## Example hardware manifest

```json
{
  "schema":"rf-observatory/hardware-manifest-v1",
  "receive_only":true,
  "receiver":"science receiver",
  "antenna":"L-band feed",
  "front_end":{
    "lna":"documented low-noise amplifier",
    "filters":["documented receive filter"],
    "clock_reference":"documented oscillator/reference"
  },
  "station":"local observatory",
  "notes":"commissioning manifest"
}
```

No transmission, jamming, protected-communications interception/decryption, military target tracking or weapon guidance is in scope.
