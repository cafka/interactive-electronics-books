# Interactive Electronics Books (3D)

A small library of interactive 3D books, one per board. The engine (page turn, notebook, reading mode, camera views) is shared. Each book has its own cover, board model, pin definition, chapters, circuits, explanations and code.

| Book | Chapters |
| --- | --- |
| **Raspberry Pi 5** (Python, `gpiozero`) | 1 Light an LED · 2 Control an LED with a Button · 3 LED Brightness with PWM · 4 Traffic Light with Pedestrian Button |
| **ESP32** (Arduino C++, ESP32-DevKitC with ESP32-WROOM-32E) | 1 Open Door Alarm (reed switch and magnet, LED, buzzer, 30 s timer) · 2 Smart Plant Watering (soil sensor, ADC, MOSFET and pump, state machine with fault lock) · 3 Smart Robotic Cat Feeder (4-DOF arm, PCA9685, load cell, kinematics, safety) |

Open the site and choose a book in the **Library**. The **Library** button (top left) goes back to it.

**Live library:** <https://cafka.github.io/interactive-electronics-books/>

Direct links: Raspberry Pi chapter 3 `?open=1&lesson=3` (or `?book=raspberry-pi&open=1&lesson=3`), ESP32 chapter 1 `?book=esp32&open=1&lesson=1`, ESP32 chapter 2 `?book=esp32&open=1&lesson=2`, ESP32 chapter 3 `?book=esp32&open=1&lesson=3`.

Stack: plain ES modules + Three.js r170 (vendored in `vendor/`, no CDN, no paid APIs, works offline).
This is a web simulation: it never touches real GPIO.

## Run

Requires Node.js 18+ and Google Chrome. No `npm install` needed.

```powershell
npm start
```

Open <http://127.0.0.1:5173/> in Chrome. (Alternative: `python -m http.server 5173` from this folder.)
Opening `index.html` directly with `file://` will not work because ES modules need http.

## Navigation

- **← Previous / Next →** in the notebook header, or the ← → keys, turn the page.
- **From the book itself:** each bottom page corner is a curled sheet of paper (with its back side and a shadow) that lifts and settles gently; it lifts more on hover or keyboard focus. A **Next ›** / **‹ Previous** tag sits next to the corner (a real button: Tab to it, Enter to turn). Click or tap near the corner or the outer edge to turn. A corner appears only if that chapter exists. Dragging still moves the camera; only a short click turns the page. Corners, tags, arrow keys and the notebook buttons all run the same page-turn animation.
- **Left page view** (notebook header or Camera > Left page): the camera looks straight down at the real 3D left page (narrow field of view, no perspective distortion, text upright, high-resolution texture). The notebook is hidden by default; use **Show notebook** / **Hide notebook** in the top bar, drag to pan, scroll to zoom, double-click to reset. **Back to previous view** (or Esc) restores the camera and the notebook.
- **Camera bar** (top of the 3D view): the chapter's camera views and, in the ESP32 chapters, **Play / Pause** (Pause freezes the simulated clock; Play continues, or starts a stopped program). It slides away while you scroll (mouse wheel or the notebook) and comes back on the next pointer move, tap or key press. In the left page view it gives way to the left page toolbar, which has **−** / **+** zoom buttons; everything outside the left page is covered.
- **Book size:** the shared "Whole book" view (and any chapter view marked `fit: 'book'`, such as the ESP32 "Whole project") computes the camera distance so the open book and the parts built on it fill the free area: the window minus the notebook, the camera bar and a small margin. It is recomputed when the window is resized.
- **Floating labels** (the dark tags; the text printed on the 3D boards is part of the models): **Labels: auto** (under the Library button) shows as many as fit without overlapping each other, the notebook, the camera bar or the anchor points of other parts; the rest shrink to their dot. **Labels: on click** shows only dots; **Labels: off** hides them. In every mode, hovering a part with the mouse or clicking it shows its label; a second click (or a click elsewhere) hides it. This works for every chapter, using each chapter's label list in its order of priority.
- **Read page** (notebook header): shows the left page as selectable HTML at full size, with the simulation stopped. **Back to the book** (or Esc) returns to the same chapter and camera. The text and schematics come from `src/pageContent.js`, the same source that paints the 3D page.
- Turning a page (or reading) stops the current chapter's program and electrical animations, folds the 3D circuit away, turns the page leaf, then builds the new chapter's circuit and swaps the notebook (simulation, code, explanations).
- On narrow screens the notebook is a bottom sheet that scrolls as a whole (the tabs stay pinned).

