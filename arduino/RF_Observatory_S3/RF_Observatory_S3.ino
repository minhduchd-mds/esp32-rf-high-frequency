/*
  RF Observatory S3 - Arduino Passive Signal Observatory
  Target: ESP32-S3
  Arduino-ESP32: 3.3.12
  HTTP: port 80
  Default AP: RF-Observatory-S3 / observe1234
  Dashboard: http://192.168.4.1/

  Measurement path:
      passive coil / tuned LC / sensor
                |
        envelope / detector stage
                |
            GPIO4 ADC1

  This firmware measures ADC-domain field/envelope behavior:
  level, baseline, relative margin, peak hold, temporal spectrum,
  events, periodicity and a generic pattern fingerprint.

  It does not claim to recover RF carrier frequency from an envelope-only input.
*/

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <math.h>

static constexpr uint8_t RF_ADC_PIN = 4;
static constexpr uint32_t SERIAL_BAUD = 115200;

static constexpr char AP_SSID[] = "RF-Observatory-S3";
static constexpr char AP_PASSWORD[] = "observe1234";

static constexpr char WIFI_SSID[] = "";
static constexpr char WIFI_PASSWORD[] = "";

static constexpr uint16_t SAMPLE_COUNT = 256;
static constexpr uint32_t SAMPLE_PERIOD_US = 100;
static constexpr uint8_t SPECTRUM_BINS = 32;
static constexpr uint16_t HISTORY_SIZE = 180;
static constexpr uint8_t EVENT_LOG_SIZE = 20;
static constexpr uint32_t ACQUIRE_INTERVAL_MS = 100;

WebServer server(80);

struct SignalSnapshot {
  uint32_t sequence = 0;
  uint32_t timestampMs = 0;
  float meanRaw = 0;
  float milliVolts = 0;
  float rmsRaw = 0;
  float peakToPeakRaw = 0;
  float baselineRaw = 0;
  float noiseRaw = 1;
  float relativeDb = 0;
  float peakHoldDb = 0;
  float sampleRateHz = 0;
  float dominantEnvelopeHz = 0;
  float spectralConcentration = 0;
  bool eventActive = false;
  uint32_t totalEvents = 0;
  uint32_t fingerprint = 0;
  char signalClass[28] = "learning";
};

struct EventRecord {
  uint32_t id = 0;
  uint32_t startedMs = 0;
  uint32_t durationMs = 0;
  float peakDb = 0;
  float dominantHz = 0;
  uint32_t fingerprint = 0;
  char signalClass[28] = "";
};

SignalSnapshot current;
uint16_t adcSamples[SAMPLE_COUNT];
float centered[SAMPLE_COUNT];
float spectrumHz[SPECTRUM_BINS];
float spectrumMag[SPECTRUM_BINS];

float historyDb[HISTORY_SIZE] = {};
float historyMv[HISTORY_SIZE] = {};
uint8_t historyEvent[HISTORY_SIZE] = {};
uint16_t historyHead = 0;
uint16_t historyCount = 0;

EventRecord eventLog[EVENT_LOG_SIZE];
uint8_t eventHead = 0;
uint8_t eventCount = 0;

bool baselineReady = false;
uint16_t learningWindows = 0;
float baselineRaw = 0;
float noiseRaw = 1;
float peakHoldDb = 0;
bool eventOpen = false;
uint32_t eventStartMs = 0;
float eventPeakDb = 0;
uint32_t eventId = 0;
uint8_t quietWindows = 0;

uint32_t lastAcquireMs = 0;

static uint32_t fnv1aMix(uint32_t hash, uint32_t value) {
  for (uint8_t i = 0; i < 4; ++i) {
    hash ^= (value >> (i * 8)) & 0xFFU;
    hash *= 16777619U;
  }
  return hash;
}

