/*
  Chapter 3: Smart robotic cat feeder (for Pancho)
  Board:    ESP32-DevKitC with an ESP32-WROOM-32E (Arduino core for ESP32, Arduino IDE 2.x)
  Libraries (Library Manager): Adafruit PWM Servo Driver Library, HX711 by Bogdan Necula,
                               Adafruit INA219. Preferences and Wire come with the ESP32 core.

  A 4-joint arm (base, shoulder, elbow, wrist) takes dry food from a hopper with a spoon and pours a measured
  ration into the plate. A load cell under the plate measures what arrived; the pour stops when the ration is
  there. The arm works in its own closed chamber. The cat's access door is closed while anything moves, and
  the servo outputs are switched off while the door is open.

  Wiring (GPIO numbers):
    GPIO21 SDA, GPIO22 SCL -> PCA9685 (address 0x40) and INA219 (address 0x45: bridge its A0 and A1 pads,
                               because its default 0x40 is the PCA9685's)
    GPIO33 -> PCA9685 OE (output enable, active LOW), 10 kohm pull-up to 3V3: outputs off while the ESP32 boots
    PCA9685 channels: 0 base, 1 shoulder, 2 elbow, 3 wrist, 4 access door
    GPIO19 <- HX711 DT, GPIO18 -> HX711 SCK, HX711 VCC from 3V3
    GPIO27 <- IR break-beam receiver at the access window (INPUT_PULLUP, LOW = beam broken)
    GPIO26 <- service-lid switch to GND (INPUT_PULLUP, LOW = lid closed)
    GPIO25 <- second NC contact of the emergency stop to GND (INPUT_PULLUP, LOW = normal, HIGH = pressed or cut)
    GPIO13 <- push button to GND: short press = feed, long press = override cooldown / reset after a fault
    GPIO4  -> status LED through 330 ohm
  Servo power: a separate 6 V 5 A supply -> E-stop main contact -> 5 A fuse -> PCA9685 V+ (1000 uF there).
  Common ground: the supply minus, the PCA9685 GND, the INA219 GND and the ESP32 GND are joined.

  The program never blocks (no delay()). It never resumes a cycle on its own after a fault or a restart.
  This is a teaching design: it has not been certified and must not be used unattended with an animal
  before it has been built, tested and validated on the real parts.
*/

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <HX711.h>
#include <Adafruit_INA219.h>
#include <Preferences.h>
#include <math.h>

// ---- Pins (ESP32 GPIO numbers) ----
const int SDA_PIN = 21;
const int SCL_PIN = 22;
const int HX_DT_PIN = 19;
const int HX_SCK_PIN = 18;
const int BEAM_PIN = 27;
const int LID_PIN = 26;
const int ESTOP_PIN = 25;
const int BUTTON_PIN = 13;
const int OE_PIN = 33;
const int LED_PIN = 4;

// ---- Input levels ----
const int BEAM_BROKEN_LEVEL = LOW;   // check your receiver on the Serial Monitor: some modules are the other way
const int LID_CLOSED_LEVEL = LOW;
const int ESTOP_OK_LEVEL = LOW;

// ---- PCA9685 channels ----
const int CH_BASE = 0;
const int CH_SHOULDER = 1;
const int CH_ELBOW = 2;
const int CH_WRIST = 3;
const int CH_DOOR = 4;

// ---- Arm geometry (mm) ----
const float ARM_H0_MM = 90;    // shoulder axis above the chamber floor
const float ARM_L1_MM = 120;   // shoulder -> elbow
const float ARM_L2_MM = 120;   // elbow -> wrist
const float ARM_L3_MM = 70;    // wrist -> centre of the spoon bowl

// ---- Joint limits (deg) and servo mapping: servo = ZERO + DIR * joint ----
const float Q0_MIN = -90;
const float Q0_MAX = 90;
const float Q1_MIN = 10;
const float Q1_MAX = 160;
const float Q2_MIN = -150;
const float Q2_MAX = 0;
const float Q3_MIN = -95;
const float Q3_MAX = 95;
const float Q0_ZERO = 90;
const float Q1_ZERO = 0;
const float Q2_ZERO = 180;
const float Q3_ZERO = 90;
const float Q0_DIR = 1;
const float Q1_DIR = 1;
const float Q2_DIR = 1;
const float Q3_DIR = 1;
const float SERVO_US_MIN = 500;    // pulse for servo 0 deg (check each servo: see CALIBRATION)
const float SERVO_US_MAX = 2500;   // pulse for servo 180 deg

