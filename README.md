# Interactive Electronics Books (3D)

A small library of interactive 3D books, one per board. The engine (page turn, notebook, reading mode, camera views) is shared. Each book has its own cover, board model, pin definition, chapters, circuits, explanations and code.

| Book | Chapters |
| --- | --- |
| **Raspberry Pi 5** (Python, `gpiozero`) | 1 Light an LED · 2 Control an LED with a Button · 3 LED Brightness with PWM · 4 Traffic Light with Pedestrian Button |
| **ESP32** (Arduino C++, ESP32-DevKitC with ESP32-WROOM-32E) | 1 Open Door Alarm (reed switch and magnet, LED, buzzer, 30 s timer) · 2 Smart Plant Watering (soil sensor, ADC, MOSFET and pump, state machine with fault lock) · 3 Smart Robotic Cat Feeder (4-DOF arm, PCA9685, load cell, kinematics, safety) |
| **Google Coral Dev Board Micro** (C++, coralmicro) | 1 How does Coral know someone is there? (camera, person detection on the Cortex-M7, User LED) |

Open the site and choose a book in the **Library**. The **Library** button (top left) goes back to it.

**Live library:** <https://cafka.github.io/interactive-electronics-books/>

Direct links: Raspberry Pi chapter 3 `?open=1&lesson=3` (or `?book=raspberry-pi&open=1&lesson=3`), ESP32 chapter 1 `?book=esp32&open=1&lesson=1`, ESP32 chapter 2 `?book=esp32&open=1&lesson=2`, ESP32 chapter 3 `?book=esp32&open=1&lesson=3`, Coral chapter 1 `?book=coral&open=1&lesson=1`.

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
- **Entry view:** every book opens directly on the open book ("Whole book" view), centred horizontally and vertically in the free area and as large as possible without cropping the pages. Choosing a book in the library opens it straight away.
- **Book size:** the shared "Whole book" view (and any chapter view marked `fit: 'book'`, such as the ESP32 "Whole project") computes the camera distance and shifts its target so the open book and the parts built on it fill and are centred in the free area: the window minus the notebook, the toolbars and a small margin. It is recomputed on resize, and turning the device frames the view again even after a manual camera move.
- **Layouts**, chosen from the real window size (`updateLayoutMode()` in `src/main.js`, body classes `tabbed` / `tabbed-rail`):
  - **Phones (width < 600 px or height < 500 px): three tabs, Book / Experiment / Notebook**, at the bottom in portrait and as a rail on the left in landscape. **Book** shows the chapter's page flat and centred (the left page view, with − / + zoom and drag). **Experiment** shows the 3D project as large as the screen allows, with one top toolbar: Library, a compact camera selector, Play / Pause and Labels. **Notebook** shows the whole notebook (simulation controls, code, how it works, pager and guide download) with vertical scrolling. Switching tabs stops, rebuilds or resets nothing: the chapter, the page and the running simulation are kept. Code lines wrap under their line numbers and tables shrink, so nothing scrolls sideways.
  - **Tablets and desktop:** the notebook and the book side by side (column on the right on wide screens, bottom sheet on narrow portrait screens, slimmer column on narrow landscape screens). The camera views are buttons when they fit in one row, otherwise a compact selector.
  - On touch screens every control is at least 44 × 44 px. The disc around a page corner that turns the page is at most a tenth of the book's width, so parts near a corner can still be tapped on a phone.
