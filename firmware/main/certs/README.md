# Device HTTPS certificate

Do **not** commit a real TLS private key to this repository.

For a local development build, create a certificate and key here:

```sh
mkdir -p firmware/main/certs
openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -keyout firmware/main/certs/server.key \
  -out firmware/main/certs/server.crt \
  -days 365 \
  -subj "/CN=rf-observatory.local/O=RF Observatory"
```

Then configure Wi-Fi with:

```sh
cd firmware
idf.py menuconfig
```

Open **RF Observatory device console**, set SSID/password, then build and flash the ESP32-S3.

The self-signed development certificate encrypts the connection but is not automatically trusted by browsers. For a deployed station, provision a device-specific certificate/key through a secure manufacturing or device-identity workflow.

CI creates an ephemeral certificate only to compile and verify the HTTPS-enabled ESP32-S3 path.