// ---- Parked pose (deg) ----
const float HOME_Q0 = 0;
const float HOME_Q1 = 110;
const float HOME_Q2 = -135;
const float HOME_Q3 = 40;

// ---- Access door (servo deg) ----
const float DOOR_OPEN_DEG = 10;
const float DOOR_CLOSED_DEG = 100;
const float DOOR_DPS = 45;         // slow: a small servo with a soft edge cannot pinch hard

// ---- Speed limits (deg/s at the joints) ----
const float SPEED_MAX_DPS = 60;
const float SPEED_LOADED_DPS = 35; // with food in the spoon
const float SPEED_POUR_DPS = 20;
const float SPEED_MANUAL_DPS = 20; // manual mode and recovery

// ---- Places (mm, deg) ----
const float HOPPER_R_MM = 210;
const float HOPPER_AZ_DEG = -65;
const float HOPPER_TOP_Z = 170;
const float DIP_Z = 40;
const float SCOOP_Z = 45;
const float STROKE_MM = 30;
const float PLATE_R_MM = 210;
const float PLATE_AZ_DEG = 65;
const float PLATE_Z = 150;
const float DUMP_Z = 140;
const float CARRY_PHI = 10;     // spoon pitch while carrying (tip slightly up)
const float DIG_PHI = -35;      // pitch when the spoon enters the food
const float POUR_PHI_MIN = -70; // most the spoon is tipped
const float POUR_STEP_DEG = 4;
const uint32_t POUR_STEP_MS = 250;
const float ANTICIPATE_G = 1;   // stop pouring this much before the target: food still falling

// ---- Ration (set by the tutor; there is no universal right amount) ----
const float RATION_DEFAULT_G = 20;
const float RATION_MIN_G = 5;
const float RATION_MAX_G = 80;
const float RATION_TOL_G = 2;
const int MAX_SCOOPS = 6;
const float MIN_GAIN_G = 1.5;
const float EXCESS_G = 6;
const float PLATE_FULL_G = 15;  // more than this already on the plate: do not add a ration

// ---- Load cell ----
const float SCALE_CAL = 420;        // counts per gram, replaced by the calibration
const float SCALE_OFFSET = 84000;   // counts with the empty dish, replaced by the tare
const uint32_t SCALE_MS = 100;
const uint32_t SCALE_TIMEOUT_MS = 500;
const float SCALE_MIN_G = -50;
const float SCALE_MAX_G = 2000;
const uint32_t SETTLE_MS = 1500;
const float STABLE_G = 1;

// ---- Jam detection (INA219 on the servo supply) ----
const float JAM_MA = 1800;
const uint32_t JAM_MS = 300;

// ---- Timing ----
const uint32_t MOTION_MS = 20;      // one servo frame (50 Hz)
const uint32_t DOOR_TIMEOUT_MS = 4000;
const uint32_t DEBOUNCE_MS = 30;
const uint32_t LONG_PRESS_MS = 2000;
const uint32_t COOLDOWN_MS = 1800000UL;  // 30 min between rations unless the tutor overrides

Adafruit_PWMServoDriver pwm(0x40);
Adafruit_INA219 ina(0x45);
HX711 scale;
Preferences prefs;

enum State { IDLE, DOOR_CLOSING, TARE, CYCLE, DOOR_OPENING, MANUAL, FAULT, RECOVERING };
enum Phase { P_NONE, TO_HOPPER, DIP, SCOOP, LIFT, TO_PLATE, POUR, UNPOUR, WEIGH, TO_DUMP, DUMP, UNDUMP, HOME,
             R_TO_DUMP, R_DUMP, R_UNDUMP, R_HOME, M_CLOSING_DOOR, M_READY, M_HOMING };
enum Fault { F_NONE, F_ESTOP, F_LID, F_PRESENCE, F_JAM, F_SCALE, F_HOPPER_EMPTY, F_INTERRUPTED, F_UNREACHABLE, F_DOOR, F_STOPPED };

State state = IDLE;
Phase phase = P_NONE;
Fault fault = F_NONE;
uint32_t stateAt = 0, phaseAt = 0;