static uint32_t makeFingerprint(float relDb, float p2p, float domHz, float concentration, bool eventFlag) {
  uint32_t h = 2166136261U;
  h = fnv1aMix(h, (uint32_t)lroundf(fmaxf(0.0f, relDb) * 10.0f));
  h = fnv1aMix(h, (uint32_t)lroundf(fminf(4095.0f, p2p)));
  h = fnv1aMix(h, (uint32_t)lroundf(fminf(20000.0f, domHz)));
  h = fnv1aMix(h, (uint32_t)lroundf(fmaxf(0.0f, concentration) * 1000.0f));
  h = fnv1aMix(h, eventFlag ? 1U : 0U);
  return h;
}

static void addHistory(float db, float mv, bool eventFlag) {
  historyDb[historyHead] = db;
  historyMv[historyHead] = mv;
  historyEvent[historyHead] = eventFlag ? 1 : 0;
  historyHead = (historyHead + 1) % HISTORY_SIZE;
  if (historyCount < HISTORY_SIZE) ++historyCount;
}

static void addEvent(uint32_t startedMs, uint32_t durationMs, float peakDbValue,
                     float dominantHz, uint32_t fingerprint, const char* klass) {
  EventRecord &e = eventLog[eventHead];
  e.id = ++eventId;
  e.startedMs = startedMs;
  e.durationMs = durationMs;
  e.peakDb = peakDbValue;
  e.dominantHz = dominantHz;
  e.fingerprint = fingerprint;
  strncpy(e.signalClass, klass, sizeof(e.signalClass) - 1);
  e.signalClass[sizeof(e.signalClass) - 1] = '\0';

  eventHead = (eventHead + 1) % EVENT_LOG_SIZE;
  if (eventCount < EVENT_LOG_SIZE) ++eventCount;
}

static void classifySignal(float relativeDb, float rms, float p2p,
                           float dominantHz, float concentration,
                           bool eventFlag, char *out, size_t outSize) {
  const float variability = p2p / fmaxf(1.0f, current.meanRaw);

  if (!baselineReady) {
    strncpy(out, "learning", outSize);
  } else if (!eventFlag && relativeDb < 1.5f) {
    strncpy(out, "ambient", outSize);
  } else if (concentration > 0.32f && dominantHz > 15.0f) {
    strncpy(out, "periodic-envelope", outSize);
  } else if (eventFlag && (variability > 0.20f || p2p > noiseRaw * 8.0f)) {
    strncpy(out, "burst-pulsed-envelope", outSize);
  } else if (relativeDb > 3.0f && variability < 0.08f && rms < fmaxf(8.0f, noiseRaw * 3.0f)) {
    strncpy(out, "steady-elevated", outSize);
  } else {
    strncpy(out, "variable-envelope", outSize);
  }
  out[outSize - 1] = '\0';
}

