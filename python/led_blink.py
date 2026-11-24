# Lesson 1: Light an LED with GPIO17 (physical pin 11)
from gpiozero import LED
from time import sleep

led = LED(17)   # BCM numbering: GPIO17 is physical pin 11

while True:
    led.on()    # GPIO17 -> 3.3 V (HIGH): current flows, the LED lights up
    sleep(1)
    led.off()   # GPIO17 -> 0 V (LOW): no current, the LED turns off
    sleep(1)