struct Target { float x, y, z, phi; };

// ---- arm state ----
float q[4];                    // commanded joint angles now
float moveFrom[4], moveTo[4];
float moveDuration = 0, moveT = 0;   // seconds
bool hasMove = false;
bool paused = false;
bool outputsOn = false;
float doorCmd = DOOR_OPEN_DEG, doorPos = DOOR_OPEN_DEG;
uint32_t lastMotion = 0;
float speedPct = 100;

// ---- ration ----
float ration = RATION_DEFAULT_G, target = 0, delivered = 0, baseline = 0, pourPhi = 0;
int scoops = 0, lowGain = 0;
uint32_t pourAt = 0, cooldownUntil = 0;

// ---- scale ----
float scaleBuf[4]; int scaleN = 0, scaleI = 0;
float weightG = 0;
bool scaleOk = false;
uint32_t lastScaleAt = 0, lastScaleRead = 0;
long lastCounts = 0; bool haveCounts = false; int sameCounts = 0; uint32_t lastRawAt = 0;
// The converter answers and is not frozen. Grams may still be meaningless before the first calibration,
// so the tare and the calibration must not depend on them.
bool rawOk() { return haveCounts && sameCounts < 20 && millis() - lastRawAt <= SCALE_TIMEOUT_MS; }
long offsetCounts = 0; float calFactor = 0; bool calibrated = false;

// ---- current, button ----
float currentMa = 0; bool jamTiming = false; uint32_t jamSince = 0;
int btnLast = HIGH, btnStable = HIGH; uint32_t btnChanged = 0, btnDownAt = 0; bool btnDown = false, longFired = false;
bool reqFeed = false, reqOverride = false, reqReset = false, reqStop = false, reqManual = false, reqLeaveManual = false;

// ---- Serial commands (Serial Monitor at 115200, "Newline" line ending) ----
//   f            feed now (same as a short press)      F   feed, overriding the cooldown (long press)
//   g 20         set the ration to 20 g                s   stop (the cycle is abandoned; reset needed)
//   h            pause / continue                      r   reset after a fault (long press)
//   t            tare with the empty dish              c 100   calibrate with a known 100 g weight
//   m            manual mode (door closes first)       x   leave manual mode (arm goes home, door opens)
//   j a b c d    manual: joint angles in degrees       p x y z phi   manual: spoon point in mm, pitch in deg
char line[64];
int lineLen = 0;

// =====================================================================================================
// Kinematics (same formulas as the book)
void forwardK(const float j[4], float &x, float &y, float &z, float &phi) {
  const float D = PI / 180.0;
  float a1 = j[1] * D, a2 = (j[1] + j[2]) * D, a3 = (j[1] + j[2] + j[3]) * D;
  float r = ARM_L1_MM * cos(a1) + ARM_L2_MM * cos(a2) + ARM_L3_MM * cos(a3);
  z = ARM_H0_MM + ARM_L1_MM * sin(a1) + ARM_L2_MM * sin(a2) + ARM_L3_MM * sin(a3);
  x = r * cos(j[0] * D);
  y = r * sin(j[0] * D);
  phi = a3 / D;
}

bool withinLimits(const float j[4]) {
  return j[0] >= Q0_MIN && j[0] <= Q0_MAX && j[1] >= Q1_MIN && j[1] <= Q1_MAX &&
         j[2] >= Q2_MIN && j[2] <= Q2_MAX && j[3] >= Q3_MIN && j[3] <= Q3_MAX;
}

// Elbow-up solution. Returns false if the point is out of reach or needs a joint past its limit.
bool inverseK(const Target &t, float out[4]) {
  const float D = PI / 180.0;
  float q0 = atan2(t.y, t.x) / D;
  float r = sqrt(t.x * t.x + t.y * t.y);
  float rw = r - ARM_L3_MM * cos(t.phi * D);
  float zw = t.z - ARM_H0_MM - ARM_L3_MM * sin(t.phi * D);
  float c2 = (rw * rw + zw * zw - ARM_L1_MM * ARM_L1_MM - ARM_L2_MM * ARM_L2_MM) / (2 * ARM_L1_MM * ARM_L2_MM);
  if (c2 > 1 || c2 < -1) return false;
  float q2 = -acos(c2) / D;
  float q1 = (atan2(zw, rw) - atan2(ARM_L2_MM * sin(q2 * D), ARM_L1_MM + ARM_L2_MM * cos(q2 * D))) / D;
  out[0] = q0; out[1] = q1; out[2] = q2; out[3] = t.phi - q1 - q2;
  return withinLimits(out);
}

