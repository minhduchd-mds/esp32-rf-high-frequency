#include "device_web_server.hpp"
#include "device_web_ui.hpp"
#include "sdkconfig.h"

#if defined(CONFIG_RF_DEVICE_WEB_HTTPS) && CONFIG_RF_DEVICE_WEB_HTTPS && defined(CONFIG_IDF_TARGET_ESP32S3)

#include "esp_event.h"
#include "esp_https_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>

namespace rf_web {
namespace {
constexpr EventBits_t kConnected = BIT0;
constexpr char kTag[] = "rf_https";

struct Snapshot {
    std::array<rf::Sample, rf::max_bins> samples{};
    std::size_t count{};
    std::uint32_t sweep{};
};

SemaphoreHandle_t g_mutex = nullptr;
EventGroupHandle_t g_wifi_events = nullptr;
Snapshot g_snapshot{};
char g_ip[16] = "0.0.0.0";

bool copy_snapshot(Snapshot& out) {
    if (g_mutex == nullptr || xSemaphoreTake(g_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return false;
    out = g_snapshot;
    xSemaphoreGive(g_mutex);
    return true;
}

void set_security_headers(httpd_req_t* req) {
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_hdr(req, "X-Content-Type-Options", "nosniff");
    httpd_resp_set_hdr(req, "Referrer-Policy", "no-referrer");
    httpd_resp_set_hdr(req, "Content-Security-Policy",
        "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'");
}

esp_err_t root_handler(httpd_req_t* req) {
    set_security_headers(req);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, kDeviceHtml, HTTPD_RESP_USE_STRLEN);
}

esp_err_t status_handler(httpd_req_t* req) {
    Snapshot snap;
    copy_snapshot(snap);
    wifi_ap_record_t ap{};
    const int rssi = esp_wifi_sta_get_ap_info(&ap) == ESP_OK ? ap.rssi : -127;
    char body[384];
    const auto uptime = static_cast<unsigned long long>(esp_timer_get_time() / 1000);
    const int n = std::snprintf(body, sizeof(body),
        "{\"target\":\"esp32s3\",\"mode\":\"receive-only\",\"https_port\":%d,"
        "\"ip\":\"%s\",\"wifi_rssi\":%d,\"free_heap\":%u,\"uptime_ms\":%llu,"
        "\"sweep\":%u,\"bins\":%u}",
        CONFIG_RF_DEVICE_WEB_HTTPS_PORT, g_ip, rssi, static_cast<unsigned>(esp_get_free_heap_size()),
        uptime, static_cast<unsigned>(snap.sweep), static_cast<unsigned>(snap.count));
    if (n <= 0 || static_cast<std::size_t>(n) >= sizeof(body)) return ESP_FAIL;
    set_security_headers(req);
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, body, n);
}

esp_err_t spectrum_handler(httpd_req_t* req) {
    Snapshot snap;
    if (!copy_snapshot(snap)) {
        httpd_resp_set_status(req, "503 Service Unavailable");
        return httpd_resp_sendstr(req, "{\"error\":\"snapshot_busy\"}");
    }
    set_security_headers(req);
    httpd_resp_set_type(req, "application/json");
    char chunk[128];
    int n = std::snprintf(chunk, sizeof(chunk), "{\"sweep\":%u,\"source\":\"simulation\",\"samples\":[",
        static_cast<unsigned>(snap.sweep));
    if (n <= 0 || httpd_resp_send_chunk(req, chunk, n) != ESP_OK) return ESP_FAIL;
    for (std::size_t i = 0; i < snap.count; ++i) {
        n = std::snprintf(chunk, sizeof(chunk), "%s[%u,%.2f]",
            i == 0 ? "" : ",", static_cast<unsigned>(snap.samples[i].frequency_hz),
            static_cast<double>(snap.samples[i].rssi_dbm));
        if (n <= 0 || static_cast<std::size_t>(n) >= sizeof(chunk) ||
            httpd_resp_send_chunk(req, chunk, n) != ESP_OK) return ESP_FAIL;
    }
    if (httpd_resp_send_chunk(req, "]}", 2) != ESP_OK) return ESP_FAIL;
    return httpd_resp_send_chunk(req, nullptr, 0);
}

void wifi_event(void*, esp_event_base_t base, std::int32_t id, void* data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(g_wifi_events, kConnected);
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const auto* event = static_cast<ip_event_got_ip_t*>(data);
        std::snprintf(g_ip, sizeof(g_ip), IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(g_wifi_events, kConnected);
        ESP_LOGI(kTag, "Device console: https://%s:%d/", g_ip, CONFIG_RF_DEVICE_WEB_HTTPS_PORT);
    }
}

bool init_wifi() {
    if (std::strlen(CONFIG_RF_DEVICE_WEB_WIFI_SSID) == 0) {
        ESP_LOGW(kTag, "HTTPS UI compiled but Wi-Fi SSID is empty. Set it in idf.py menuconfig.");
        return false;
    }
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        if (nvs_flash_erase() != ESP_OK) return false;
        err = nvs_flash_init();
    }
    if (err != ESP_OK || esp_netif_init() != ESP_OK) return false;
    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) return false;
    if (esp_netif_create_default_wifi_sta() == nullptr) return false;
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    if (esp_wifi_init(&cfg) != ESP_OK) return false;
    g_wifi_events = xEventGroupCreate();
    if (g_wifi_events == nullptr) return false;
    if (esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event, nullptr) != ESP_OK ||
        esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event, nullptr) != ESP_OK) return false;

    wifi_config_t wifi{};
    std::strncpy(reinterpret_cast<char*>(wifi.sta.ssid), CONFIG_RF_DEVICE_WEB_WIFI_SSID, sizeof(wifi.sta.ssid) - 1);
    std::strncpy(reinterpret_cast<char*>(wifi.sta.password), CONFIG_RF_DEVICE_WEB_WIFI_PASSWORD, sizeof(wifi.sta.password) - 1);
    wifi.sta.threshold.authmode = std::strlen(CONFIG_RF_DEVICE_WEB_WIFI_PASSWORD) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    wifi.sta.pmf_cfg.capable = true;
    wifi.sta.pmf_cfg.required = false;
    return esp_wifi_set_mode(WIFI_MODE_STA) == ESP_OK &&
           esp_wifi_set_config(WIFI_IF_STA, &wifi) == ESP_OK &&
           esp_wifi_start() == ESP_OK;
}

