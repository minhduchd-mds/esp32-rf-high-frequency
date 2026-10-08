# Security Policy — RF Observatory

**Status:** Receive-only ESP32-S3 research and measurement tooling, not a certified RF instrument or safety/security appliance.

## Reporting

Do not post exploitable payloads, credentials, real location traces or sensitive spectrum data in a public issue. Use GitHub's private vulnerability-reporting feature if available, or contact the maintainer privately through their GitHub profile. No response-time SLA is represented.

Useful context: target board revision, firmware commit, build flags, hardware input path, affected protocol, minimum safe reproduction, observed output and expected receive-only behavior.

## Threat and safety boundaries

- **Receive-only**: no radio transmission or intentional interference capability is authorized by this repository.
- External RF front ends require properly rated input protection; arbitrary GPIO pins are not calibrated RF receivers.
- Web dashboards, SSE streams and configuration endpoints must not be assumed authenticated merely because they operate on a local AP/LAN.
- Calibration metadata and recorded signals are not reliable without validated hardware and provenance.
- No hardware is certified as an operational radar or military-grade receiver.

## Validation expectations

Before field use, inspect exposed services, network authentication, dependency provenance and update/rollback behavior; verify power, connectors, ADC limits and receive-only properties on physical hardware. Preserve evidence without retaining personal or unauthorized communications content.