## Test checklist

Chapter 1
1. Click **Open the book**; the circuit builds on the right page.
2. `led.on()` / `led.off()` and **Run program** (blinks every second).

Chapter 2 (press **Next →**)
1. The program starts automatically (**Run program / Stop program** buttons).
2. Hold the blue 3D button with mouse or finger, or hold the **Hold to press** pad (also Space / Enter). Release anywhere to let go.
3. While held: GPIO27 goes LOW, `is_pressed` becomes True after the bounce filter, GPIO17 goes HIGH, the LED lights.
4. Violet diamonds = logic path (button → GPIO27 → Python → GPIO17 → LED). Amber / cyan dots = current.

Chapter 3 (press **Next →** again)
1. **Brightness (duty cycle)**: drag the slider (or use arrow keys), or press 0 / 25 / 50 / 75 / 100 %. The LED, the duty indicators, the period bar and the plot follow.
2. **Real speed (100 Hz)**: the LED looks steady; the plot shows five ideal 10 ms periods. **Slow motion (0.5 Hz)**: the same square wave, 200 times slower, so you see each pulse light and release the LED while the plot scrolls.
3. **Run program** runs `led_pwm.py` line by line: the duty cycle steps through 0, 25, 50, 75 and 100 % every 2 s and the slider is locked. **Stop program** turns the LED off.
4. The "average" line in the plot is a calculation: the pin is only ever 0 V or 3.3 V.

Chapter 4 (press **Next →** once more, or open `?open=1&lesson=4`)
1. The program starts by itself on GREEN. **Run / Stop / Restart** are in the notebook. Stop turns every LED off and forgets the pending request; Restart goes back to GREEN.
2. Hold the blue 3D button (or the pad, or Space / Enter on it). The request is **registered**; green stays on for at least 4 s, then YELLOW (2 s), then RED (5 s) with the "You can cross" countdown, then GREEN again. The times are read from `python/traffic_light.py`.
3. Extra presses while a request is pending, or during yellow and red, change nothing: no timer restarts and no second crossing is queued. **Check it in the simulation** runs the guided experiment.
4. The timeline, the GPIO table (HIGH/LOW per pin) and the console follow every event. The highlighted code lines are the ones that really ran.
5. The pedestrian display is a teaching aid in the notebook (and a dashed label in the scene): it is not a component and uses no GPIO.