- **Floating labels** (the dark tags; the text printed on the 3D boards is part of the models) are **all hidden by default** and never appear all at once by themselves. With a mouse, pointing at a part (or near it) shows that part's label only, and moving away hides it. On a touch screen, a tap on a part shows its label; a tap on another part moves it there, and a tap on empty space hides it. A drag that rotates the camera never shows a label, even when it starts on a part. **Show labels / Hide labels** shows or hides all of them on request; when shown, as many as fit without overlapping each other, the notebook, the toolbars or the anchor points of other parts are drawn, and the rest shrink to their dot. This works for every chapter, using each chapter's label list in its order of priority.
- **Expand notebook** (notebook header): the notebook fills almost the whole screen with larger text, full-width tables, diagrams and code, and vertical scrolling. **Return to book** (or Esc) goes back. The chapter, page, tab and the running simulation are kept (it is not rebuilt).
- **Download experiment guide** (notebook header; on phones in the Notebook tab): downloads a PDF of the current chapter, named `Inside-the-Circuit_<book>_Chapter-<n>_<title>.pdf`. It is built in the browser from the chapter's own content (the left page, the Code and How it works tabs, the guided experiments and every reference link) plus a picture of the whole 3D book, so nothing is written twice. Sections: objective, materials, wiring diagram, steps, source code (wrapped, numbered, coloured), how it works, expected results, exercises, troubleshooting, warnings and references, when the chapter has them. Diagrams are drawn into images; text stays selectable; links are clickable. While it works the button says "Preparing the PDF…", then a notice confirms the download and offers **Open the PDF**. Nothing is sent anywhere. Code: `src/guide.js` (content), `src/guidePdf.js` (layout), `src/pdf.js` (PDF writer, no dependency, tested by `tests/pdf.test.mjs`).
- **Read page** (notebook header): shows the left page as selectable HTML at full size, with the simulation stopped. **Back to the book** (or Esc) returns to the same chapter and camera. The text and schematics come from `src/pageContent.js`, the same source that paints the 3D page.
- Turning a page (or reading) stops the current chapter's program and electrical animations, folds the 3D circuit away, turns the page leaf, then builds the new chapter's circuit and swaps the notebook (simulation, code, explanations).
- On narrow tablet screens the notebook is a bottom sheet that scrolls as a whole (the tabs stay pinned).

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

## Coral Dev Board Micro, chapter 1: How does Coral know someone is there?

- For a reader who has done the LED lesson. Four steps in the notebook: **predict** which LED changes when someone walks into the image, **experiment** (drag the person with the mouse or a finger, or use *Step into frame* / *Step out of frame*), **understand** (tap the camera, the Cortex-M7, the Camera LED, the User LED or the Edge TPU), **check** (“the camera is on and the User LED is off: what can you say?”, then try framing and a dim room).
- The board is Google's official CAD model (`google-coral/mechanicals`, `dev_board_micro/Dev Board Micro.step`, Apache-2.0), converted offline with OpenCascade (`occt-import-js`) into `src/books/coral/model/` (positions quantized to 1/900 mm, grouped by part; the licence travels with it). It is shown life size, USB-C down. The CAD model has no printed markings and CAD default colours; the green of the PCB, the metal shield and the LED lenses are retouched.
- A panel in the scene shows the image the camera would capture, rendered from the lens with the datasheet's 110° diagonal field of view. The notebook shows the 96 × 96 grayscale input of the model.
- What is real: board geometry and part positions, camera facts (Himax HM01B0, 324 × 324 px, 110° diagonal), LED roles (Camera LED green, on during capture; User LED green, off by default), and the decision of the example code (`person_score > no_person_score` → `LedSet(Led::kUser, …)`; model on the Cortex-M7, not the Edge TPU). What is simulated: the detector (it scores how much of the figure is in the frame and the light level, it is not a neural network) and the cycle timing. Sources are listed in the chapter (How it works) and in `src/books/coral/presence.js`.
- Files: `src/books/coral/` (`index.js`, `chapter1.js`, `presenceScene.js`, `presence.js`, `boardModel.js`, `pageContent.js`, `cover.js`, `model/`), `tests/coralPresence.test.mjs`.
- Checks that ran without hardware: `npm test` (`tests/coralPresence.test.mjs`: facts, field of view, pinhole projection, detector thresholds, dark room, cycle order and LED rule, integrity of the converted model, positions of the camera and LEDs against the official drawing). The chapter was also driven in headless Chrome (software WebGL), desktop and mobile emulation. **Not done:** nothing was run on a real Dev Board Micro.

## Coral Dev Board Micro, chapter 2: Wake up the AI: Intelligent pose detection

