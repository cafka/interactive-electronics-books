// Runs the real sketch (door_alarm.ino) against a simulated clock and reed switch.
#include "Arduino.h"
#include <cstdlib>
uint32_t mockMillis = 0;
int mockPin[40];
int mockMode[40];
SerialMock Serial;
#include "../../arduino/door_alarm/door_alarm.ino"

static int failures = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL line %d: %s\n", __LINE__, #c); failures++; } } while (0)

// reed pin as the board would see it: the test drives it through a pull-up (HIGH) or a closed contact (LOW)
static void reset(uint32_t startMs, int reedLevel) {
  mockMillis = startMs;
  for (int i = 0; i < 40; i++) mockPin[i] = mockMode[i] = 0;
  mockPin[REED_PIN] = reedLevel;
  setup();
}
static int reedInput;  // what the contact is doing
static void run(uint32_t ms) {
  for (uint32_t i = 0; i < ms; i++) {
    mockMillis++;
    // an INPUT_PULLUP pin reads the external level; outputs keep what was written
    mockPin[REED_PIN] = reedInput;
    loop();
  }
}

int main() {
  std::printf("Scenario A: closed, open, alarm, close\n");
  reedInput = LOW; reset(0, LOW);
  CHECK(mockMode[REED_PIN] == INPUT_PULLUP);
  CHECK(state == DOOR_CLOSED && mockPin[LED_PIN] == LOW && mockPin[BUZZER_PIN] == LOW);
  run(1000);
  reedInput = HIGH;                       // door opens, with contact bounce
  for (int i = 0; i < 6; i++) { reedInput = (i % 2 == 0) ? HIGH : LOW; run(2); }
  reedInput = HIGH;
  run(20);
  CHECK(state == DOOR_CLOSED);            // still inside the debounce time
  run(40);
  CHECK(state == DOOR_OPEN);
  uint32_t t0 = openedAtMs;
  run(29900);
  CHECK(state == DOOR_OPEN);
  run(200);
  CHECK(state == ALARM);
  CHECK(mockMillis - t0 >= OPEN_LIMIT_MS);
  int onCount = 0, offCount = 0, changes = 0, prev = mockPin[BUZZER_PIN];
  for (int i = 0; i < 5000; i++) { run(1); if (mockPin[BUZZER_PIN]) onCount++; else offCount++; if (mockPin[BUZZER_PIN] != prev) { changes++; prev = mockPin[BUZZER_PIN]; } CHECK(mockPin[LED_PIN] == mockPin[BUZZER_PIN]); }
  std::printf("  5 s of alarm: %d ms on, %d ms off, %d changes\n", onCount, offCount, changes);
  CHECK(changes >= 9 && onCount > 1800 && onCount < 2200);
  reedInput = LOW;
  run(DEBOUNCE_MS + 2);
  CHECK(state == DOOR_CLOSED && mockPin[LED_PIN] == LOW && mockPin[BUZZER_PIN] == LOW);

  std::printf("Scenario B: program starts with the door open\n");
  reedInput = HIGH; reset(5000, HIGH);
  CHECK(state == DOOR_OPEN && openedAtMs == 5000);
  run(OPEN_LIMIT_MS - 1);
  CHECK(state == DOOR_OPEN);
  run(2);
  CHECK(state == ALARM);

  std::printf("Scenario C: millis() wraps while the door is open\n");
  reedInput = HIGH; reset(0xFFFFFFFFu - 5000u, HIGH);
  run(OPEN_LIMIT_MS - 20);
  CHECK(mockMillis < 0xFFFFFFFFu - 5000u);  // wrapped
  CHECK(state == DOOR_OPEN);
  run(40);
  CHECK(state == ALARM);

  std::printf(failures ? "RESULT: %d FAILURES\n" : "RESULT: all checks passed\n", failures);
  return failures ? 1 : 0;
}
