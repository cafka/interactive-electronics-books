/*
  Chapter 2: Smart plant watering
  Board:    ESP32-DevKitC with an ESP32-WROOM-32E (Arduino core for ESP32)

  A capacitive soil moisture sensor tells the ESP32 how wet the soil is. When the
  soil is dry the program runs a small pump in short pulses, waits for the water
  to soak in, and measures again. Any fault switches the pump off and locks it
  off until a person presses the button.

  Wiring (GPIO numbers, not header positions):
    3V3 pin ---------- sensor VCC          (the sensor is powered from 3.3 V)
    GND -------------- sensor GND
    GPIO34 ----------- sensor AOUT         (ADC1 channel, input only)
               100 kohm from GPIO34 to GND (a disconnected wire then reads about 0)
    GPIO25 --- 100 ohm --- gate of a logic-level N-MOSFET (for example IRLZ44N)
               10 kohm from gate to GND    (pump stays off while the ESP32 starts)
               source to GND, drain to the pump "-"
               pump "+" to the 5V pin of the board (USB 5 V)
               1N5819 diode across the pump: cathode (band) to 5V, anode to drain
               470 uF capacitor between 5V and GND
    GPIO26 --- 330 ohm --- LED anode (+), LED cathode (-) to GND
    GPIO27 --- push button --- GND         (INPUT_PULLUP: pressed = LOW)

  The program never blocks: there is no delay(). Every pass of loop() reads the
  clock and decides what to do, so a fault is noticed within one pass.
*/

#include <Preferences.h>

// ---- Pins (ESP32 GPIO numbers) ----
const uint8_t SENSOR_PIN = 34;   // analog input (ADC1)
const uint8_t PUMP_PIN   = 25;   // output to the MOSFET gate
const uint8_t LED_PIN    = 26;   // output to the LED
const uint8_t BUTTON_PIN = 27;   // input with the internal pull-up

// ---- Calibration: raw ADC readings (0..4095). Measure these on YOUR sensor (see the chapter). ----
const uint16_t RAW_DRY = 2800;        // sensor in dry air: the highest reading you will use
const uint16_t RAW_WET = 1300;        // sensor in water up to the line: the lowest reading you will use
const uint16_t RAW_VALID_MIN = 200;   // a reading below this is not a working sensor (cable off, short to GND)
const uint16_t RAW_VALID_MAX = 3900;  // a reading above this is not a working sensor (short to 3.3 V)

// ---- Thresholds in percent of moisture (0 = RAW_DRY, 100 = RAW_WET) ----
const uint8_t DRY_ON_PERCENT   = 35;  // below this the soil is dry: start watering
const uint8_t WET_OFF_PERCENT  = 60;  // at or above this the soil is wet enough: stop
const uint8_t MIN_RISE_PERCENT = 2;   // after a pulse the soil must gain at least this much

// ---- Timings in milliseconds ----
const uint32_t SAMPLE_MS          = 100UL;     // one sensor reading every 100 ms
const uint32_t PULSE_MS           = 3000UL;    // pump on for 3 s per pulse
const uint32_t SOAK_MS            = 60000UL;   // wait 60 s for the water to reach the sensor
const uint32_t MAX_WATER_TOTAL_MS = 24000UL;   // most pump time allowed in one watering episode
const uint32_t SENSOR_FAULT_MS    = 2000UL;    // invalid readings for this long = sensor fault
const uint32_t DEBOUNCE_MS        = 30UL;      // a button level must hold this long
const uint32_t REPORT_MS          = 2000UL;    // status line on the Serial Monitor

// ---- Filter ----
const uint8_t FILTER_N = 16;          // average of the last 16 readings (1.6 s)

// ---- LED patterns (milliseconds) ----
const uint32_t LED_IDLE_PERIOD_MS  = 2000UL;   // waiting: a short flash every 2 s
const uint32_t LED_IDLE_ON_MS      = 100UL;
const uint32_t LED_SOAK_PERIOD_MS  = 1000UL;   // soaking: slow blink
const uint32_t LED_SOAK_ON_MS      = 500UL;
const uint32_t LED_CODE_SLOT_MS    = 300UL;    // locked: N quick blinks, then a pause
const uint32_t LED_CODE_ON_MS      = 150UL;
const uint32_t LED_CODE_PAUSE_MS   = 1200UL;

