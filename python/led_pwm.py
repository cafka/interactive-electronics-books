# Lesson 3: Control LED brightness with PWM
from gpiozero import PWMLED
from time import sleep

led = PWMLED(17)   # GPIO17 (pin 11), 100 Hz

while True:
    for duty in (0, 0.25, 0.5, 0.75, 1):
        led.value = duty   # 0 = LOW, 1 = HIGH
        sleep(2)
