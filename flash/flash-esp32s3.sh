#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIRMWARE_DIR="$REPO_ROOT/firmware"

if ! command -v idf.py >/dev/null 2>&1; then
  echo "Khong tim thay idf.py. Hay activate ESP-IDF v5.4.2 environment truoc." >&2
  exit 1
fi

if [[ ! -f "$FIRMWARE_DIR/CMakeLists.txt" ]]; then
  echo "Khong tim thay thu muc firmware." >&2
  exit 1
fi

cd "$FIRMWARE_DIR"

if [[ ! -f sdkconfig ]] || ! grep -q '^CONFIG_IDF_TARGET="esp32s3"$' sdkconfig; then
  echo "==> Set target: esp32s3"
  idf.py set-target esp32s3
fi

if [[ "${MENUCONFIG:-0}" == "1" ]]; then
  echo "==> Open menuconfig"
  idf.py menuconfig
fi

echo "==> Build firmware"
idf.py build

PORT_ARGS=()
if [[ -n "$PORT" ]]; then
  PORT_ARGS=(-p "$PORT")
fi

if [[ "${ERASE_FLASH:-0}" == "1" ]]; then
  if [[ -z "$PORT" ]]; then
    echo "ERASE_FLASH=1 yeu cau chi dinh cong serial de tranh xoa nham thiet bi." >&2
    exit 1
  fi
  echo "==> Erase flash: $PORT"
  idf.py "${PORT_ARGS[@]}" erase-flash
fi

echo "==> Flash ESP32-S3"
idf.py "${PORT_ARGS[@]}" flash

if [[ "${MONITOR:-0}" == "1" ]]; then
  echo "==> Serial monitor (Ctrl+] de thoat)"
  idf.py "${PORT_ARGS[@]}" monitor
fi