Target at(float r, float az, float z, float phi) {
  const float D = PI / 180.0;
  Target t = { r * cos(az * D), r * sin(az * D), z, phi };
  return t;
}
Target wpAboveHopper() { return at(HOPPER_R_MM, HOPPER_AZ_DEG, HOPPER_TOP_Z, CARRY_PHI); }
Target wpDip()         { return at(HOPPER_R_MM + STROKE_MM / 2, HOPPER_AZ_DEG, DIP_Z, DIG_PHI); }
Target wpScoop()       { return at(HOPPER_R_MM - STROKE_MM / 2, HOPPER_AZ_DEG, SCOOP_Z, CARRY_PHI); }
Target wpAbovePlate()  { return at(PLATE_R_MM, PLATE_AZ_DEG, PLATE_Z, CARRY_PHI); }
Target wpPour(float p) { return at(PLATE_R_MM, PLATE_AZ_DEG, PLATE_Z, p); }
Target wpDump()        { return at(HOPPER_R_MM, HOPPER_AZ_DEG, DUMP_Z, POUR_PHI_MIN); }
Target wpAboveDump()   { return at(HOPPER_R_MM, HOPPER_AZ_DEG, DUMP_Z, CARRY_PHI); }

// =====================================================================================================
// Servos
float jointToServo(int j, float a) {
  const float Z[4] = { Q0_ZERO, Q1_ZERO, Q2_ZERO, Q3_ZERO }, S[4] = { Q0_DIR, Q1_DIR, Q2_DIR, Q3_DIR };
  return constrain(Z[j] + S[j] * a, 0, 180);
}
void servoDeg(int ch, float deg) {
  float us = SERVO_US_MIN + (SERVO_US_MAX - SERVO_US_MIN) * deg / 180.0;
  pwm.writeMicroseconds(ch, (uint16_t)us);
}
void servoOff(int ch) { pwm.setPWM(ch, 0, 4096); }   // full off: no pulse, the servo stops driving
bool armOn = false;   // false after armOff(): no more arm pulses until a new start, even while the door is held
void armOff() { armOn = false; servoOff(CH_BASE); servoOff(CH_SHOULDER); servoOff(CH_ELBOW); servoOff(CH_WRIST); }
void setOutputs(bool on) { outputsOn = on; if (on) armOn = true; digitalWrite(OE_PIN, on ? LOW : HIGH); }

// Coordinated move: all joints finish together; smoothstep peak speed is 1.5x the average.
bool goToJoints(const float t[4], float dps) {
  float span = 0;
  for (int i = 0; i < 4; i++) { moveFrom[i] = q[i]; moveTo[i] = t[i]; span = max(span, fabs(t[i] - q[i])); }
  moveDuration = span < 1e-6 ? 0 : 1.5 * span / (dps * speedPct / 100.0);
  moveT = 0;
  hasMove = true;
  return true;
}
bool goTo(const Target &t, float dps) {
  float j[4];
  if (!inverseK(t, j)) { Serial.println("Target not reachable"); return false; }
  return goToJoints(j, dps);
}
bool moving() { return hasMove && moveT < moveDuration; }
void homeJoints(float out[4]) { out[0] = HOME_Q0; out[1] = HOME_Q1; out[2] = HOME_Q2; out[3] = HOME_Q3; }

void stepMotion(uint32_t now) {
  if (now - lastMotion < MOTION_MS) return;
  float dt = (now - lastMotion) / 1000.0;
  lastMotion = now;
  if (hasMove && !paused) {
    moveT = min(moveDuration, moveT + dt);
    float u = moveDuration == 0 ? 1 : moveT / moveDuration;
    float s = u * u * (3 - 2 * u);
    for (int i = 0; i < 4; i++) q[i] = moveFrom[i] + (moveTo[i] - moveFrom[i]) * s;
  }
  float step = DOOR_DPS * dt;
  if (!paused || state == DOOR_OPENING) doorPos += constrain(doorCmd - doorPos, -step, step);
  if (outputsOn) {
    if (armOn) {
      servoDeg(CH_BASE, jointToServo(0, q[0]));
      servoDeg(CH_SHOULDER, jointToServo(1, q[1]));
      servoDeg(CH_ELBOW, jointToServo(2, q[2]));
      servoDeg(CH_WRIST, jointToServo(3, q[3]));
    }
    servoDeg(CH_DOOR, doorPos);
  }
}

