#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace rf {
constexpr std::size_t max_bins = 512;
enum class Error { ok, invalid_plan, unsupported_band, busy, driver, invalid_sample };
enum class State { idle, scanning, complete, fault };
struct Band { std::uint32_t min_hz; std::uint32_t max_hz; };
struct Plan {
    std::uint32_t start_hz{433000000};
    std::uint32_t stop_hz{434000000};
    std::uint32_t step_hz{10000};
    std::uint32_t dwell_ms{20};
};
struct Sample { std::uint32_t frequency_hz{}; float rssi_dbm{}; std::uint64_t timestamp_ms{}; };

// A receiver is owned and called by one task; implementations must not block.
// tune() starts tuning; dwell_ms must cover that receiver's settling time.
class Receiver {
public:
    virtual ~Receiver() = default;
    virtual bool supports(const Plan&) const = 0;
    virtual bool tune(std::uint32_t frequency_hz) = 0;
    virtual bool read(float& rssi_dbm) = 0;
    virtual void standby() = 0;
};
Error validate(const Plan& plan);
bool within(const Plan& plan, const Band* bands, std::size_t count);
std::size_t bin_count(const Plan& plan);
const char* error_name(Error error);

class Scanner {
public:
    explicit Scanner(Receiver& receiver) : receiver_(receiver) {}
    Error start(const Plan& plan, std::uint64_t now_ms);
    Error tick(std::uint64_t now_ms);
    void stop();
    State state() const { return state_; }
    Error error() const { return error_; }
    std::size_t size() const { return size_; }
    const std::array<Sample, max_bins>& samples() const { return samples_; }
private:
    Error fail(Error error);
    Receiver& receiver_;
    Plan plan_{};
    std::array<Sample, max_bins> samples_{};
    std::size_t size_{};
    std::uint64_t tuned_at_{};
    std::uint64_t last_now_{};
    std::uint32_t frequency_{};
    State state_{State::idle};
    Error error_{Error::ok};
};

// Deterministic test source. Never touches GPIO, SPI, I2C or RF hardware.
class SimulatedReceiver final : public Receiver {
public:
    bool supports(const Plan& plan) const override { return validate(plan) == Error::ok; }
    bool tune(std::uint32_t frequency_hz) override { frequency_ = frequency_hz; active_ = true; return true; }
    bool read(float& rssi_dbm) override;
    void standby() override { active_ = false; }
private:
    std::uint32_t frequency_{};
    bool active_{};
};
} // namespace rf