- Based on the official app **`apps/multicore_model_cascade`** of `google-coral/coralmicro`. It is an app, not one of the `examples/`. Before the chapter was written, these were read in the repository: its README, `multicore_model_cascade_cm4.cc`, `multicore_model_cascade_cm7.cc`, the host client `multicore_model_cascade.py`, `CMakeLists.txt`, `requirements.txt`, and `libs/tensorflow/posenet.h`, `libs/base/led.h`, `libs/camera/camera.h`. The guide "Get started with the Dev Board Micro" (section 6, "Try multi-core model cascading") was read too. The app is written for this board.
- What the chapter teaches, as the source runs it:
  - The **Cortex-M4** runs `person_detect_model.tflite` (TensorFlow Lite for Microcontrollers, 96 × 96 grayscale, `kY8`, rotated 270°), and after every frame sets `LedSet(Led::kUser, person_detected)`. The orange Status LED is turned on once the model is loaded.
  - On "person", the M4 disables the camera, sends an IPC message and suspends itself.
  - The **Cortex-M7** opens the **Edge TPU** (`PerformanceMode::kMax`) at start. When woken it captures 324 × 324 RGB frames, sends each one as JPEG (quality 75), and runs `posenet_mobilenet_v1_075_324_324_16_quant_decoder_edgetpu.tflite` (Edge TPU operator plus PoseNet decoder operator). Poses scoring at least 0.4 go out as JSON, with 17 keypoints each, on TCP port 27000.
  - Once a second the M7 checks; after **5 s without a pose** it hands back to the M4.
  - The Python client draws keypoints scoring at least 0.2 and the 19 lines between them. While the board is back on the M4, it shows "Waiting for Person Detection".
- **Notebook:**
  - *Simulate*: the four LEDs, the state of each core and the Edge TPU, the 5 s timer. Four steps: predict which part starts working; experiment (walk in and out, seven poses, or automatic pose changes); understand (parts and the nine steps of the cascade); check (why the User LED stays on).
  - *C++*: the two official programs, shortened with `// ...`, and what the code does. Then materials, environment and dependencies, getting the code, building, flashing, running, seeing the results (client and serial console), the Wi-Fi, Ethernet and demo builds, and troubleshooting.
  - *How it works*: checked facts, the 17 keypoints, what is real and what is simulated, the link with chapter 1, and the sources.
- **Discrepancies found in the official material**, stated on the page:
  - The README says the white Edge TPU LED turns on when the M7 starts the pose model, but the app's code never calls `LedSet(Led::kTpu)`, and the M7 opens the Edge TPU once at start. The page lights the LED during the pose phase, as the README describes; this was not checked on a board.
  - In the demo build, the M4 timer is 10 s, while its comment says 5 s.
  - The guide's requirements list Linux or macOS. The app's README says the USB variant works with Linux and Windows only.
- **Simulated:** both models.
  - The person detector is the stand-in of chapter 1.
  - A keypoint counts as found when its point on the figure falls inside the camera's frame; occlusion is not modelled.
  - A pose is reported when the nose and both shoulders are in the frame and the room is lit.
  - No pose or keypoint scores, frame rates or latencies are computed or shown.
  - The step timing is slowed down. The two M7 tasks run one after the other here, but in parallel on the board.
  - The 5 s and 1 s timers are the app's own.
- **Scene:** the official CAD model, shared with chapter 1 (`buildPresenceScene({ posable, panel: 'client', cascade })`; chapter 1 keeps the defaults). It adds:
  - a figure with elbows and knees, and markers at the 17 keypoints;
  - the routes camera → MCU → Edge TPU → MCU → USB;
  - the white and orange LEDs;
  - a copy of the host client window, which shows only the frames the board sends, with the pose drawn in the client's colours.
