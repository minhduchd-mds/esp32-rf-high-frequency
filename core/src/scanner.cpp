#include "rf/scanner.hpp"
#include <cmath>

namespace rf {
std::size_t bin_count(const Plan& p) {
    if (p.step_hz == 0 || p.stop_hz < p.start_hz) return 0;
    return static_cast<std::size_t>((static_cast<std::uint64_t>(p.stop_hz) - p.start_hz) / p.step_hz + 1);
}
Error validate(const Plan& p) {
    if (p.start_hz == 0 || p.stop_hz < p.start_hz || p.step_hz == 0 ||
        p.dwell_ms < 1 || p.dwell_ms > 10000 || bin_count(p) > max_bins)
        return Error::invalid_plan;
    return Error::ok;
}
bool within(const Plan& p, const Band* bands, std::size_t count) {
    if (validate(p) != Error::ok || bands == nullptr) return false;
    for (std::size_t i = 0; i < count; ++i)
        if (p.start_hz >= bands[i].min_hz && p.stop_hz <= bands[i].max_hz) return true;
    return false; // Crossing an unsupported gap is never accepted.
}
const char* error_name(Error e) {
    switch (e) {
    case Error::ok: return "ok";
    case Error::invalid_plan: return "invalid_plan";
    case Error::unsupported_band: return "unsupported_band";
    case Error::busy: return "busy";
    case Error::driver: return "driver_error";
    case Error::invalid_sample: return "invalid_sample";
    }
    return "unknown";
}
Error Scanner::fail(Error e) {
    receiver_.standby(); state_ = State::fault; error_ = e; return e;
}
Error Scanner::start(const Plan& p, std::uint64_t now) {
    if (state_ == State::scanning) return Error::busy;
    const auto valid = validate(p);
    if (valid != Error::ok) return valid;
    if (!receiver_.supports(p)) return Error::unsupported_band;
    plan_ = p; size_ = 0; frequency_ = p.start_hz;
    tuned_at_ = last_now_ = now; error_ = Error::ok;
    if (!receiver_.tune(frequency_)) return fail(Error::driver);
    state_ = State::scanning;
    return Error::ok;
}
Error Scanner::tick(std::uint64_t now) {
    if (state_ != State::scanning) return error_;
    if (now < last_now_) return fail(Error::driver); // Require a monotonic clock.
    last_now_ = now;
    if (now - tuned_at_ < plan_.dwell_ms) return Error::ok;
    float rssi{};
    if (!receiver_.read(rssi)) return fail(Error::driver);
    if (!std::isfinite(rssi) || rssi < -160.0F || rssi > 20.0F) return fail(Error::invalid_sample);
    samples_[size_++] = {frequency_, rssi, now};
    const std::uint64_t next = static_cast<std::uint64_t>(frequency_) + plan_.step_hz;
    if (next > plan_.stop_hz || size_ == bin_count(plan_)) {
        receiver_.standby(); state_ = State::complete; return Error::ok;
    }
    frequency_ = static_cast<std::uint32_t>(next);
    if (!receiver_.tune(frequency_)) return fail(Error::driver);
    tuned_at_ = now;
    return Error::ok;
}
void Scanner::stop() { receiver_.standby(); state_ = State::idle; error_ = Error::ok; }
bool SimulatedReceiver::read(float& rssi) {
    if (!active_) return false;
    const double x = (static_cast<double>(frequency_) - 433920000.0) / 22000.0;
    rssi = static_cast<float>(-108.0 + 58.0 * std::exp(-0.5 * x * x));
    return true;
}
} // namespace rf
