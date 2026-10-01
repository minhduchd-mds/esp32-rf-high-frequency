# RF Observatory

ESP32 RF measurement workspace: a portable C++ scan engine, ESP-IDF simulation firmware, and a browser signal console.

**v0.1 is a working simulation foundation. No CC1101/Si4735/PCNT/RMT hardware drivers are implemented yet.** The firmware emits simulated measurements over USB serial; connecting it does not turn those measurements into real RF data.

## Run the console

Requires Python 3. No frontend dependencies, CDN, API key or build step.

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Open <http://localhost:8080>. Select a simulation band and **Bắt đầu quét**. The console includes a polar signal view, RSSI spectrum, peak hold, threshold control, top peaks, a 100-sweep waterfall, JSONL import/export and read-only Web Serial ingestion.

The polar view maps frequency to angle and RSSI to radius. It does **not** measure direction, distance, object position or velocity. The waterfall shows sequential sweeps, not simultaneous broadband capture. Displayed kHz is the tuning step, not receiver resolution bandwidth. RSSI outside the plot's −120…−30 dBm range is clipped visually; numeric values and exports preserve −160…+20 dBm.

## Test and generate a recording

Requires GCC/Clang with C++17 and Node.js 22 or newer.

```sh
bash scripts/check.sh
# Optional address/undefined-behavior sanitizers:
SANITIZE=1 bash scripts/check.sh
```

The script creates `build/demo.jsonl`. Open this file in the console to inspect the exact C++ simulator output. Host tests cover plan limits, frequency overflow, timing, driver faults, malformed data, incomplete sweeps, source separation and bounded history. `CMakeLists.txt` also supports CMake/CTest.

## ESP32 simulation firmware

The CI build baseline is ESP-IDF **v5.4.2**, with ESP32 and ESP32-S3 targets. Use the matching installed SDK:

```sh
cd firmware
idf.py set-target esp32
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

For ESP32-S3, use `set-target esp32s3` and the board's UART bridge connector. USB Serial/JTAG console routing is not configured in this baseline. Port names vary by operating system. Exit the serial monitor before connecting the browser to the same port.

In desktop Chrome/Edge on localhost or HTTPS, select **Kết nối USB** and choose the board's serial port (115200 baud). The firmware runs a fixed 433–434 MHz **simulated** sweep. Browser scan/preset controls apply only to browser simulation and are disabled during USB ingestion. No browser command is sent to hardware.

## Repository map

| Path | Responsibility |
|---|---|
| `core/` | Fixed-capacity scan state machine and receiver interface |
| `simulator/` | Host simulation emitting JSONL |
| `firmware/` | ESP-IDF app using the same core and simulation source |
| `web/` | Vietnamese signal console, without external assets |
| `tests/` | C++ boundary tests and JavaScript protocol/model tests |
| `docs/` | Architecture, protocol, hardware roadmap and verification |

## Next hardware milestone

Integrate one confirmed board/module first: CC1101 receive-only RSSI scanning, then Si4735 HF reception and a separate PCNT/RMT pulse measurement path. Board revision, module matching network, antenna, oscillator and pin mapping must be known before implementing/validating a physical adapter. See [architecture](docs/architecture.md), [hardware plan](docs/hardware.md), [protocol](docs/protocol.md) and [verification](docs/verification.md).