- **URL:** `?book=coral&open=1&lesson=2`.
- **Files:** `src/books/coral/chapter2.js`, `cascade.js` (pure logic, facts, keypoints and edges), plus the additions to `presenceScene.js` and `pageContent.js`. Tests: `tests/coralCascade.test.mjs` and `tests/browser/cdp-cascade.mjs`.
- **Checks that ran without hardware:**
  - `npm test` runs `tests/coralCascade.test.mjs`. It checks the facts against the source, the 17 keypoints and 19 edges, and the stand-in pose rule. It also checks the boot messages, the hand-over and its console messages in the source's order, and the User LED kept on while the M7 works. Then the return to the M4 between 5 s and 6 s after the last pose, the "Poses: N" logging rule, and that the commands and code lines shown are the official ones.
  - The chapter ran in headless Chrome with software WebGL, using `tests/browser/cdp-cascade.mjs`. It covers start-up, the hand-over, the pose with 15 of 17 keypoints found (the ankles are below the frame), arms up and knee up, the return to the M4, the User LED off, the "Waiting" text, the notebook, the guide sections and page errors.
    - At 390 px, 15 of 15 checks passed.
    - On desktop, 14 of 15 passed. The one failure was a bug in the test (it read the guide through a Promise), which was then fixed. On desktop the guide PDF was checked by the layout suite.
  - `tests/browser/cdp-layout.mjs` for Coral, chapters 1 and 2, passed 44 of 44 checks at 390 px and 30 of 30 on desktop. The chapter 2 guide PDF downloaded valid: 9 pages, with the 3D picture and the diagram.
  - **Not done:** nothing was compiled, flashed or run on a real Dev Board Micro, and the commands were not run.

## Coral Dev Board Micro, chapter 3: Listening for trouble: acoustic events with local AI

- Based on the official example **`examples/classify_audio`** of `google-coral/coralmicro`. Before the chapter was written, these were read: `classify_audio.cc`, its `CMakeLists.txt`, `libs/tensorflow/audio_models.h` / `.cc`, `libs/tensorflow/classification.h` / `.cc`, `libs/audio/audio_driver.h`, `libs/audio/audio_service.h`, and the YAMNet class map (`tensorflow/models`, `research/audioset/yamnet/yamnet_class_map.csv`).
- **What the source does** (and what the chapter teaches):
  - The on-board **PDM microphone** is read through DMA at 16 kHz (the driver also offers 48 kHz), 2 buffers of 50 ms, the first 150 ms dropped. `LatestSamples` keeps the latest 975 ms; the microphone never stops.
  - The program is built for the **Cortex-M7** only (`add_executable_m7`). The M7 computes the features with the TensorFlow Lite Micro audio frontend: 15 600 samples → 96 frames × 64 bands (25 ms frames, 10 ms step, 125–7500 Hz).
  - **YAMNet runs on the Edge TPU** by default (`yamnet_spectra_in_edgetpu.tflite`; resolver: Quantize, Dequantize, Edge TPU operator). With `set(YAMNET_CPU true)` in `CMakeLists.txt` it runs on the M7 (`yamnet_spectra_in.tflite`, 9 TFLM operators). So an audio model on the Edge TPU is supported here because coralmicro ships this compiled model; the features themselves are not part of the model.
  - `GetClassificationResults(interpreter, 0.3, 5)` and `FormatClassificationOutput` print "Results:" and "id: score" lines, or "No results". Only the Status LED is used. The example does nothing else with the results.
  - The Edge TPU build waits 975 ms after each window ("rate limit"). Because the microphone keeps recording, the next window is the audio of that wait, and **the audio heard while the board computes is in no window**. The CPU build reads again at once (windows overlap).
- **Discrepancies and doubts found in the source**, stated on the page:
  - The source comment says `flashtool.py -e yamnet`; the project folder is `classify_audio`, so the page uses `python3 scripts/flashtool.py -e classify_audio`.
  - The test file `/models/yamnet_test_audio.bin` is copied into the input tensor, but `run()` then fills that tensor from `audio_input`, still all zeros at that point. Reading of the source only, not checked on a board.
- **Not in the official material, so built as a clearly labelled teaching extension** (page, code tab and console all say "extension, not part of coralmicro"): a threshold per alert class, persistence (k of n windows), a cooldown, the User LED for 2 s after an alert, and an event log. Its C++ (`CheckAlerts()`) uses the coralmicro API (`GetClassificationResults`, `TimerMillis`, `LedSet`) but **was not compiled**.
- **Simulated:**
  - The sounds are synthesised (two claps, knocks, glass breaking, a smoke alarm; and look-alikes: door slam, dishes, microwave beeps, speech, music), with three rooms (quiet, fan, TV) and two distances (1 m and 4 m; weaker, no echo).
  - The features are computed for real in the page with the example's settings. They are close to, not equal to, the TFLM frontend's numbers.
  - The classifier is a small hand-written scorer on a few measurements (loudness, length, attack, bursts, frequency balance, tonality, steadiness). **It is not YAMNet**, its scores are not YAMNet scores, and nothing here says how well YAMNet or a board would do. The printed class ids are real YAMNet ids.
  - The time the board needs per window is an assumption (default 250 ms, slider 100–900 ms); the board prints its real "total".
