"""Runs python/traffic_light.py against a fake gpiozero and a virtual clock, with scripted button presses.

Usage: python tests/pycheck.py <path to traffic_light.py> '<json list of press times>' <seconds to simulate>
Prints a JSON list of light changes: [{"t": seconds, "state": "GREEN" | "YELLOW" | "RED", "lights": [r, y, g]}].
It exists to prove that the program shown in the book really behaves like the web demo (see traffic.test.mjs).
"""
import json
import sys
import time
import types

path, presses, until = sys.argv[1], sorted(json.loads(sys.argv[2])), float(sys.argv[3])
clock = [0.0]
leds = {}
buttons = []
changes = []
last = [None]


class LED:
    def __init__(self, pin):
        self.pin = pin
        self._value = False
        leds[pin] = self

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._value = bool(v)


class Button:
    def __init__(self, pin, pull_up=True, bounce_time=None):
        self.pin, self.pull_up, self.bounce_time = pin, pull_up, bounce_time
        self.when_pressed = None
        buttons.append(self)


def lights():
    return [int(leds[17].value), int(leds[27].value), int(leds[22].value)]  # red, yellow, green


def snapshot():
    now = lights()
    if now != last[0]:
        last[0] = now
        state = {(1, 0, 0): "RED", (0, 1, 0): "YELLOW", (0, 0, 1): "GREEN"}.get(tuple(now), "OFF")
        changes.append({"t": round(clock[0], 3), "state": state, "lights": now})


def fake_sleep(seconds):
    snapshot()
    nxt = clock[0] + seconds
    for p in presses:
        if clock[0] < p <= nxt and buttons and buttons[0].when_pressed:
            buttons[0].when_pressed()  # gpiozero calls it from its own thread while the loop sleeps
    clock[0] = nxt
    if clock[0] > until:
        raise SystemExit


time.monotonic = lambda: clock[0]
time.sleep = fake_sleep
sys.modules["gpiozero"] = types.SimpleNamespace(LED=LED, Button=Button)

source = open(path, encoding="utf-8").read()
try:
    exec(compile(source, path, "exec"), {"__name__": "__main__"})
except SystemExit:
    pass
print(json.dumps(changes))