// ---- State machine ----
enum State { IDLE, WATERING, SOAKING, LOCKED };
// Why the pump is locked off. The number is also the number of LED blinks.
enum LockReason : uint8_t { LOCK_NONE = 0, LOCK_SENSOR = 1, LOCK_NO_RESPONSE = 2, LOCK_TIMEOUT = 3 };

State      state = IDLE;
LockReason lockReason = LOCK_NONE;
uint32_t   stateSinceMs = 0;     // when the current state started
uint32_t   pumpTotalMs = 0;      // pump time used so far in this watering episode
uint8_t    percentBeforePulse = 0;

Preferences prefs;               // flash memory that survives a reset or a power cut

// ---- Sensor reading and filter ----
uint16_t samples[FILTER_N];      // ring buffer of the last readings (starts at zero)
uint8_t  sampleIndex = 0;
uint8_t  sampleCount = 0;
uint32_t sampleSum = 0;
uint32_t lastSampleMs = 0;
uint16_t lastRaw = 0;
uint8_t  badSamples = 0;         // consecutive readings outside the valid window

// ---- Button ----
bool     lastButtonReading = HIGH;
bool     buttonStable = HIGH;
uint32_t buttonChangedMs = 0;
bool     clearRequested = false; // a debounced press, waiting to be used

uint32_t lastReportMs = 0;

const char* stateName(State s) {
  switch (s) {
    case IDLE:     return "IDLE";
    case WATERING: return "WATERING";
    case SOAKING:  return "SOAKING";
    default:       return "LOCKED";
  }
}

const char* lockText(LockReason r) {
  switch (r) {
    case LOCK_SENSOR:      return "sensor reading not valid (cable? short?)";
    case LOCK_NO_RESPONSE: return "soil did not get wetter (tank empty? hose blocked?)";
    case LOCK_TIMEOUT:     return "maximum pump time used";
    default:               return "none";
  }
}

// Raw reading -> percent. A higher raw reading means drier soil.
int moisturePercent(uint16_t raw) {
  long span = (long)RAW_DRY - (long)RAW_WET;
  long p = ((long)RAW_DRY - (long)raw) * 100L / span;
  return (int)constrain(p, 0L, 100L);
}

void addSample(uint16_t raw) {
  sampleSum -= samples[sampleIndex];       // forget the oldest reading
  samples[sampleIndex] = raw;
  sampleSum += raw;
  sampleIndex = (sampleIndex + 1) % FILTER_N;
  if (sampleCount < FILTER_N) sampleCount++;
}

bool filterReady() {
  return sampleCount >= FILTER_N;
}

uint16_t filteredRaw() {
  return (uint16_t)(sampleSum / FILTER_N);
}

int currentPercent() {
  return moisturePercent(filteredRaw());
}

bool sensorFault() {
  return badSamples >= (uint8_t)(SENSOR_FAULT_MS / SAMPLE_MS);
}

void sampleSensor(uint32_t now) {
  // (now - lastSampleMs) is an unsigned subtraction: it stays correct when millis() wraps to 0
  if (now - lastSampleMs < SAMPLE_MS) return;
  lastSampleMs = now;
  uint16_t raw = analogRead(SENSOR_PIN);
  lastRaw = raw;
  if (raw < RAW_VALID_MIN || raw > RAW_VALID_MAX) {
    if (badSamples < 255) badSamples++;    // an invalid reading never enters the average
  } else {
    badSamples = 0;
    addSample(raw);
  }
}

void updateButton(uint32_t now) {
  bool raw = digitalRead(BUTTON_PIN);
  if (raw != lastButtonReading) {
    lastButtonReading = raw;
    buttonChangedMs = now;
  }
  if (raw != buttonStable && (now - buttonChangedMs) >= DEBOUNCE_MS) {
    buttonStable = raw;
    if (buttonStable == LOW) clearRequested = true;   // a press, not a release
  }
}

// The only place that touches the pump pin: ON only while the state is WATERING.
void enterState(State next, uint32_t now) {
  state = next;
  stateSinceMs = now;
  digitalWrite(PUMP_PIN, next == WATERING ? HIGH : LOW);
  Serial.printf("State: %s\n", stateName(next));
}

