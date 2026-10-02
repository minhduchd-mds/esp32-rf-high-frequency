#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
flags=(-std=c++17 -Wall -Wextra -Werror -Wconversion -pedantic -Icore/include)
if [[ "${SANITIZE:-0}" == "1" ]]; then
  flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer -g)
fi
"${CXX:-g++}" "${flags[@]}" core/src/scanner.cpp tests/core_test.cpp -o build/rf_tests
./build/rf_tests
"${CXX:-g++}" "${flags[@]}" core/src/scanner.cpp simulator/main.cpp -o build/rf_simulator
./build/rf_simulator > build/demo.jsonl
node --test tests/model.test.mjs tests/gateway.test.mjs tests/weak-signal.test.mjs
node scripts/check-telemetry.mjs build/demo.jsonl
