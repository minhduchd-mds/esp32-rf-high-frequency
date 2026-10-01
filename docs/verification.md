# Verification — v0.1

## Local evidence

- `bash scripts/check.sh`: 549 C++ assertions, 6 JavaScript model/protocol tests and the C++ → JSONL → JavaScript integration check passed.
- `ASAN_OPTIONS=detect_leaks=0 SANITIZE=1 bash scripts/check.sh`: AddressSanitizer and UndefinedBehaviorSanitizer passed. LeakSanitizer cannot inspect this workspace's process environment, so leak detection was disabled for this local run. CI runs with normal sanitizer defaults.
- `node --check web/app.js` and `node --check web/model.js`: passed.
- CMake release build and CTest: passed.
- `tests/browser.mjs` with Playwright/Chromium: simulation start/pause, threshold, profile change, clear, JSONL export/import, invalid-file preservation, fake USB cancellation/stream/disconnect and source isolation passed with zero console errors. Layout checked at 1366×768, 768×1024 and 390×844; desktop/mobile screenshots were visually inspected.

## Required independent evidence

- Firmware compile: GitHub Actions is configured for ESP32 and ESP32-S3, but has not run for this change. ESP-IDF is not installed locally. Compilation does not establish hardware correctness.
- Physical hardware: not tested. No attached board or RF receiver was available, and no physical RF driver is included. Browser Web Serial lifecycle can be tested with a fake port, but actual USB drivers/ports require an attached board.

The simulator's spectral values are synthetic fixtures, not measured sensitivity, noise floor, dynamic range or scan-speed benchmarks.

## Repeat browser checks

Run `npm ci`, `npx playwright install chromium`, then `npm run test:browser`. It starts and stops its own local HTTP server and uses no external services. Optional environment variables `RF_PLAYWRIGHT_PATH` (module path) and `RF_CHROMIUM` (browser executable) allow a preinstalled runtime. Screenshots go to ignored `test-results/`. The browser CI job runs this suite and uploads screenshots.

## Delivery workflow

Changes are delivered directly to `main` as requested by the repository owner. Check the GitHub Actions run for the exact commit before treating the firmware build as verified.
