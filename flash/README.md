# Nạp code ESP32-S3

Thư mục này là lối vào đơn giản để **build + flash firmware RF Observatory lên ESP32-S3** bằng ESP-IDF.

> Firmware hiện tại giữ boundary **receive-only**. Bản đang có trong repo dùng `SimulatedReceiver` cho scan core; HTTPS/serial telemetry chạy được, nhưng chưa phải driver cho một RF front-end vật lý cụ thể.

## Yêu cầu

- ESP-IDF **v5.4.2**
- ESP32-S3 kết nối USB
- Python/driver USB theo ESP-IDF
- Chạy trong ESP-IDF terminal để lệnh `idf.py` có sẵn

## Windows PowerShell

Từ root repository:

```powershell
.\flash\flash-esp32s3.ps1 -Port COM5
```

Mở cấu hình Wi-Fi/HTTPS trước khi nạp:

```powershell
.\flash\flash-esp32s3.ps1 -Port COM5 -Menuconfig
```

Nạp xong mở serial monitor:

```powershell
.\flash\flash-esp32s3.ps1 -Port COM5 -Monitor
```

Xóa flash trước khi nạp lại khi thật sự cần:

```powershell
.\flash\flash-esp32s3.ps1 -Port COM5 -Erase
```

Nếu bỏ `-Port`, ESP-IDF sẽ tự dò cổng nếu môi trường hỗ trợ.

## macOS / Linux

```bash
chmod +x flash/flash-esp32s3.sh
./flash/flash-esp32s3.sh /dev/ttyACM0
```

Ví dụ mở menuconfig và monitor:

```bash
MENUCONFIG=1 MONITOR=1 ./flash/flash-esp32s3.sh /dev/ttyACM0
```

Xóa flash trước khi nạp:

```bash
ERASE_FLASH=1 ./flash/flash-esp32s3.sh /dev/ttyACM0
```

## HTTPS console

Wi-Fi credentials được cấu hình local bằng `idf.py menuconfig`. TLS certificate/key không được commit vào git.

Nếu chưa có certificate:

- `firmware/main/certs/server.crt`
- `firmware/main/certs/server.key`

thì firmware vẫn build/scan/serial bình thường, chỉ HTTPS console không khởi động.

## File binary

CI của repo build cả `esp32` và `esp32s3`, và xuất artifact gồm:

- application `.bin`
- `bootloader.bin`
- `partition-table.bin`
- `flasher_args.json`

Không commit binary cố định vào repo để tránh nạp nhầm firmware cũ. Khi cần file `.bin` phát hành cố định, nên lấy từ một commit/tag đã xác định.
