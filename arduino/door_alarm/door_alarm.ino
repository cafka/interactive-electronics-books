/*
  Chapter 1: Open door alarm
  Board:    ESP32-DevKitC with an ESP32-WROOM-32E (Arduino core for ESP32)

  A reed switch and a magnet watch a door. If the door stays open for
  OPEN_LIMIT_MS, an LED and a buzzer give intermittent beeps until it closes.

  Wiring (GPIO numbers, not header positions):
    GPIO27 --- reed switch --- GND     (INPUT_PULLUP: door closed = contact closed = LOW)
    GPIO26 --- 330 ohm --- LED anode (+), LED cathode (-) to GND
    GPIO25 --- 1 kohm --- base of a 2N3904 (NPN)
               emitter to GND, collector to the buzzer "-"
               buzzer "+" to the 5V pin of the board (USB 5 V)

  The program never blocks: there is no delay(). Every pass of loop() reads the
  clock, so closing the door is noticed at any moment, even while it beeps.
*/

// ---- Pins (ESP32 GPIO numbers) ----
const uint8_t REED_PIN   = 27;   // input with the internal pull-up
const uint8_t LED_PIN    = 26;   // output to the LED
const uint8_t BUZZER_PIN = 25;   // output to the transistor base

// ---- Timings in milliseconds ----
const uint32_t OPEN_LIMIT_MS = 30000UL;  // door open this long -> alarm
const uint32_t DEBOUNCE_MS   = 30UL;     // a new reading must hold this long
const uint32_t BEEP_ON_MS    = 200UL;    // beep length
const uint32_t BEEP_OFF_MS   = 300UL;    // silence between beeps

// ---- Reed switch levels ----
const bool DOOR_CLOSED_LEVEL = LOW;      // magnet near: contact closed: pin pulled to GND

// ---- State machine ----
enum State { DOOR_CLOSED, DOOR_OPEN, ALARM };
State state = DOOR_CLOSED;

bool     lastReading   = false;  // last raw reading of the pin
bool     stableLevel   = false;  // the reading that stayed unchanged for DEBOUNCE_MS
uint32_t lastChangeMs  = 0;      // when the raw reading last changed
uint32_t openedAtMs    = 0;      // when the open door was confirmed
uint32_t beepChangedMs = 0;      // when the buzzer last switched on or off
bool     beepOn        = false;

void setOutputs(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
}

void enterState(State next, uint32_t now) {
  state = next;
  if (next == DOOR_CLOSED) {
    beepOn = false;
    setOutputs(false);               // counter back to zero: nothing is counting
    Serial.println("Door closed");
  } else if (next == DOOR_OPEN) {
    openedAtMs = now;                // the count starts here
    beepOn = false;
    setOutputs(false);
    Serial.println("Door open: counting");
  } else {
    beepOn = true;                   // first beep starts immediately
    beepChangedMs = now;
    setOutputs(true);
    Serial.println("ALARM");
  }
}

bool doorIsClosed() {
  return stableLevel == DOOR_CLOSED_LEVEL;
}

// Accepts a new reading only after it has stayed the same for DEBOUNCE_MS.
void readDoor(uint32_t now) {
  bool raw = digitalRead(REED_PIN);
  if (raw != lastReading) {
    lastReading = raw;
    lastChangeMs = now;              // the reading moved: restart the timer
  }
  // (now - lastChangeMs) is an unsigned subtraction: it stays correct when millis() wraps to 0
  if (raw != stableLevel && (now - lastChangeMs) >= DEBOUNCE_MS) {
    stableLevel = raw;
  }
}

void setup() {
  pinMode(REED_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  setOutputs(false);
  Serial.begin(115200);

  uint32_t now = millis();
  lastReading = digitalRead(REED_PIN);
  stableLevel = lastReading;         // trust the first reading, so no 30 ms wait at start
  lastChangeMs = now;
  // If the door is already open when the program starts, counting starts now
  enterState(doorIsClosed() ? DOOR_CLOSED : DOOR_OPEN, now);
}

void loop() {
  uint32_t now = millis();
  readDoor(now);

  switch (state) {
    case DOOR_CLOSED:
      if (!doorIsClosed()) enterState(DOOR_OPEN, now);
      break;

    case DOOR_OPEN:
      if (doorIsClosed()) {
        enterState(DOOR_CLOSED, now);
      } else if (now - openedAtMs >= OPEN_LIMIT_MS) {
        enterState(ALARM, now);
      }
      break;

    case ALARM:
      if (doorIsClosed()) {
        enterState(DOOR_CLOSED, now);
      } else if (beepOn && now - beepChangedMs >= BEEP_ON_MS) {
        beepOn = false;
        beepChangedMs = now;
        setOutputs(false);
      } else if (!beepOn && now - beepChangedMs >= BEEP_OFF_MS) {
        beepOn = true;
        beepChangedMs = now;
        setOutputs(true);
      }
      break;
  }
}
