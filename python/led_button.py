# Lesson 2: Control an LED with a push button
from gpiozero import LED, Button
from signal import pause

led = LED(17)                                         # output: GPIO17 (pin 11)
button = Button(27, pull_up=True, bounce_time=0.05)   # input: GPIO27 (pin 13)

button.when_pressed = led.on       # call led.on() when the button is pressed
button.when_released = led.off     # call led.off() when it is released

pause()                            # keep the program alive, waiting for events