// =====================================================================================================
// Inputs
bool estopOk() { return digitalRead(ESTOP_PIN) == ESTOP_OK_LEVEL; }
bool lidClosed() { return digitalRead(LID_PIN) == LID_CLOSED_LEVEL; }
bool catPresent() { return digitalRead(BEAM_PIN) == BEAM_BROKEN_LEVEL; }

void readScale(uint32_t now) {
  if (now - lastScaleRead < SCALE_MS) return;
  lastScaleRead = now;
  if (!scale.is_ready()) {
    if (now - lastScaleAt > SCALE_TIMEOUT_MS) scaleOk = false;
    return;
  }
  long counts = scale.read();
  lastRawAt = now;
  sameCounts = (haveCounts && counts == lastCounts) ? sameCounts + 1 : 0;   // a frozen converter is not measuring
  lastCounts = counts; haveCounts = true;
  float g = (counts - offsetCounts) / calFactor;
  bool valid = g >= SCALE_MIN_G && g <= SCALE_MAX_G && sameCounts < 20;
  if (valid) {
    lastScaleAt = now;
    scaleBuf[scaleI] = g; scaleI = (scaleI + 1) % 4; if (scaleN < 4) scaleN++;
    float sum = 0; for (int i = 0; i < scaleN; i++) sum += scaleBuf[i];
    weightG = sum / scaleN;
  }
  scaleOk = valid && (now - lastScaleAt) <= SCALE_TIMEOUT_MS;
}
float scaleSpread() {
  float lo = 1e9, hi = -1e9;
  for (int i = 0; i < scaleN; i++) { lo = min(lo, scaleBuf[i]); hi = max(hi, scaleBuf[i]); }
  return hi - lo;
}
void clearScale() { scaleN = 0; scaleI = 0; }

void readButton(uint32_t now) {
  int raw = digitalRead(BUTTON_PIN);
  if (raw != btnLast) { btnLast = raw; btnChanged = now; }
  if (raw != btnStable && now - btnChanged >= DEBOUNCE_MS) {
    btnStable = raw;
    if (raw == LOW) { btnDown = true; btnDownAt = now; longFired = false; }
    else if (btnDown) {
      if (!longFired) { if (state != FAULT) reqFeed = true; }
      btnDown = false;
    }
  }
  if (btnStable == LOW && btnDown && !longFired && now - btnDownAt >= LONG_PRESS_MS) {
    longFired = true;
    if (state == FAULT) reqReset = true; else { reqFeed = true; reqOverride = true; }
  }
}

void readCurrent(uint32_t now) {
  currentMa = ina.getCurrent_mA();
  if (currentMa > JAM_MA) { if (!jamTiming) { jamTiming = true; jamSince = now; } }
  else jamTiming = false;
}

// =====================================================================================================
// States
void enter(State s, uint32_t now, Phase p = P_NONE) { state = s; phase = p; stateAt = now; phaseAt = now; }
void setPhase(Phase p, uint32_t now) { phase = p; phaseAt = now; }
void saveCycle(bool active) { prefs.putBool("cycle", active); prefs.putFloat("delivered", delivered); }

void enterFault(Fault f, uint32_t now) {
  fault = f;
  hasMove = false;
  paused = false;
  armOff();                         // the arm stops driving; the door servo keeps the door where it is
  if (f == F_ESTOP) setOutputs(false);
  Serial.printf("FAULT %d (delivered %.1f g of %.1f g)\n", (int)f, delivered, target);
  enter(FAULT, now);
}

bool cooldownActive(uint32_t now) { return (int32_t)(cooldownUntil - now) > 0; }