static void computeEnvelopeSpectrum(float sampleRateHz) {
  float bestMag = 0;
  uint8_t bestBin = 0;
  float sumMag = 0;

  for (uint8_t b = 0; b < SPECTRUM_BINS; ++b) {
    const uint16_t k = b + 1;
    const float omega = 2.0f * PI * (float)k / (float)SAMPLE_COUNT;
    const float coeff = 2.0f * cosf(omega);
    float s0 = 0, s1 = 0, s2 = 0;

    for (uint16_t i = 0; i < SAMPLE_COUNT; ++i) {
      s0 = centered[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    float power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    float mag = sqrtf(fmaxf(0.0f, power)) / (float)SAMPLE_COUNT;
    spectrumMag[b] = mag;
    spectrumHz[b] = sampleRateHz * (float)k / (float)SAMPLE_COUNT;
    sumMag += mag;

    if (mag > bestMag) {
      bestMag = mag;
      bestBin = b;
    }
  }

  current.dominantEnvelopeHz = bestMag > 0.5f ? spectrumHz[bestBin] : 0;
  current.spectralConcentration = sumMag > 0.001f ? bestMag / sumMag : 0;
}

static void acquireWindow() {
  const uint32_t startUs = micros();
  uint16_t minRaw = 4095;
  uint16_t maxRaw = 0;
  uint64_t sum = 0;

  for (uint16_t i = 0; i < SAMPLE_COUNT; ++i) {
    const uint32_t due = startUs + (uint32_t)i * SAMPLE_PERIOD_US;
    while ((int32_t)(micros() - due) < 0) {
      delayMicroseconds(1);
    }

    const uint16_t v = analogRead(RF_ADC_PIN);
    adcSamples[i] = v;
    sum += v;
    if (v < minRaw) minRaw = v;
    if (v > maxRaw) maxRaw = v;
  }

  const uint32_t endUs = micros();
  const float elapsedSec = fmaxf(0.000001f, (float)(endUs - startUs) / 1000000.0f);
  current.sampleRateHz = (float)SAMPLE_COUNT / elapsedSec;
  current.meanRaw = (float)sum / (float)SAMPLE_COUNT;
  current.peakToPeakRaw = (float)(maxRaw - minRaw);

  float sq = 0;
  for (uint16_t i = 0; i < SAMPLE_COUNT; ++i) {
    centered[i] = (float)adcSamples[i] - current.meanRaw;
    sq += centered[i] * centered[i];
  }
  current.rmsRaw = sqrtf(sq / (float)SAMPLE_COUNT);
  current.milliVolts = (float)analogReadMilliVolts(RF_ADC_PIN);

  if (!baselineReady) {
    if (learningWindows == 0) {
      baselineRaw = current.meanRaw;
      noiseRaw = fmaxf(1.0f, current.rmsRaw);
    } else {
      baselineRaw = baselineRaw * 0.90f + current.meanRaw * 0.10f;
      noiseRaw = noiseRaw * 0.90f + fmaxf(1.0f, current.rmsRaw) * 0.10f;
    }
    if (++learningWindows >= 30) baselineReady = true;
  }

  const float threshold = baselineRaw + fmaxf(12.0f, noiseRaw * 4.0f);
  const bool eventNow = baselineReady &&
                        (current.meanRaw > threshold ||
                         current.peakToPeakRaw > fmaxf(30.0f, noiseRaw * 8.0f));

  if (!eventNow && baselineReady) {
    baselineRaw = baselineRaw * 0.995f + current.meanRaw * 0.005f;
    noiseRaw = noiseRaw * 0.98f + fmaxf(1.0f, current.rmsRaw) * 0.02f;
  }

  current.baselineRaw = baselineRaw;
  current.noiseRaw = noiseRaw;
  current.relativeDb = 20.0f * log10f((current.meanRaw + 1.0f) / (baselineRaw + 1.0f));
  if (!isfinite(current.relativeDb)) current.relativeDb = 0;

  peakHoldDb *= 0.995f;
  if (current.relativeDb > peakHoldDb) peakHoldDb = current.relativeDb;
  current.peakHoldDb = peakHoldDb;

  computeEnvelopeSpectrum(current.sampleRateHz);

  current.eventActive = eventNow;
  classifySignal(current.relativeDb, current.rmsRaw, current.peakToPeakRaw,
                 current.dominantEnvelopeHz, current.spectralConcentration,
                 eventNow, current.signalClass, sizeof(current.signalClass));

  current.fingerprint = makeFingerprint(
    current.relativeDb,
    current.peakToPeakRaw,
    current.dominantEnvelopeHz,
    current.spectralConcentration,
    eventNow
  );

  if (eventNow) {
    quietWindows = 0;
    if (!eventOpen) {
      eventOpen = true;
      eventStartMs = millis();
      eventPeakDb = current.relativeDb;
    } else if (current.relativeDb > eventPeakDb) {
      eventPeakDb = current.relativeDb;
    }
  } else if (eventOpen) {
    if (++quietWindows >= 3) {
      const uint32_t ended = millis();
      addEvent(eventStartMs, ended - eventStartMs, eventPeakDb,
               current.dominantEnvelopeHz, current.fingerprint, current.signalClass);
      eventOpen = false;
      quietWindows = 0;
      ++current.totalEvents;
    }
  }

  current.sequence++;
  current.timestampMs = millis();
  addHistory(current.relativeDb, current.milliVolts, eventNow);
}

static String hexFingerprint(uint32_t value) {
  char buf[12];
  snprintf(buf, sizeof(buf), "%08lX", (unsigned long)value);
  return String(buf);
}

static void addNoCache() {
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("X-Content-Type-Options", "nosniff");
}

static void handleStatus() {
  String json;
  json.reserve(420);
  json += "{\"device\":\"ESP32-S3\",\"mode\":\"passive-envelope-observatory\"";
  json += ",\"adc_pin\":" + String(RF_ADC_PIN);
  json += ",\"http_port\":80";
  json += ",\"ap_ssid\":\"" + String(AP_SSID) + "\"";
  json += ",\"ap_ip\":\"" + WiFi.softAPIP().toString() + "\"";
  json += ",\"sta_connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false");
  json += ",\"sta_ip\":\"" + (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("")) + "\"";
  json += ",\"wifi_rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);
  json += ",\"ap_clients\":" + String(WiFi.softAPgetStationNum());
  json += ",\"free_heap\":" + String(ESP.getFreeHeap());
  json += ",\"uptime_ms\":" + String(millis());
  json += ",\"baseline_ready\":" + String(baselineReady ? "true" : "false");
  json += ",\"self_rfi_note\":\"on-board Wi-Fi may couple into a broadband detector\"";
  json += "}";
  addNoCache();
  server.send(200, "application/json", json);
}

static void handleLive() {
  String json;
  json.reserve(700);
  json += "{\"sequence\":" + String(current.sequence);
  json += ",\"timestamp_ms\":" + String(current.timestampMs);
  json += ",\"mean_raw\":" + String(current.meanRaw, 2);
  json += ",\"millivolts\":" + String(current.milliVolts, 1);
  json += ",\"rms_raw\":" + String(current.rmsRaw, 2);
  json += ",\"peak_to_peak_raw\":" + String(current.peakToPeakRaw, 1);
  json += ",\"baseline_raw\":" + String(current.baselineRaw, 2);
  json += ",\"noise_raw\":" + String(current.noiseRaw, 2);
  json += ",\"relative_db\":" + String(current.relativeDb, 2);
  json += ",\"peak_hold_db\":" + String(current.peakHoldDb, 2);
  json += ",\"sample_rate_hz\":" + String(current.sampleRateHz, 1);
  json += ",\"dominant_envelope_hz\":" + String(current.dominantEnvelopeHz, 1);
  json += ",\"spectral_concentration\":" + String(current.spectralConcentration, 4);
  json += ",\"event_active\":" + String(current.eventActive ? "true" : "false");
  json += ",\"total_events\":" + String(current.totalEvents);
  json += ",\"signal_class\":\"" + String(current.signalClass) + "\"";
  json += ",\"fingerprint\":\"" + hexFingerprint(current.fingerprint) + "\"";
  json += ",\"carrier_frequency_known\":false";
  json += ",\"identity_known\":false";
  json += "}";
  addNoCache();
  server.send(200, "application/json", json);
}

static void handleHistory() {
  String json;
  json.reserve(6200);
  json += "{\"db\":[";
  for (uint16_t i = 0; i < historyCount; ++i) {
    uint16_t idx = (historyHead + HISTORY_SIZE - historyCount + i) % HISTORY_SIZE;
    if (i) json += ',';
    json += String(historyDb[idx], 2);
  }
  json += "],\"mv\":[";
  for (uint16_t i = 0; i < historyCount; ++i) {
    uint16_t idx = (historyHead + HISTORY_SIZE - historyCount + i) % HISTORY_SIZE;
    if (i) json += ',';
    json += String(historyMv[idx], 1);
  }
  json += "],\"event\":[";
  for (uint16_t i = 0; i < historyCount; ++i) {
    uint16_t idx = (historyHead + HISTORY_SIZE - historyCount + i) % HISTORY_SIZE;
    if (i) json += ',';
    json += historyEvent[idx] ? '1' : '0';
  }
  json += "]}";
  addNoCache();
  server.send(200, "application/json", json);
}

static void handleSpectrum() {
  String json;
  json.reserve(1700);
  json += "{\"domain\":\"envelope\",\"carrier_frequency_known\":false,\"bins\":[";
  for (uint8_t i = 0; i < SPECTRUM_BINS; ++i) {
    if (i) json += ',';
    json += '[';
    json += String(spectrumHz[i], 1);
    json += ',';
    json += String(spectrumMag[i], 3);
    json += ']';
  }
  json += "]}";
  addNoCache();
  server.send(200, "application/json", json);
}

static void handleEvents() {
  String json;
  json.reserve(3800);
  json += "{\"events\":[";
  for (uint8_t i = 0; i < eventCount; ++i) {
    const uint8_t idx = (eventHead + EVENT_LOG_SIZE - 1 - i) % EVENT_LOG_SIZE;
    const EventRecord &e = eventLog[idx];
    if (i) json += ',';
    json += "{\"id\":" + String(e.id);
    json += ",\"started_ms\":" + String(e.startedMs);
    json += ",\"duration_ms\":" + String(e.durationMs);
    json += ",\"peak_db\":" + String(e.peakDb, 2);
    json += ",\"dominant_envelope_hz\":" + String(e.dominantHz, 1);
    json += ",\"class\":\"" + String(e.signalClass) + "\"";
    json += ",\"fingerprint\":\"" + hexFingerprint(e.fingerprint) + "\"}";
  }
  json += "]}";
  addNoCache();
  server.send(200, "application/json", json);
}

static const char INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>RF Observatory S3</title>
<style>
:root{color-scheme:dark;--bg:#07090d;--panel:#10141c;--line:#212937;--text:#f4f7fb;--muted:#8e9aab;--accent:#65d1ff;--hot:#ff7d66}*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--text)}header{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#07090df2;backdrop-filter:blur(16px);z-index:5}.brand{font-weight:800}.brand small{display:block;color:var(--muted);font-weight:500;font-size:11px}.status{display:flex;gap:8px;align-items:center}.dot{width:8px;height:8px;border-radius:99px;background:#5ee38d;box-shadow:0 0 16px #5ee38d}.layout{display:grid;grid-template-columns:210px 1fr;min-height:calc(100vh - 64px)}nav{border-right:1px solid var(--line);padding:16px 10px;position:sticky;top:64px;height:calc(100vh - 64px)}nav button{width:100%;border:0;background:transparent;color:var(--muted);padding:12px;border-radius:10px;text-align:left;cursor:pointer;margin:2px 0}nav button.active,nav button:hover{background:#151b25;color:var(--text)}main{padding:18px;max-width:1500px;width:100%;margin:auto}.page{display:none}.page.active{display:block}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:0 0 12px}.sub{color:var(--muted);margin:0 0 18px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;min-width:0}.metric{font-size:26px;font-weight:750;letter-spacing:-.6px}.label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.wide{grid-column:span 2}.full{grid-column:1/-1}canvas{width:100%;height:240px;display:block}.badge{display:inline-flex;padding:5px 8px;border-radius:99px;background:#17202d;color:#bdeaff;font-size:12px}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid var(--line);text-align:left;font-variant-numeric:tabular-nums}th{color:var(--muted);font-size:11px}.map{display:grid;grid-template-columns:repeat(12,1fr);gap:5px}.cell{aspect-ratio:1;border:1px solid var(--line);background:#111722;border-radius:5px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:9px;color:#dce7f4}.actions{display:flex;gap:8px;flex-wrap:wrap}.action{border:1px solid var(--line);background:#151b25;color:var(--text);padding:9px 12px;border-radius:9px;cursor:pointer}.kv{display:grid;grid-template-columns:180px 1fr;gap:7px 16px}.kv div:nth-child(odd){color:var(--muted)}.note{border-left:3px solid #4f88a6;padding:10px 12px;background:#0c1219;color:#adbac8;border-radius:0 8px 8px 0}@media(max-width:900px){.layout{grid-template-columns:1fr}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);display:flex;overflow:auto;padding:8px}nav button{white-space:nowrap;width:auto}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wide{grid-column:span 2}}@media(max-width:520px){header{padding:0 12px}.grid{grid-template-columns:1fr}.wide,.full{grid-column:1}.metric{font-size:22px}.map{grid-template-columns:repeat(8,1fr)}main{padding:12px}}
</style></head><body>
<header><div class="brand">RF Observatory S3<small>Passive Signal Observatory · HTTP :80</small></div><div class="status"><span class="dot"></span><span id="conn">Connecting</span></div></header>
<div class="layout"><nav><button class="active" data-page="overview">Overview</button><button data-page="live">Live Signal</button><button data-page="spectrum">Envelope Spectrum</button><button data-page="events">Events</button><button data-page="map">Field Survey Map</button><button data-page="device">Device</button></nav><main>
<section id="overview" class="page active"><h1>Overview</h1><p class="sub">Tổng quan năng lượng và hành vi envelope đo tại ADC.</p><div class="grid"><div class="card"><div class="label">Relative level</div><div class="metric" id="rel">-- dB</div></div><div class="card"><div class="label">Detector voltage</div><div class="metric" id="mv">-- mV</div></div><div class="card"><div class="label">Peak hold</div><div class="metric" id="peak">-- dB</div></div><div class="card"><div class="label">Events</div><div class="metric" id="eventCount">--</div></div><div class="card wide"><div class="label">Observed pattern</div><div class="metric" id="klass">learning</div><div class="badge" id="finger">FP --------</div></div><div class="card wide"><div class="label">Dominant envelope</div><div class="metric" id="dom">-- Hz</div><div class="sub">Tần số biến thiên envelope/baseband, không phải RF carrier.</div></div><div class="card full"><h2>History</h2><canvas id="historyChart" width="1000" height="260"></canvas></div></div></section>
<section id="live" class="page"><h1>Live Signal</h1><p class="sub">Các đại lượng thô và xử lý tại cửa sổ acquisition hiện tại.</p><div class="grid"><div class="card"><div class="label">ADC mean</div><div class="metric" id="rawMean">--</div></div><div class="card"><div class="label">ADC RMS AC</div><div class="metric" id="rms">--</div></div><div class="card"><div class="label">Peak-to-peak</div><div class="metric" id="p2p">--</div></div><div class="card"><div class="label">Sample rate</div><div class="metric" id="fs">--</div></div><div class="card"><div class="label">Baseline</div><div class="metric" id="baseline">--</div></div><div class="card"><div class="label">Noise</div><div class="metric" id="noise">--</div></div><div class="card"><div class="label">Event state</div><div class="metric" id="eventState">--</div></div><div class="card"><div class="label">Concentration</div><div class="metric" id="conc">--</div></div><div class="card full note">Classification mô tả hình thái tín hiệu ở miền envelope. Một detector đơn kênh không đủ dữ liệu để xác định chính xác carrier hoặc danh tính nguồn phát.</div></div></section>
<section id="spectrum" class="page"><h1>Envelope Spectrum</h1><p class="sub">Phổ của biến thiên tín hiệu sau detector. Trục Hz là baseband/envelope.</p><div class="card"><canvas id="spectrumChart" width="1000" height="350"></canvas></div></section>
<section id="events" class="page"><h1>Events</h1><p class="sub">Các đợt tín hiệu vượt baseline được phát hiện tự động.</p><div class="card"><table><thead><tr><th>ID</th><th>Start</th><th>Duration</th><th>Peak</th><th>Envelope Hz</th><th>Class</th><th>Fingerprint</th></tr></thead><tbody id="eventRows"></tbody></table></div></section>
<section id="map" class="page"><h1>Field Survey Map</h1><p class="sub">Di chuyển cảm biến trong khu vực rồi click từng ô để ghi mức đo hiện tại. Đây là survey tương đối, không tự suy ra vị trí nguồn.</p><div class="actions"><button class="action" id="clearMap">Clear map</button><span class="badge">Click cell = capture current dB</span></div><div style="height:12px"></div><div class="card"><div id="fieldMap" class="map"></div></div></section>
<section id="device" class="page"><h1>Device</h1><p class="sub">ESP32-S3 runtime và kết nối.</p><div class="card"><div class="kv" id="deviceKv"></div></div></section>
</main></div>
<script>
const $=id=>document.getElementById(id);let live=null,hist={db:[],mv:[],event:[]},spec={bins:[]};let survey=JSON.parse(localStorage.getItem('rfSurvey')||'{}');
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===b.dataset.page))});
function n(v,d=1){return Number.isFinite(+v)?(+v).toFixed(d):'--'}async function json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(r.status);return r.json()}
function drawLine(canvas,values,events=[]){const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);c.strokeStyle='#253041';c.lineWidth=1;for(let i=1;i<5;i++){let y=h*i/5;c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}if(!values.length)return;let min=Math.min(...values,-1),max=Math.max(...values,5);if(max-min<1)max=min+1;c.beginPath();values.forEach((v,i)=>{let x=i*w/Math.max(1,values.length-1),y=h-(v-min)/(max-min)*h;i?c.lineTo(x,y):c.moveTo(x,y)});c.strokeStyle='#65d1ff';c.lineWidth=2;c.stroke();events.forEach((e,i)=>{if(!e)return;let x=i*w/Math.max(1,events.length-1);c.fillStyle='#ff7d66';c.fillRect(x,0,2,h)});c.fillStyle='#8e9aab';c.font='12px system-ui';c.fillText(max.toFixed(1)+' dB',8,16);c.fillText(min.toFixed(1)+' dB',8,h-8)}
function drawBars(canvas,bins){const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);if(!bins.length)return;const max=Math.max(...bins.map(x=>x[1]),1),bw=w/bins.length;bins.forEach((x,i)=>{let bh=(x[1]/max)*(h-35);c.fillStyle='#65d1ff';c.fillRect(i*bw+1,h-bh-22,Math.max(1,bw-2),bh)});c.fillStyle='#8e9aab';c.font='12px system-ui';c.fillText('0 Hz',4,h-5);c.fillText(Math.round(bins.at(-1)[0])+' Hz envelope',w-120,h-5)}
function renderLive(){if(!live)return;$('rel').textContent=n(live.relative_db,2)+' dB';$('mv').textContent=n(live.millivolts,0)+' mV';$('peak').textContent=n(live.peak_hold_db,2)+' dB';$('eventCount').textContent=live.total_events;$('klass').textContent=live.signal_class;$('finger').textContent='FP '+live.fingerprint;$('dom').textContent=n(live.dominant_envelope_hz,1)+' Hz';$('rawMean').textContent=n(live.mean_raw,1);$('rms').textContent=n(live.rms_raw,1);$('p2p').textContent=n(live.peak_to_peak_raw,0);$('fs').textContent=n(live.sample_rate_hz/1000,2)+' kHz';$('baseline').textContent=n(live.baseline_raw,1);$('noise').textContent=n(live.noise_raw,1);$('eventState').textContent=live.event_active?'ACTIVE':'quiet';$('conc').textContent=n(live.spectral_concentration*100,1)+'%'}
async function tick(){try{live=await json('/api/live');renderLive();$('conn').textContent='Live'}catch(e){$('conn').textContent='Offline'}}async function refreshHistory(){try{hist=await json('/api/history');drawLine($('historyChart'),hist.db,hist.event)}catch(e){}}async function refreshSpectrum(){try{spec=await json('/api/spectrum');drawBars($('spectrumChart'),spec.bins)}catch(e){}}
async function refreshEvents(){try{const d=await json('/api/events');$('eventRows').innerHTML=d.events.map(e=>`<tr><td>${e.id}</td><td>${(e.started_ms/1000).toFixed(1)}s</td><td>${e.duration_ms}ms</td><td>${e.peak_db.toFixed(2)} dB</td><td>${e.dominant_envelope_hz.toFixed(1)}</td><td>${e.class}</td><td>${e.fingerprint}</td></tr>`).join('')||'<tr><td colspan="7">No events yet</td></tr>'}catch(e){}}async function refreshStatus(){try{const d=await json('/api/status');$('deviceKv').innerHTML=Object.entries(d).map(([k,v])=>`<div>${k}</div><div>${String(v)}</div>`).join('')}catch(e){}}
function renderMap(){const m=$('fieldMap');m.innerHTML='';for(let i=0;i<96;i++){const d=document.createElement('div');d.className='cell';d.dataset.i=i;if(survey[i]!=null){const v=+survey[i],p=Math.max(0,Math.min(1,(v+2)/14));d.style.background=`hsl(${210-p*190} 75% ${22+p*28}%)`;d.textContent=v.toFixed(1)}d.onclick=()=>{if(!live)return;survey[i]=live.relative_db;localStorage.setItem('rfSurvey',JSON.stringify(survey));renderMap()};m.appendChild(d)}}$('clearMap').onclick=()=>{survey={};localStorage.removeItem('rfSurvey');renderMap()};renderMap();tick();refreshHistory();refreshSpectrum();refreshEvents();refreshStatus();setInterval(tick,500);setInterval(refreshHistory,1500);setInterval(refreshSpectrum,1200);setInterval(refreshEvents,2000);setInterval(refreshStatus,5000);
</script></body></html>
)HTML";

