// Minimal stand-in for the Arduino core, only to compile and run door_alarm.ino on a PC (tests/arduino/run.ps1).
#pragma once
#include <cstdint>
#include <cstdio>
#include <string>
#define HIGH 1
#define LOW 0
#define INPUT_PULLUP 2
#define OUTPUT 3
extern uint32_t mockMillis;
extern int mockPin[40];
extern int mockMode[40];
inline uint32_t millis() { return mockMillis; }
inline void pinMode(uint8_t p, int m) { mockMode[p] = m; }
inline int digitalRead(uint8_t p) { return mockPin[p]; }
inline void digitalWrite(uint8_t p, int v) { mockPin[p] = v; }
struct SerialMock {
  void begin(long) {}
  void println(const char* s) { std::printf("  [%10u ms] %s\n", (unsigned)mockMillis, s); }
};
extern SerialMock Serial;