#if RF_WEB_CERT_EMBEDDED
extern const unsigned char server_crt_start[] asm("_binary_server_crt_start");
extern const unsigned char server_crt_end[] asm("_binary_server_crt_end");
extern const unsigned char server_key_start[] asm("_binary_server_key_start");
extern const unsigned char server_key_end[] asm("_binary_server_key_end");
#endif

httpd_handle_t start_https() {
#if !RF_WEB_CERT_EMBEDDED
    ESP_LOGE(kTag, "HTTPS certificate/key missing. See firmware/main/certs/README.md.");
    return nullptr;
#else
    httpd_ssl_config_t config = HTTPD_SSL_CONFIG_DEFAULT();
    config.port_secure = CONFIG_RF_DEVICE_WEB_HTTPS_PORT;
    config.httpd.max_uri_handlers = 4;
    config.httpd.stack_size = 12288;
    config.servercert = server_crt_start;
    config.servercert_len = server_crt_end - server_crt_start;
    config.prvtkey_pem = server_key_start;
    config.prvtkey_len = server_key_end - server_key_start;

    httpd_handle_t server = nullptr;
    if (httpd_ssl_start(&server, &config) != ESP_OK) {
        ESP_LOGE(kTag, "Failed to start HTTPS server.");
        return nullptr;
    }
    httpd_uri_t root{};
    root.uri = "/";
    root.method = HTTP_GET;
    root.handler = root_handler;
    httpd_uri_t status{};
    status.uri = "/api/status";
    status.method = HTTP_GET;
    status.handler = status_handler;
    httpd_uri_t spectrum{};
    spectrum.uri = "/api/spectrum";
    spectrum.method = HTTP_GET;
    spectrum.handler = spectrum_handler;
    if (httpd_register_uri_handler(server, &root) != ESP_OK ||
        httpd_register_uri_handler(server, &status) != ESP_OK ||
        httpd_register_uri_handler(server, &spectrum) != ESP_OK) {
        httpd_ssl_stop(server);
        return nullptr;
    }
    ESP_LOGI(kTag, "HTTPS device console started on port %d.", CONFIG_RF_DEVICE_WEB_HTTPS_PORT);
    return server;
#endif
}

void web_task(void*) {
    if (!init_wifi()) {
        ESP_LOGW(kTag, "Device HTTPS console is offline; RF scanner continues.");
        vTaskDelete(nullptr);
        return;
    }
    xEventGroupWaitBits(g_wifi_events, kConnected, pdFALSE, pdTRUE, portMAX_DELAY);
    static httpd_handle_t server = start_https();
    (void)server;
    vTaskDelete(nullptr);
}
} // namespace

void publish(const rf::Sample* samples, std::size_t count, std::uint32_t sweep) {
    if (samples == nullptr || g_mutex == nullptr) return;
    count = std::min(count, rf::max_bins);
    if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(20)) != pdTRUE) return;
    std::copy_n(samples, count, g_snapshot.samples.begin());
    g_snapshot.count = count;
    g_snapshot.sweep = sweep;
    xSemaphoreGive(g_mutex);
}

void start_async() {
    if (g_mutex == nullptr) g_mutex = xSemaphoreCreateMutex();
    if (g_mutex == nullptr) {
        ESP_LOGE(kTag, "Cannot allocate snapshot mutex.");
        return;
    }
    if (xTaskCreate(web_task, "rf_https", 6144, nullptr, 4, nullptr) != pdPASS)
        ESP_LOGE(kTag, "Cannot start HTTPS task.");
}
} // namespace rf_web

#else

namespace rf_web {
void publish(const rf::Sample*, std::size_t, std::uint32_t) {}
void start_async() {}
}

#endif
