#pragma once
#include "rf/scanner.hpp"
#include <cstddef>
#include <cstdint>

namespace rf_web {
void publish(const rf::Sample* samples, std::size_t count, std::uint32_t sweep);
void start_async();
}
