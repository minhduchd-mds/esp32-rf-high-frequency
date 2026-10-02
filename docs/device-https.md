# ESP32-S3 HTTPS Device Console

RF Observatory v0.9 adds a second web surface that runs **on the ESP32-S3 itself**.

## Architecture

```text
Browser
  │
  │ HTTPS :443
  ▼
ESP32-S3 esp_https_server
  ├── GET /
  ├── GET /api/status
  └── GET /api/spectrum
          │
          ▼
     latest complete
     receive-only sweep
```

The device console is intentionally read-only. There are no POST/PUT command endpoints and no RF transmit/tune control API.

## UI

The embedded UI is dependency-free and optimized for ESP32-S3 RAM/flash:

- device IP;
- Wi-Fi RSSI;
- free heap;
- uptime;
- current sweep/bin count;
- latest spectrum;
- Top-6 local peaks;
- HTTPS / receive-only status.

It polls small JSON endpoints rather than using a framework or persistent WebSocket.

## TLS

ESP-IDF's HTTPS server uses an embedded server certificate and private key. RF Observatory refuses to embed a repository key by default. Place a local certificate at:

- `firmware/main/certs/server.crt`
- `firmware/main/certs/server.key`

The build detects and embeds them. CI generates an ephemeral certificate to verify the HTTPS code path.

## Wi-Fi

Credentials are local Kconfig values under **RF Observatory device console**. The generated `firmware/sdkconfig` is already ignored by git.

If the SSID is empty, the RF scanner continues normally and the HTTPS console stays offline.

## Security boundary

The device server exposes only GET endpoints. It does not contain:

- RF transmission commands;
- retuning commands;
- arbitrary shell execution;
- filesystem upload;
- firmware update endpoint;
- protected-communications interception/decryption.

For production use, replace self-signed development TLS with a device-specific identity and an appropriate trust model.
