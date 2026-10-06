# Production security

The RF Observatory developer firmware remains easy to flash and inspect. Production deployments use a separate hardening profile so irreversible ESP32-S3 eFuse changes are never enabled accidentally by normal CI.

## Production controls

- Secure Boot V2.
- Signed firmware artifacts.
- Flash Encryption in Release mode.
- OTA rollback and explicit application confirmation.
- Application anti-rollback security version.
- TLS device identity provisioned per device or per managed fleet policy.
- No private signing keys, Wi-Fi passwords or production certificates in Git.

## Measurement integrity

Security is also part of scientific integrity. Every accepted acquisition should retain:
- original/raw payload or immutable raw-frame reference;
- acquisition timestamp and uncertainty;
- device/receiver identity;
- firmware/build identity;
- calibration identifier;
- dropped-frame / discontinuity accounting;
- cryptographic digest for sealed sessions.

Derived/calibrated data must remain distinguishable from raw acquisition data.

## Provisioning rule

Do not enable `firmware/sdkconfig.production.defaults` on general development boards. Test provisioning, signed boot, encrypted flash, failed-update rollback and device recovery on dedicated hardware before fleet deployment.