void lockOut(LockReason why, uint32_t now) {
  lockReason = why;
  prefs.putUChar("lock", (uint8_t)why);    // remembered even if the power goes off
  Serial.printf("LOCKED: %s\n", lockText(why));
  enterState(LOCKED, now);
}

void startPulse(uint32_t now) {
  percentBeforePulse = (uint8_t)currentPercent();
  enterState(WATERING, now);
}

bool ledShouldBeOn(uint32_t now) {
  uint32_t t = now - stateSinceMs;
  switch (state) {
    case IDLE:
      return (t % LED_IDLE_PERIOD_MS) < LED_IDLE_ON_MS;
    case WATERING:
      return true;
    case SOAKING:
      return (t % LED_SOAK_PERIOD_MS) < LED_SOAK_ON_MS;
    default: {
      uint32_t blinks = (uint32_t)lockReason;
      uint32_t cycle = blinks * LED_CODE_SLOT_MS + LED_CODE_PAUSE_MS;
      uint32_t p = t % cycle;
      return p < blinks * LED_CODE_SLOT_MS && (p % LED_CODE_SLOT_MS) < LED_CODE_ON_MS;
    }
  }
}

void report(uint32_t now) {
  if (now - lastReportMs < REPORT_MS) return;
  lastReportMs = now;
  Serial.printf("raw=%u filtered=%u moisture=%d%% state=%s pumpTotal=%lu ms\n",
                lastRaw, filteredRaw(), currentPercent(), stateName(state), (unsigned long)pumpTotalMs);
}

void setup() {
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);             // the pump is off before anything else
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  analogReadResolution(12);                // readings 0..4095
  analogSetPinAttenuation(SENSOR_PIN, ADC_11db);   // input range up to about 3.1 V
  Serial.begin(115200);

  prefs.begin("plant", false);
  lockReason = (LockReason)prefs.getUChar("lock", LOCK_NONE);

  uint32_t now = millis();
  lastSampleMs = now;
  lastReportMs = now;
  buttonChangedMs = now;
  // Trust the button level at power-up: a button held (or wired wrong) at start is not a press,
  // so it can never clear a saved lock by itself. A press needs a change from HIGH to LOW.
  lastButtonReading = digitalRead(BUTTON_PIN);
  buttonStable = lastButtonReading;
  if (lockReason != LOCK_NONE) {
    Serial.printf("Still locked from before: %s\n", lockText(lockReason));
    enterState(LOCKED, now);
  } else {
    enterState(IDLE, now);
  }
}

void loop() {
  uint32_t now = millis();
  sampleSensor(now);
  updateButton(now);

  if (state != LOCKED && sensorFault()) {
    lockOut(LOCK_SENSOR, now);             // no valid reading: never water blind
  }

  switch (state) {
    case IDLE:
      if (filterReady() && currentPercent() < DRY_ON_PERCENT) {
        pumpTotalMs = 0;                   // a new watering episode
        startPulse(now);
      }
      break;

    case WATERING:
      if (now - stateSinceMs >= PULSE_MS) {
        pumpTotalMs += PULSE_MS;
        enterState(SOAKING, now);
      }
      break;

    case SOAKING:
      if (now - stateSinceMs >= SOAK_MS) {
        int p = currentPercent();
        if (p >= WET_OFF_PERCENT) {
          enterState(IDLE, now);           // wet enough: done
        } else if (p < percentBeforePulse + MIN_RISE_PERCENT) {
          lockOut(LOCK_NO_RESPONSE, now);  // the pump ran and the soil did not change
        } else if (pumpTotalMs + PULSE_MS > MAX_WATER_TOTAL_MS) {
          lockOut(LOCK_TIMEOUT, now);      // another pulse would pass the limit
        } else {
          startPulse(now);                 // gaining, but not wet enough yet
        }
      }
      break;

    case LOCKED:
      if (clearRequested) {
        if (filterReady() && !sensorFault()) {
          lockReason = LOCK_NONE;
          prefs.putUChar("lock", (uint8_t)LOCK_NONE);
          Serial.println("Lock cleared by the button");
          enterState(IDLE, now);
        } else {
          Serial.println("Cannot clear the lock: the sensor reading is still not valid");
        }
      }
      break;
  }
  clearRequested = false;                  // a press only counts in the pass where it happened

  digitalWrite(LED_PIN, ledShouldBeOn(now) ? HIGH : LOW);
  report(now);
}