bool canStart(uint32_t now, bool override) {
  if (!estopOk()) { Serial.println("Refused: emergency stop"); return false; }
  if (!lidClosed()) { Serial.println("Refused: service lid open"); return false; }
  if (catPresent()) { Serial.println("Refused: cat at the window"); return false; }
  if (!scaleOk) { Serial.println("Refused: load cell"); return false; }
  if (!calibrated) { Serial.println("Refused: calibrate the load cell first"); return false; }
  if (weightG > PLATE_FULL_G) { Serial.println("Refused: the plate still has food"); return false; }
  if (!override && cooldownActive(now)) { Serial.println("Refused: cooldown (long press to override)"); return false; }
  return true;
}

void startScoop(uint32_t now) { goTo(wpAboveHopper(), SPEED_MAX_DPS); setPhase(TO_HOPPER, now); }

bool goPhase(const Target &t, float dps, Phase p, uint32_t now) {
  if (!goTo(t, dps)) { enterFault(F_UNREACHABLE, now); return false; }
  setPhase(p, now);
  return true;
}

void cycleStep(uint32_t now) {
  if (moving()) return;
  switch (phase) {
    case TO_HOPPER: goPhase(wpDip(), SPEED_MAX_DPS, DIP, now); break;
    case DIP:       goPhase(wpScoop(), SPEED_POUR_DPS, SCOOP, now); break;
    case SCOOP:     goPhase(wpAboveHopper(), SPEED_LOADED_DPS, LIFT, now); break;
    case LIFT:      goPhase(wpAbovePlate(), SPEED_LOADED_DPS, TO_PLATE, now); break;
    case TO_PLATE:  pourPhi = CARRY_PHI; pourAt = now; setPhase(POUR, now); break;
    case POUR: {
      // feedback pour: tilt a little, read the scale, stop as soon as the plate holds the ration
      if (now - pourAt < POUR_STEP_MS) break;
      pourAt = now;
      float net = weightG - baseline;
      if (net >= target - ANTICIPATE_G || pourPhi <= POUR_PHI_MIN) { goPhase(wpAbovePlate(), SPEED_POUR_DPS, UNPOUR, now); break; }
      pourPhi = max(POUR_PHI_MIN, pourPhi - POUR_STEP_DEG);
      if (!goTo(wpPour(pourPhi), SPEED_POUR_DPS)) enterFault(F_UNREACHABLE, now);
      break;
    }
    case UNPOUR: clearScale(); setPhase(WEIGH, now); break;
    case WEIGH: {
      if (now - phaseAt < SETTLE_MS || scaleN < 4) break;
      if (scaleSpread() > STABLE_G) { if (now - phaseAt > SETTLE_MS * 3) enterFault(F_SCALE, now); break; }
      float before = delivered;
      delivered = weightG - baseline;
      float gain = delivered - before;
      scoops++;
      saveCycle(true);
      Serial.printf("Weighed: %.1f g of %.1f g after %d scoops\n", delivered, target, scoops);
      if (delivered >= target - RATION_TOL_G) {
        if (delivered > target + EXCESS_G) Serial.println("Warning: more than the ration (it cannot be taken back)");
        goPhase(wpAboveDump(), SPEED_LOADED_DPS, TO_DUMP, now);
        break;
      }
      lowGain = (gain < MIN_GAIN_G) ? lowGain + 1 : 0;
      if (lowGain >= 2) { enterFault(F_HOPPER_EMPTY, now); break; }
      if (scoops >= MAX_SCOOPS) { Serial.println("Short ration: scoop limit reached"); goPhase(wpAboveDump(), SPEED_LOADED_DPS, TO_DUMP, now); break; }
      startScoop(now);
      break;
    }
    case TO_DUMP: case R_TO_DUMP: goPhase(wpDump(), SPEED_POUR_DPS, phase == R_TO_DUMP ? R_DUMP : DUMP, now); break;
    case DUMP: case R_DUMP:       goPhase(wpAboveDump(), SPEED_POUR_DPS, phase == R_DUMP ? R_UNDUMP : UNDUMP, now); break;
    case UNDUMP: case R_UNDUMP: { float h[4]; homeJoints(h); goToJoints(h, SPEED_MAX_DPS); setPhase(phase == R_UNDUMP ? R_HOME : HOME, now); break; }
    case HOME: case R_HOME: doorCmd = DOOR_OPEN_DEG; armOff(); enter(DOOR_OPENING, now); break;
    default: break;
  }
}

