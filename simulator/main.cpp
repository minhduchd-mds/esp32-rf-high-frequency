#include "rf/scanner.hpp"
#include "rf/telemetry.hpp"
#include <cstdio>

int main() {
    rf::SimulatedReceiver receiver;
    rf::Scanner scanner(receiver);
    const rf::Plan plan;
    if (scanner.start(plan, 0) != rf::Error::ok) return 1;
    std::size_t emitted = 0;
    for (std::uint64_t now = 0; scanner.state() == rf::State::scanning; now += plan.dwell_ms) {
        if (scanner.tick(now) != rf::Error::ok) return 1;
        if (scanner.size() > emitted) {
            char line[256];
            if (!rf::format_sample(line, sizeof(line), scanner.samples()[emitted], 0, emitted, rf::bin_count(plan))) return 1;
            std::puts(line); ++emitted;
        }
    }
}
