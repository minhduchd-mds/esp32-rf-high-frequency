#include "rf/scanner.hpp"
#include "rf/telemetry.hpp"
#include <cstdlib>
#include <cstdio>
#include <limits>
#include <cstring>

static int checks = 0;
#define CHECK(x) do { ++checks; if (!(x)) { std::fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #x); std::exit(1); } } while (false)
struct FakeReceiver : rf::Receiver {
    bool supported = true, tune_ok = true, read_ok = true, stopped = false;
    float value = -70;
    unsigned tunes = 0;
    bool supports(const rf::Plan&) const override { return supported; }
    bool tune(std::uint32_t) override { ++tunes; stopped = false; return tune_ok; }
    bool read(float& out) override { out = value; return read_ok; }
    void standby() override { stopped = true; }
};
int main() {
    using namespace rf;
    CHECK(validate({0, 10, 1, 20}) == Error::invalid_plan);
    CHECK(validate({10, 9, 1, 20}) == Error::invalid_plan);
    CHECK(validate({1, 10, 0, 20}) == Error::invalid_plan);
    CHECK(validate({1, 10, 1, 0}) == Error::invalid_plan);
    CHECK(validate({1, 10, 1, 10001}) == Error::invalid_plan);
    CHECK(validate({1, 512, 1, 1}) == Error::ok);
    CHECK(validate({1, 513, 1, 1}) == Error::invalid_plan);
    CHECK(validate({1, UINT32_MAX, 1, 1}) == Error::invalid_plan);
    CHECK(bin_count({1, 10, 3, 1}) == 4);
    const Band bands[] = {{300000000,348000000},{387000000,464000000},{779000000,928000000}};
    CHECK(within(Plan{}, bands, 3));
    CHECK(!within({348000000, 387000000, 1000000, 20}, bands, 3));
    CHECK(!within(Plan{}, nullptr, 0));
    FakeReceiver rx;
    Scanner s(rx);
    CHECK(s.start({1, 10, 3, 20}, 100) == Error::ok);
    CHECK(s.start(Plan{}, 100) == Error::busy);
    CHECK(s.tick(119) == Error::ok && s.size() == 0);
    CHECK(s.tick(120) == Error::ok && s.size() == 1);
    CHECK(s.samples()[0].frequency_hz == 1);
    s.tick(1000); // A delayed scheduler takes one sample, not a fictitious burst.
    CHECK(s.size() == 2);
    s.tick(1020); s.tick(1040);
    CHECK(s.state() == State::complete && s.size() == 4 && rx.stopped);
    CHECK(s.samples()[3].frequency_hz == 10);
    s.stop(); CHECK(s.state() == State::idle);
    CHECK(s.start({UINT32_MAX-1, UINT32_MAX, 1, 1}, 0) == Error::ok);
    s.tick(1); s.tick(2);
    CHECK(s.state() == State::complete && s.size() == 2);
    CHECK(s.samples()[1].frequency_hz == UINT32_MAX);
    rx.supported = false;
    CHECK(s.start(Plan{}, 0) == Error::unsupported_band);
    rx.supported = true; rx.tune_ok = false;
    CHECK(s.start(Plan{}, 0) == Error::driver && rx.stopped);
    rx.tune_ok = true; rx.read_ok = false;
    CHECK(s.start(Plan{}, 0) == Error::ok);
    CHECK(s.tick(20) == Error::driver && s.size() == 0 && rx.stopped);
    rx.read_ok = true; rx.value = std::numeric_limits<float>::quiet_NaN();
    s.start(Plan{}, 0);
    CHECK(s.tick(20) == Error::invalid_sample && rx.stopped);
    rx.value = 21; s.start(Plan{}, 0);
    CHECK(s.tick(20) == Error::invalid_sample);
    rx.value = -70; s.start(Plan{}, 100); s.tick(110);
    CHECK(s.tick(109) == Error::driver && rx.stopped);
    s.start({1, 512, 1, 1}, 0);
    for (std::uint64_t i = 1; i <= 512; ++i) CHECK(s.tick(i) == Error::ok);
    CHECK(s.size() == 512 && s.state() == State::complete);
    SimulatedReceiver sim; Scanner demo(sim);
    demo.start(Plan{}, 0);
    for (std::uint64_t now = 20; demo.state() == State::scanning; now += 20) demo.tick(now);
    CHECK(demo.size() == 101 && demo.samples()[92].rssi_dbm == -50.0F);
    char line[256], small[4];
    CHECK(format_sample(line, sizeof(line), demo.samples()[0], 1, 0, 101) > 0);
    CHECK(std::strstr(line, "\"source\":\"simulation\"") != nullptr);
    CHECK(format_sample(small, sizeof(small), demo.samples()[0], 1, 0, 101) == 0 && small[0] == '\0');
    CHECK(format_sample(nullptr, 0, demo.samples()[0], 1, 0, 101) == 0);
    std::printf("PASS: %d core assertions\n", checks);
}