Automated check of the chapter 4 logic: `npm test` (Node's built-in runner, no dependencies). It also runs `python/traffic_light.py` against a fake `gpiozero` with a virtual clock and compares its behaviour with the web simulation (this last test is skipped if Python is not installed).

URL shortcuts for quick tests: `?open=1`, `&lesson=1|2|3|4`, `&view=led|gpio|circuit|book|button`, `&left=1` (open the left page view), `&led=on` (lesson 1), `&press=1` (lesson 2), `&run=1` (lesson 1).

## Run the code on a real Raspberry Pi 5

Lesson 1: pin 11 (GPIO17) → 330 Ω → LED anode; LED cathode → pin 6 (GND).
```bash
python3 python/led_blink.py
```
Lesson 2: same LED branch, plus a push button between pin 13 (GPIO27) and GND (pin 14).
```bash
python3 python/led_button.py
```
Lesson 3: same circuit as lesson 1, new code.
```bash
python3 python/led_pwm.py
```
Lesson 4: red LED on GPIO17 (pin 11), yellow on GPIO27 (pin 13), green on GPIO22 (pin 15), each through its own 330 Ω resistor; the three cathodes go to the breadboard "−" rail and from there to pin 6 (GND). A push button between GPIO23 (pin 16) and GND (pin 14). GPIO numbers are BCM (what Python uses), pins are physical positions on the header.
```bash
python3 python/traffic_light.py
```

## ESP32 chapter 1: Open Door Alarm

- Board: **ESP32-DevKitC V4 with ESP32-WROOM-32E**. Other ESP32 boards can have other pin layouts; the model and the notebook say which one is used.
- Wiring (GPIO names): reed switch on **IO27** (`INPUT_PULLUP`, other leg to GND, closed = LOW = door closed). LED on **IO26** through 330 Ω. **IO25** through 1 kΩ to the base of a 2N3904 that switches a 5 V magnetic buzzer (supplied from the board's 5V pin). All three are on the left header (J2); the notebook (How it works) gives the position of each pin.
- The sketch is `arduino/door_alarm/door_alarm.ino`. It is the only copy: the notebook shows it, the Download button serves it, and the simulation reads its constants (30 s limit, debounce, beep timing, pins). `src/books/esp32/doorAlarm.js` is a port of its logic.
- Checks that ran without hardware: `npm test` (door logic: the four guided cases, start with the door open, debounce, `millis()` wrap, constants and pins read from the sketch) and `tests/arduino/run.ps1` (compiles the real `.ino` against a mock `Arduino.h` and runs it; needs g++, clang++ or the Visual Studio Build Tools).
- **Needs real parts:** the magnet distance that closes the reed contact, buzzer loudness and real current, the 2N3904 operating point, and the bounce of the real switch. Low-voltage USB only; a breadboard is not a permanent or damp installation.

## ESP32 chapter 2: Smart Plant Watering

- A capacitive soil sensor on **IO34** (ADC1, 11 dB, powered from 3V3, 100 kΩ pull-down), a 5 V mini pump switched by a logic-level N-MOSFET (IRLZ44N) on **IO25** (100 Ω gate resistor, 10 kΩ gate pull-down, 1N5819 flyback diode, 470 µF on 5 V), a status LED on **IO26** and a lock-clear button on **IO27** (`INPUT_PULLUP`).
- States: `IDLE` → `WATERING` (3 s pulse) → `SOAKING` (60 s) → measure again; `LOCKED` on a fault. Faults: invalid sensor reading for 2 s (code 1), soil not wetter after a pulse (code 2: empty tank, blocked hose, broken pump), 24 s of pump time in one episode (code 3). The lock is saved in flash (`Preferences`) and only the button clears it. The LED blinks the code.
- The sketch is `arduino/plant_watering/plant_watering.ino` (the only copy; the simulation reads its constants). `src/books/esp32/plantWatering.js` is a port of its logic, `plantWorld.js` simulates soil, tank, pump and sensor faults, `plantParts.js` holds the parts list, connection table, fault table and electrical check that the notebook and the tests share.
- The notebook has controls for soil moisture, tank level, both thresholds, speed (1× to 200×), sensor wire off or shorted, pull-down fitted or not, noise, blocked hose and weak pump; six guided experiments; a moisture plot; and a calibration bench. In the 3D scene, click the red button (press) or the soil sensor (pull its cable).
- URL: `?book=esp32&open=1&lesson=2`.
- Checks that ran without hardware: `npm test` (`tests/plantWatering.test.mjs`: normal episode, hysteresis, filter and spikes, each fault, lock saved across a reboot, button debounce, `millis()` wrap, LED codes, pump never on outside `WATERING`, the page's guided scenarios, the electrical arithmetic and the data tables). The pages were also loaded in headless Chrome (software WebGL) with no console errors. **Not done:** the sketch has not been compiled with the ESP32 Arduino core or run on a board, and nothing was measured on real parts.
- **Needs real parts:** sensor calibration (`RAW_DRY`, `RAW_WET`), pump flow and current, the soak time for your pot, and the supply (use a 5 V charger of at least 1.5 A). Water must stay below and away from the electronics.

## ESP32 chapter 3: Smart Robotic Cat Feeder

- A 4-joint arm (base, shoulder, elbow, wrist; links 90/120/120/70 mm) scoops dry food from a hopper with a spoon and pours a measured ration into Pancho's plate. ESP32 → I²C (**IO21** SDA, **IO22** SCL) → PCA9685 (0x40, OE on **IO33** with a 2.2 kΩ pull-up) → 3 × MG996R + 2 × MG90S (wrist, access door). Load cell + HX711 (**IO19** DT, **IO18** SCK) under the plate, INA219 (0x45) on the servo supply for jam detection, IR break beam at the access window (**IO27**), lid switch (**IO26**), E-stop second contact (**IO25**), button (**IO13**), LED (**IO4**). Servo power: separate 6 V 5 A supply → E-stop main contact → 3 A slow fuse → INA219 → PCA9685 V+, common ground.
- States: `IDLE` (door open, arm off) → `DOOR_CLOSING` → `TARE` → `CYCLE` (to hopper, dip, scoop, lift, to plate, pour with the scale in the loop, weigh, more scoops if short, leftovers back to the hopper, home) → `DOOR_OPENING` → `IDLE`; `MANUAL` (joints or an x, y, z, pitch point through the inverse kinematics); `FAULT` on E-stop, lid, cat at the window, jam, bad load cell, empty hopper, unreachable target, blocked door or a cycle cut by a restart (`cycle` flag in flash). Recovery only by a long press with the cause gone (`RECOVERING`: empties the spoon, goes home slowly). Feeding needs a calibrated scale; a cooldown runs after every ration and every start.
- The sketch is `arduino/cat_feeder/cat_feeder.ino` (constants read by the page). `catFeeder.js` is a port of its logic, `armKinematics.js` the forward/inverse kinematics and move planning, `feederWorld.js` the physical model (servos, door, food mass, load cell, sensors, faults), `feederParts.js` the parts, pins, connections and the torque/current checks, `feederScene.js` the 3D scene (the arm is turned by the simulated servo positions).
- The notebook has automatic mode (ration, arm speed, feed, feed now, pause, stop, reset, hold button), tare and calibration with a 100 g weight, manual mode, a joint table (command, real servo, pulse), the mass balance, faults (cat, lid, E-stop, jam, door blocked, load cell off or frozen, power cut), six guided experiments and a spoon-height / weight plot. In the 3D scene click the E-stop, the blue button or Pancho.
- URL: `?book=esp32&open=1&lesson=3`.
- Checks that ran without hardware: `npm test` (`tests/catFeeder.test.mjs`: constants, pins, forward and inverse kinematics with the book's worked examples, impossible targets, waypoints inside the limits, torques, a full ration with mass conservation, speed limits, faults, no resume after a restart, cat presence, manual mode). The six guided experiments passed in headless Chrome (software WebGL) with no console errors. **Not done:** the sketch has not been compiled with the ESP32 core and the libraries, nothing was run on a board or measured on real parts.
- **Needs real parts:** servo pulse limits, zeros and directions, link masses (torque), spoon capacity, load cell calibration, the normal servo current (`JAM_MA`), the input levels of the beam, lid and E-stop. This is a teaching design, not a certified safe device: do not use it unattended with an animal before building and testing it.

## Adding a book

Create `src/books/<id>/index.js` with `{ id, name, board, title, blurb, eyebrow, coverColor, lessons, paintCover, coverTexture, canvasLabel }` and add it to `src/books/index.js`. A chapter may set `codeTab` (the code tab label, default `Python`). A book is built the first time it is chosen.

## Adding a lesson to the Raspberry Pi book

1. Create `src/lessons/lessonN.js` with the same shape as `lesson1.js` (metadata, `pageContent`, `textures()`, `views`, `viewButtons`, `create(env)` returning the runtime with `root`, `update`, `setPop`, `mountUI`, `stop`...).
2. Add its left page to `PAGE_CONTENT` in `src/pageContent.js` and append the lesson to `src/lessons/index.js`. `main.js`, `book.js` and the notebook shell need no changes.

## Files

- `src/books/`: book registry; `raspberry-pi/` (uses `src/lessons/`) and `esp32/` (`board.js` DevKitC model, `scene.js`, `chapter1.js`, `doorAlarm.js`, `plantScene.js`, `chapter2.js`, `plantWatering.js`, `plantWorld.js`, `plantParts.js`, `chapter3.js`, `catFeeder.js`, `armKinematics.js`, `feederWorld.js`, `feederParts.js`, `feederScene.js`, `pageContent.js`, `cover.js`)
- `arduino/door_alarm/door_alarm.ino`, `tests/doorAlarm.test.mjs`, `tests/arduino/` (compiles the door sketch with a mock `Arduino.h`)
- `arduino/plant_watering/plant_watering.ino`, `tests/plantWatering.test.mjs`
- `arduino/cat_feeder/cat_feeder.ino`, `tests/catFeeder.test.mjs`
- `tools/publish-public.ps1`: updates the public copy (see Publishing)
- `index.html`, `styles.css`: page and notebook UI
- `src/main.js`: scene, camera, input, page-turn state machine
- `src/book.js`: book, hinged cover, page leaf, curled corners
- `src/lessons/`: lesson registry, `lesson1.js`, `lesson2.js`, `lesson3.js` (notebook UI + simulation logic)
- `src/pwm.js`: PWM model (duty cycle, 100 Hz / slow motion) and the GPIO17 plot
- `src/traffic.js`: chapter 4 state machine (pure logic, pin table, reads the timing from the Python file)
- `src/circuitTraffic.js`: chapter 4 scene (3 LED branches + push button, from the shared parts)
- `src/popin.js`: pop-in animations shared by the scenes built from parts
- `tests/`: `traffic.test.mjs` and `pycheck.py` (run with `npm test`)
- `src/piModel.js`: detailed Raspberry Pi 5 model
- `src/circuit.js`: shared parts (breadboard, LED, resistor, wires) and the LED scene used by lessons 1 and 3
- `src/circuit2.js`: lesson 2 scene (push-button cutaway, logic/current flows)
- `src/pageContent.js`: written content and SVG schematics of each left page (feeds the 3D texture and Read page)
- `src/simulation.js`, `src/ui.js`, `src/textures.js` (large canvases are built once and shared between lessons)
- `python/led_blink.py`, `python/led_button.py`, `python/led_pwm.py`, `python/traffic_light.py`
- `server.mjs`: dependency-free static server

## Publishing (GitHub Pages)

This project (the private repo `cafka/raspberry-pi-interactive-book`) is the source. The public library is a **separate repo with its own history**, `cafka/interactive-electronics-books`, served by GitHub Pages from `main`, folder `/` (`.nojekyll` is included). There is no build step and every path is relative.

Only an allow-list is copied: `index.html`, `styles.css`, `server.mjs`, `package.json`, `README.md`, `.nojekyll`, `.gitignore`, `src/`, `vendor/`, `python/`, `arduino/`, `tests/`. `docs/`, `_test/` and anything not listed never leave this project.

To update the public copy after changing the project:

1. Test locally (`npm start`, `npm test`) and commit here.
2. Run `powershell -File tools/publish-public.ps1`. It refreshes the ignored folder `.publish/` (a clone of the public repo), copies the allow-list into it, shows the changes, then commits and pushes. `-DryRun` only copies and shows the changes. It needs `gh auth login` (or git credentials) with write access to the public repo.
3. Wait for the Pages build (Actions tab, `pages build and deployment`), then reload the public URL with Ctrl+F5.

## Credits and licenses

- **three.js r170** (`vendor/three.module.js`) is © 2010-2024 three.js authors, MIT License. See `vendor/LICENSE-three.txt`; the license header is kept inside the file.
- No other third-party code, fonts, images or textures are included: textures are drawn at runtime and the page uses system fonts.
- This is an independent educational project. It is not affiliated with or endorsed by Raspberry Pi Ltd. "Raspberry Pi" is a trademark of Raspberry Pi Ltd; the board and logo are simplified illustrations.
- The book's own code and text have no license chosen yet, so by default all rights are reserved by the author.