static void handleRoot() {
  addNoCache();
  server.send_P(200, "text/html; charset=utf-8", INDEX_HTML);
}

static void startNetwork() {
  WiFi.mode(strlen(WIFI_SSID) ? WIFI_AP_STA : WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.printf("AP: %s\n", AP_SSID);
  Serial.printf("Dashboard: http://%s/\n", WiFi.softAPIP().toString().c_str());

  if (strlen(WIFI_SSID)) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    const uint32_t deadline = millis() + 10000;
    while (WiFi.status() != WL_CONNECTED && (int32_t)(millis() - deadline) < 0) delay(100);
    if (WiFi.status() == WL_CONNECTED) Serial.printf("STA: http://%s/\n", WiFi.localIP().toString().c_str());
  }

  if (MDNS.begin("rf-observatory")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("mDNS: http://rf-observatory.local/");
  }
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(300);
  analogReadResolution(12);
  analogSetPinAttenuation(RF_ADC_PIN, ADC_11db);
  pinMode(RF_ADC_PIN, INPUT);

  startNetwork();

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/live", HTTP_GET, handleLive);
  server.on("/api/history", HTTP_GET, handleHistory);
  server.on("/api/spectrum", HTTP_GET, handleSpectrum);
  server.on("/api/events", HTTP_GET, handleEvents);
  server.onNotFound([]() { addNoCache(); server.send(404, "application/json", "{\"error\":\"not_found\"}"); });
  server.begin();

  Serial.println("RF Observatory S3 ready.");
  Serial.println("Learning baseline for ~3 seconds...");
}

void loop() {
  server.handleClient();

  if (millis() - lastAcquireMs >= ACQUIRE_INTERVAL_MS) {
    lastAcquireMs = millis();
    acquireWindow();

    Serial.printf(
      "{\"seq\":%lu,\"mv\":%.1f,\"relative_db\":%.2f,\"class\":\"%s\",\"event\":%s,\"env_hz\":%.1f,\"fp\":\"%08lX\"}\n",
      (unsigned long)current.sequence,
      current.milliVolts,
      current.relativeDb,
      current.signalClass,
      current.eventActive ? "true" : "false",
      current.dominantEnvelopeHz,
      (unsigned long)current.fingerprint
    );
  }

  delay(1);
}
