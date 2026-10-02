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
"${CXX:-g++}" "${flags[@]}" core/src/scanner.cpp tests/fault_test.cpp -o build/rf_fault_tests
./build/rf_fault_tests
"${CXX:-g++}" "${flags[@]}" core/src/scanner.cpp simulator/main.cpp -o build/rf_simulator
./build/rf_simulator > build/demo.jsonl
node --test tests/*.test.mjs
for source in web/*.js scripts/*.mjs; do node --check "$source"; done
node scripts/check-telemetry.mjs build/demo.jsonl

