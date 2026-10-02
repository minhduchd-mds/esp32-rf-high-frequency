#include "rf/scanner.hpp"
#include "rf/telemetry.hpp"
#include "device_web_server.hpp"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdio>
#include "sdkconfig.h"
#if defined(CONFIG_RF_GPIO_DIAGNOSTICS) && CONFIG_RF_GPIO_DIAGNOSTICS
#include "driver/gpio.h"
#include "soc/soc_caps.h"
#endif

extern "C" void app_main() {
#if defined(CONFIG_RF_GPIO_DIAGNOSTICS) && CONFIG_RF_GPIO_DIAGNOSTICS
    // Inspect current configuration only. Never reset/reconfigure/drive a GPIO.
    gpio_dump_io_configuration(stdout, SOC_GPIO_VALID_GPIO_MASK);
#endif
    rf_web::start_async();

    // Static storage: keep the ~8 KB sample array off app_main's task stack.
    static rf::SimulatedReceiver receiver;
    static rf::Scanner scanner(receiver);
    const rf::Plan plan;
    std::uint32_t sweep = 0;
    std::size_t emitted = 0;

    for (;;) {
        const auto now = static_cast<std::uint64_t>(esp_timer_get_time() / 1000);
        if (scanner.state() == rf::State::idle || scanner.state() == rf::State::complete) {
            emitted = 0;
            if (scanner.start(plan, now) != rf::Error::ok) return;
            ++sweep;
        }
        if (scanner.tick(now) != rf::Error::ok) {
            std::puts("{\"version\":1,\"type\":\"error\",\"code\":\"scan_failed\"}");
            scanner.stop();
            return;
        }
        if (scanner.size() > emitted) {
            char line[256];
            if (rf::format_sample(line, sizeof(line), scanner.samples()[emitted], sweep, emitted, rf::bin_count(plan)))
                std::puts(line);
            ++emitted;

            if (scanner.state() == rf::State::complete && emitted == scanner.size())
                rf_web::publish(scanner.samples().data(), scanner.size(), sweep);
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

