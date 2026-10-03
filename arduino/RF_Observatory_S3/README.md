# RF Observatory S3 — Arduino

Arduino firmware cho ESP32-S3 chạy passive signal observatory từ GPIO4 / ADC1.

## Truy cập dashboard

ESP32-S3 tự tạo Wi-Fi:

- SSID: `RF-Observatory-S3`
- Password: `observe1234`
- HTTP: `http://192.168.4.1/`
- mDNS: `http://rf-observatory.local/` khi client hỗ trợ

## Màn hình

1. Overview — relative level, detector voltage, peak hold, event count, generic signal pattern và fingerprint.
2. Live Signal — ADC mean/RMS, peak-to-peak, baseline, noise, sample rate.
3. Envelope Spectrum — Goertzel spectrum của envelope/baseband.
4. Events — event log.
5. Field Survey Map — ghi mức tương đối theo các điểm đo thủ công.
6. Device — IP, Wi-Fi, heap, uptime.

## API

- `/api/status`
- `/api/live`
- `/api/history`
- `/api/spectrum`
- `/api/events`

## Build

- Board: ESP32S3 Dev Module
- Arduino-ESP32: 3.3.12
- Serial: 115200
- ADC: GPIO4 / ADC1
- Sketch: `RF_Observatory_S3.ino`

```text
Cuộn cảm / LC / detector
          ↓
      GPIO4 ADC1
          ↓
ESP32-S3 acquisition + analysis
          ↓
 HTTP dashboard :80
```

Một detector envelope đơn kênh không cung cấp RF carrier chính xác. Envelope Spectrum mô tả biến thiên sau detector; phân giải RF thật cần front-end/channelizer phù hợp.
