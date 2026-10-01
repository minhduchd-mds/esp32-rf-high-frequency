# Repository guidance

Read README.md and docs/architecture.md before editing. This file is project guidance, not a bundled Claude skill.

- Keep portable C++17 domain logic in core; isolate ESP-IDF and bus drivers.
- No dynamic allocation, blocking waits or hardware assumptions in the scanner.
- Validate plans and samples at boundaries; use explicit integer Hz and monotonic ms.
- Bound buffers and queues. Never reinterpret simulation as device measurements.
- Do not infer direction/distance from RSSI or decorate frequency plots with geographic units.
- Do not add a hardware adapter without the part/board configuration and a fake-bus test.
- Browser strings imported from files must be rendered through textContent.
- Test with `bash scripts/check.sh`; run sanitizers where available.
- Test UI at 1366×768 and 390×844, including serial cancellation and invalid imports.
- Report host, browser, firmware compilation and physical hardware verification separately.
- Keep pin mappings, credentials and cloud dependencies out until actually required.