// =====================================================================================================
// Serial commands: the same actions as the page's buttons
void handleCommand(char *c) {
  float a, b, d, e;
  switch (c[0]) {
    case 'f': reqFeed = true; break;
    case 'F': reqFeed = true; reqOverride = true; break;
    case 's': reqStop = true; break;
    case 'r': reqReset = true; break;
    case 'h':
      if (state == CYCLE || state == MANUAL || state == RECOVERING) { paused = !paused; Serial.println(paused ? "Paused" : "Continue"); }
      break;
    case 'g':
      if (sscanf(c + 1, "%f", &a) == 1) { ration = constrain(roundf(a), RATION_MIN_G, RATION_MAX_G); Serial.printf("Ration %.0f g\n", ration); }
      break;
    case 't':
      if (state == IDLE && rawOk()) { offsetCounts = lastCounts; prefs.putLong("offset", offsetCounts); clearScale(); Serial.println("Tare done"); }
      break;
    case 'c':
      if (state == IDLE && rawOk() && sscanf(c + 1, "%f", &a) == 1 && a > 0) {
        float k = (lastCounts - offsetCounts) / a;
        if (k > 1) {
          calFactor = k; calibrated = true;
          prefs.putFloat("cal", k); prefs.putBool("calibrated", true);
          clearScale();
          Serial.printf("Calibrated: %.2f counts per gram\n", k);
        }
      }
      break;
    case 'm': reqManual = true; break;
    case 'x': reqLeaveManual = true; break;
    case 'j':
      if (state == MANUAL && phase == M_READY && sscanf(c + 1, "%f %f %f %f", &a, &b, &d, &e) == 4) {
        float t[4] = { constrain(a, Q0_MIN, Q0_MAX), constrain(b, Q1_MIN, Q1_MAX), constrain(d, Q2_MIN, Q2_MAX), constrain(e, Q3_MIN, Q3_MAX) };
        goToJoints(t, SPEED_MANUAL_DPS);
      }
      break;
    case 'p':
      if (state == MANUAL && phase == M_READY && sscanf(c + 1, "%f %f %f %f", &a, &b, &d, &e) == 4) {
        Target t = { a, b, d, e };
        if (!goTo(t, SPEED_MANUAL_DPS)) Serial.println("Not reachable: outside the reach or past a joint limit");
      }
      break;
    default: break;
  }
}
void readSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (lineLen) { line[lineLen] = 0; handleCommand(line); lineLen = 0; }
    } else if (lineLen < (int)sizeof(line) - 1) line[lineLen++] = ch;
  }
}

// =====================================================================================================
void setup() {
  pinMode(OE_PIN, OUTPUT);
  digitalWrite(OE_PIN, HIGH);               // PCA9685 outputs disabled first
  pinMode(BEAM_PIN, INPUT_PULLUP);
  pinMode(LID_PIN, INPUT_PULLUP);
  pinMode(ESTOP_PIN, INPUT_PULLUP);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);
  pwm.begin();
  pwm.setOscillatorFrequency(25000000);
  pwm.setPWMFreq(50);
  ina.begin();
  scale.begin(HX_DT_PIN, HX_SCK_PIN);
  prefs.begin("feeder", false);
  offsetCounts = prefs.getLong("offset", (long)SCALE_OFFSET);
  calFactor = prefs.getFloat("cal", SCALE_CAL);
  calibrated = prefs.getBool("calibrated", false);
  delivered = prefs.getFloat("delivered", 0);

  uint32_t now = millis();
  homeJoints(q);
  lastMotion = now;
  lastScaleAt = now; lastScaleRead = now;
  btnLast = btnStable = digitalRead(BUTTON_PIN); btnChanged = now;
  cooldownUntil = now + COOLDOWN_MS;        // the time of the last ration is unknown after a start: wait or override
  if (prefs.getBool("cycle", false)) {
    enterFault(F_INTERRUPTED, now);          // never resume and never start a second ration by itself
  } else enter(IDLE, now);
}

