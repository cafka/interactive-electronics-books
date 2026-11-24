# Lesson 4: Traffic light with a pedestrian button
from gpiozero import LED, Button
from time import monotonic, sleep

red = LED(17)       # BCM 17 = physical pin 11
yellow = LED(27)    # BCM 27 = physical pin 13
green = LED(22)     # BCM 22 = physical pin 15
button = Button(23, pull_up=True, bounce_time=0.05)   # BCM 23 = physical pin 16

MIN_GREEN_SECONDS = 4     # green stays on at least this long
YELLOW_SECONDS = 2
CROSSING_SECONDS = 5      # red light: pedestrians may cross
POLL_SECONDS = 0.05       # short pause, so the button is always being watched

state = "GREEN"
state_since = monotonic()
request = False           # True = a crossing was requested and not served yet

def change_state(new_state, now):
    global state, state_since
    state, state_since = new_state, now
    green.value = (state == "GREEN")      # each LED has its own pin
    yellow.value = (state == "YELLOW")
    red.value = (state == "RED")

def request_crossing():
    global request
    if state == "GREEN":                  # ignored during yellow and red
        request = True

button.when_pressed = request_crossing
change_state("GREEN", monotonic())

while True:
    now = monotonic()
    elapsed = now - state_since
    if state == "GREEN" and request and elapsed >= MIN_GREEN_SECONDS:
        change_state("YELLOW", now)
    elif state == "YELLOW" and elapsed >= YELLOW_SECONDS:
        change_state("RED", now)
    elif state == "RED" and elapsed >= CROSSING_SECONDS:
        request = False                   # the crossing was served
        change_state("GREEN", now)
    sleep(POLL_SECONDS)
