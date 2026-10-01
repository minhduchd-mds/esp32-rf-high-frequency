#pragma once
#include "rf/scanner.hpp"
#include <cinttypes>
#include <cstdio>

namespace rf {
// Caller supplies an entire single-line output buffer. Zero means insufficient space.
inline std::size_t format_sample(char* output, std::size_t capacity,
                                 const Sample& sample, std::uint32_t sweep,
                                 std::size_t index, std::size_t total) {
    if (output == nullptr || capacity == 0) return 0;
    const int count = std::snprintf(output, capacity,
        "{\"version\":1,\"type\":\"sample\",\"source\":\"simulation\","
        "\"sweep\":%" PRIu32 ",\"index\":%zu,\"total\":%zu,"
        "\"frequency_hz\":%" PRIu32 ",\"rssi_dbm\":%.2f,\"timestamp_ms\":%" PRIu64 "}",
        sweep, index, total, sample.frequency_hz, static_cast<double>(sample.rssi_dbm), sample.timestamp_ms);
    if (count < 0 || static_cast<std::size_t>(count) >= capacity) { output[0] = '\0'; return 0; }
    return static_cast<std::size_t>(count);
}
} // namespace rf