- **Notebook:**
  - *Simulate*: Status LED, User LED (extension), the state of the microphone, the M7 and the Edge TPU, a timeline of the last 8 s (sounds, windows, audio in no window). Four steps: predict (do clinking dishes set off the glass alert?); experiment (9 sounds, distance, room, the spectrogram and the scores of each window, what the example prints); understand (parts, the five stages, Edge TPU / CPU build, the exercise without the wait, the assumed computing time); check (rules per class, event log with correct / false alarm / missed and the reason, a test bench and a threshold sweep, a quiz on why this is not a security system).
  - *C++*: the official example shortened with `// ...`, the extension, what the code does, the YAMNet ids each alert reads, materials, environment, get the code, build, flash, run and see the results, the CPU build, 6 exercises, troubleshooting.
  - *How it works*: checked facts, whether an audio model can run on the Edge TPU, real against simulated, "What it cannot do: this is not a security system", sources.
- **Test bench results** (this page's synthetic sounds and stand-in only; 54 cases, 24 that should raise an alert; windows back to back):
  - Default rules (threshold 0.5, alarm 2 of 3 windows, cooldowns 2–6 s): 21 found, 5 false alarms, 3 missed. False alarms: dishes → glass (fan 1 m, TV 1 m), door slam → knock (TV 1 m and 4 m), speech → knock (quiet 1 m). Missed: clap, knock and glass at 4 m with the fan.
  - One threshold for all classes: 0.2 → 23 found / 18 false alarms / 1 missed; 0.3 → 22 / 11 / 2; 0.4 → 22 / 7 / 2; 0.5 → 21 / 5 / 3; 0.6 → 20 / 1 / 4; 0.7 → 16 / 0 / 8; 0.8 → 13 / 0 / 11. No threshold gives zero of both.
- **Limits:** a demonstration, not a security system. Nobody measured how reliably YAMNet on this board hears breaking glass, knocks or alarms, or how often it raises false alarms. Not a replacement for a certified smoke or fire alarm.
- **URL:** `?book=coral&open=1&lesson=3`.
- **Files:** `src/books/coral/chapter3.js`, `acoustic.js` (pure logic: facts, sounds, features, stand-in classifier, alert rules, monitor, bench), `acousticScene.js` (scene). `presenceScene.js` now exports `buildBoardOnStand()` and `centreAssembly()`, shared with chapters 1 and 2; `boardModel.js` gained the microphone position (the CAD model's `mic` part). Left page in `pageContent.js`. Tests: `tests/coralAcoustic.test.mjs`, `tests/browser/cdp-acoustic.mjs`; `cdp-layout.mjs` now includes Coral chapter 3.
- **Checks that ran without hardware** (27 Nov 2026, headless Chrome with software WebGL, one run at a time):
  - `node --test tests/coralAcoustic.test.mjs`: 14 of 14 pass. It covers the facts against the source, the YAMNet ids, the 96 × 64 features, the deterministic sounds, the console format, the bench numbers the page quotes, the threshold trade-off, the alert rules, the board loop timing, a short sound lost between windows on the Edge TPU build and found without the wait or on the CPU build, the User LED on for 2 s after an alert, and the official strings in the chapter (no User LED in the official listing).
  - `npm test`: 126 tests, 125 pass, 0 fail, 1 skipped (the Python comparison, when Python 3 is not installed).
  - `tests/browser/cdp-acoustic.mjs` (start-up, silence, a knock alert logged as correct, the `[extension]` console line, score bars, the smoke alarm with persistence, CPU build, the exercise without the wait, 900 ms per window, threshold sweep and bench with the numbers the page quotes, part selection, both code listings, the guide sections, page errors): 21 of 21 on desktop and 21 of 21 at 390 px. The first desktop run failed one check (the Simulate tab 2 px wider than the notebook). The cause, measured in the page: the five-column pipeline and the spectrogram + scores row did not fit the desktop notebook's width. `.pipe.five` now uses three columns and `.spec-view` wraps the scores under the spectrogram when there is no room; after that the tab measured 366 px of 366, and both runs passed.
  - The layout suite below ran before that CSS fix (it only touches chapter 3's `.pipe.five`, `.spec-view` and `.score-row.wide`); it was not run again afterwards.
  - `tests/browser/cdp-layout.mjs … coral pdf` (Coral chapters 1, 2 and 3): 66 of 66 at 390 px and 45 of 45 on desktop. Chapters 1 and 2 show no regression after the shared stand was moved into `buildBoardOnStand()`. The guide PDFs downloaded valid: chapter 1 4 pages, chapter 2 9 pages, chapter 3 9 pages, each with 2 pictures and a valid cross-reference table.
  - `tests/browser/pdf-open.mjs`: the three PDFs downloaded at 390 px open in Chrome's PDF viewer as `application/pdf`; the chapter 3 screenshot was checked (9 pages, cover, objective, materials, the signal path).
  - **Not done:** nothing was compiled, flashed or run on a real board, the commands were not run, the extension's C++ was not compiled, and no real sound was recorded.

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
- `src/guide.js`: the experiment guide content (shared by every book), tested by `tests/guide.test.mjs`; `src/guidePdf.js` lays it out as a PDF with `src/pdf.js` (tested by `tests/pdf.test.mjs`)
- `tests/browser/`: browser checks of the engine on every screen size. Run `npm start`, then `powershell -File tests/browser/run-all.ps1` (Node.js and Chrome needed; `CHROME` and `BASE_URL` may be set). `cdp-layout.mjs` checks one device, `summarize.mjs` adds up the results, and `pdf-open.mjs` opens the downloaded guides in Chrome's PDF viewer. The output goes to `tests/browser/out/`, which git ignores.
- `src/books/coral/`: Coral Dev Board Micro book (`boardModel.js` loads `model/dev_board_micro.bin` + `.json`, converted from the official STEP; `presence.js` detector logic; `presenceScene.js`; `chapter1.js`; `pageContent.js`; `cover.js`), tested by `tests/coralPresence.test.mjs`
- `python/led_blink.py`, `python/led_button.py`, `python/led_pwm.py`, `python/traffic_light.py`
- `server.mjs`: dependency-free static server

## Integrating this branch

Branch `backup/engine-ux-wip` contains everything on `main` plus the ESP32 chapters 2 and 3, the Coral Dev Board Micro book and the engine UX changes (labels, entry view and auto framing, Expand notebook, experiment guide). It was not merged into `main`.

1. `git fetch origin && git checkout backup/engine-ux-wip`
2. Requirements: Node.js 18+ and Chrome. There is no `npm install` and no build step. three.js is vendored in `vendor/`. The Coral model is committed as `.bin` + `.json` (`.gitattributes` marks it binary).
3. `npm test` should give 126 tests: 125 pass and 1 is skipped when Python 3 is not installed (the `traffic_light.py` comparison).
4. `npm start`, then open <http://127.0.0.1:5173/>. Useful URLs: `?book=raspberry-pi&open=1&lesson=1`, `?book=esp32&open=1&lesson=2`, `?book=coral&open=1&lesson=1`, `?book=coral&open=1&lesson=3`.
5. To merge: open a pull request from `backup/engine-ux-wip` into `main` and run the manual checks below on real devices first.

Test hooks for automated browsers are on `window.book3d`: `layout()` (free area, content box, layout mode, insets), `tab` / `setTab(name)` (phones), `viewName`, `labelsShown`, `selectedLabel`, `setExpanded(bool)`, `expanded`, `guide()` (returns `{ html, fileName }`), `downloadGuide()`, `lastGuide`, `project(x, y, z)`, `snapRig()`, `debugPointer`.

### Pending tests and known issues

**Latest unit tests (27 Nov 2026, with Coral chapter 3):** `npm test`, 126 tests, 125 pass, 0 fail, 1 skipped. Coral browser results are in the chapter sections above. The full `run-all.ps1` suite below was not run again for chapter 3.

**Final results (26 Nov 2026):**

- `npm test`: 101 tests, 100 pass, 0 fail, 1 skipped (the Python comparison, when Python 3 is not installed).
- Browser checks (`tests/browser/run-all.ps1`): **447 checks, 447 pass, 0 fail**. They ran in headless Chrome 158 with software WebGL, on emulated screens one at a time, for Raspberry Pi 5 ch. 1, ESP32 ch. 2 and Coral ch. 1. The screens were:
  - phone widths 320, 360, 390 and 430 px in portrait, each also turned to landscape;
  - a phone in landscape (844 × 390);
  - tablets (768 × 1024 and 1024 × 768), each also turned;
  - desktop (1400 × 900).
- What the browser checks cover:
  - the layout chosen for each screen;
  - the entry view: the whole open book, centred and not cut;
  - no overlapping or cut controls, no control over the book, no horizontal scroll, touch targets of 44 px;
  - labels: hidden at first; one label by hover or tap; moved by a tap on another part; hidden by empty space or by moving away; fully on screen; no label from a camera drag; no accidental page turn;
  - the three phone tabs: the page centred (fitted to the width in landscape), the notebook scrolling without horizontal overflow, the simulation and the chapter kept;
  - reframing after rotation.
- A real download of the guide PDF on desktop and at 390 px, for each book:
  - Raspberry Pi 5 ch. 1: 3 pages;
  - ESP32 ch. 2: 13 pages;
  - Coral ch. 1: 4 pages.

  Each file has a valid cross-reference table, the 3D snapshot and diagrams as pictures, the sections and the code, and the notice is shown. The three desktop files were opened in Chrome's PDF viewer (`application/pdf`). The screenshots of every step were reviewed.

- **Not done:** real phones and tablets, Firefox and Safari (iOS Safari may open the PDF instead of saving it; the notice's "Open the PDF" link covers that), screen readers.
- **Phone portrait, Experiment tab:** the whole book is as wide as the screen, so the 3D project is small. The camera selector gives the chapter's closer views.
- **Simulated touch:** taps were sent by Chrome's touch emulation with explicit timestamps (on software WebGL a frame takes about a second and a late release would count as a long press).
- **README, Publishing:** the section below describes the private source project. `tools/publish-public.ps1` and `docs/` are not part of this repository.

## Publishing (GitHub Pages)

This project (the private repo `cafka/raspberry-pi-interactive-book`) is the source. The public library is a **separate repo with its own history**, `cafka/interactive-electronics-books`, served by GitHub Pages from `main`, folder `/` (`.nojekyll` is included). There is no build step and every path is relative.

Only an allow-list is copied: `index.html`, `styles.css`, `server.mjs`, `package.json`, `README.md`, `.nojekyll`, `.gitignore`, `src/`, `vendor/`, `python/`, `arduino/`, `tests/`. `docs/`, `_test/` and anything not listed never leave this project.

To update the public copy after changing the project:

1. Test locally (`npm start`, `npm test`) and commit here.
2. Run `powershell -File tools/publish-public.ps1`. It refreshes the ignored folder `.publish/` (a clone of the public repo), copies the allow-list into it, shows the changes, then commits and pushes. `-DryRun` only copies and shows the changes. It needs `gh auth login` (or git credentials) with write access to the public repo.
3. Wait for the Pages build (Actions tab, `pages build and deployment`), then reload the public URL with Ctrl+F5.

## Credits and licenses

- **three.js r170** (`vendor/three.module.js`) is © 2010-2024 three.js authors, MIT License. See `vendor/LICENSE-three.txt`; the license header is kept inside the file.
- **Coral Dev Board Micro 3D model** (`src/books/coral/model/`) is converted from the official STEP file of `google-coral/mechanicals`, Apache License 2.0. See `src/books/coral/model/LICENSE-coral-mechanicals.txt`.
- No other third-party code, fonts, images or textures are included: textures are drawn at runtime and the page uses system fonts.
- This is an independent educational project. It is not affiliated with or endorsed by Raspberry Pi Ltd. "Raspberry Pi" is a trademark of Raspberry Pi Ltd; the board and logo are simplified illustrations.
- The book's own code and text have no license chosen yet, so by default all rights are reserved by the author.