void loop() {
  uint32_t now = millis();
  readSerial();
  readButton(now);
  readScale(now);
  readCurrent(now);

  bool active = state == DOOR_CLOSING || state == TARE || state == CYCLE || state == MANUAL || state == RECOVERING || state == DOOR_OPENING;
  if (state != FAULT) {
    if (!estopOk() && (active || outputsOn)) { enterFault(F_ESTOP, now); return; }
    if (active) {
      if (!lidClosed()) { enterFault(F_LID, now); return; }
      if (jamTiming && now - jamSince >= JAM_MS) { enterFault(F_JAM, now); return; }
      if (catPresent() && state != DOOR_OPENING) {
        if (state == DOOR_CLOSING) doorCmd = DOOR_OPEN_DEG;   // never close the door on a paw
        enterFault(F_PRESENCE, now); return;
      }
      if (!scaleOk && (state == TARE || state == CYCLE)) { enterFault(F_SCALE, now); return; }
    }
    if (reqStop && active) {
      saveCycle(state == CYCLE || state == TARE);   // a stopped ration still counts as started
      reqStop = false;
      enterFault(F_STOPPED, now);
      return;
    }
  }

  switch (state) {
    case IDLE:
      if (reqFeed) {
        if (canStart(now, reqOverride)) {
          delivered = 0; scoops = 0; lowGain = 0; target = ration;
          setOutputs(true);
          float h[4]; homeJoints(h); goToJoints(h, SPEED_MANUAL_DPS);
          doorCmd = DOOR_CLOSED_DEG;
          enter(DOOR_CLOSING, now);
        }
      } else if (reqManual) {
        if (!lidClosed() || catPresent() || !estopOk()) Serial.println("Manual mode refused: lid, cat or emergency stop");
        else { setOutputs(true); doorCmd = DOOR_CLOSED_DEG; enter(MANUAL, now, M_CLOSING_DOOR); }
      }
      break;
    case MANUAL:
      if (phase == M_CLOSING_DOOR) {
        if (fabs(doorPos - DOOR_CLOSED_DEG) < 0.5) { goToJoints(q, SPEED_MANUAL_DPS); setPhase(M_READY, now); }
      } else if (phase == M_READY && reqLeaveManual) {
        float h[4]; homeJoints(h); goToJoints(h, SPEED_MANUAL_DPS); setPhase(M_HOMING, now);
      } else if (phase == M_HOMING && !moving()) {
        doorCmd = DOOR_OPEN_DEG; enter(DOOR_OPENING, now);
      }
      break;
    case DOOR_CLOSING:
      if (fabs(doorPos - DOOR_CLOSED_DEG) < 0.5 && !moving()) { saveCycle(true); clearScale(); enter(TARE, now); }
      else if (now - stateAt > DOOR_TIMEOUT_MS + 6000) enterFault(F_DOOR, now);
      break;
    case TARE:
      if (now - stateAt >= SETTLE_MS && scaleN >= 4) { baseline = weightG; enter(CYCLE, now); startScoop(now); }
      break;
    case CYCLE:
      cycleStep(now);
      break;
    case DOOR_OPENING:
      if (fabs(doorPos - DOOR_OPEN_DEG) < 0.5) {
        setOutputs(false); armOff();          // parked: the arm cannot move while the plate is reachable
        saveCycle(false);
        cooldownUntil = now + COOLDOWN_MS;
        Serial.printf("Done: %.1f g\n", delivered);
        enter(IDLE, now);
      }
      break;
    case FAULT:
      if (reqReset) {
        if (estopOk() && lidClosed() && !catPresent()) {
          fault = F_NONE; setOutputs(true); paused = false;
          doorCmd = DOOR_CLOSED_DEG;
          float h[4]; homeJoints(h); goToJoints(h, SPEED_MANUAL_DPS);
          enter(RECOVERING, now);
        } else Serial.println("Reset refused: clear the cause first");
      }
      break;
    case RECOVERING:
      if (!moving() && fabs(doorPos - DOOR_CLOSED_DEG) < 0.5) { goTo(wpAboveDump(), SPEED_MANUAL_DPS); enter(CYCLE, now, R_TO_DUMP); }
      break;
    default: break;
  }
  reqFeed = reqOverride = reqReset = reqStop = reqManual = reqLeaveManual = false;

  // status LED: on while anything moves, fast blink in a fault, off when parked
  bool led = state == FAULT ? (now / 150) % 2 : (state != IDLE);
  digitalWrite(LED_PIN, led ? HIGH : LOW);
  stepMotion(now);
}
