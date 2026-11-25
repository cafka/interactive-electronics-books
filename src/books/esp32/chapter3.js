import { buildFeederScene } from './feederScene.js';
import { leftPageTexture, rightPageTexture } from '../../textures.js';
import { ESP32_FEEDER_PAGE } from './pageContent.js';
import { CatFeeder, parseFeederSettings, armOf, waypoints, FAULT, FAULT_TEXT } from './catFeeder.js';
import { FeederWorld, WORLD } from './feederWorld.js';
import { forward, inverse, sampleMove } from './armKinematics.js';
import { PARTS, PIN_TABLE, CONNECTIONS, SERVOS, MASSES, feederChecks } from './feederParts.js';
import { $, $$, escapeHtml, renderCode, bindCopy, createConsole, renderSteps } from '../../ui.js';
import { IDE_INTRO } from './ide.js';

/*
 * ESP32 chapter 3: a robotic cat feeder for Pancho.
 *   scene   src/books/esp32/feederScene.js   (chamber, door, beam, hopper, plate on a load cell, 4-joint arm, Pancho, electronics)
 *   logic   src/books/esp32/catFeeder.js     (a port of arduino/cat_feeder/cat_feeder.ino; constants read from it)
 *   kinem.  src/books/esp32/armKinematics.js (forward and inverse kinematics, move planning)
 *   world   src/books/esp32/feederWorld.js   (servos, food, load cell, sensors, faults: what the sketch cannot see)
 *   data    src/books/esp32/feederParts.js   (parts, pins, connections, torque and current checks)
 *   page    src/books/esp32/pageContent.js   (ESP32_FEEDER_PAGE)
 * As in chapters 1 and 2 there are no timers: loop() runs once per simulated millisecond from update(dt), and the
 * world advances every 10 simulated ms, exactly as in tests/catFeeder.test.mjs. The arm in the scene is turned by the
 * world's servo positions and the food is moved only by the world's mass model, never by a separate animation.
 */

const viewButtons = [
  ['circuit', 'Whole project'], ['assembly', 'Assembly'], ['leftpage', 'Left page'], ['arm', 'Arm'],
  ['hopper', 'Hopper'], ['plate', 'Plate'], ['window', 'Door + Pancho'], ['electronics', 'Electronics'], ['pins', 'ESP32 pins'],
];

const STEPS = [
  { title: 'A closed chamber and a door', text: 'The arm works in its own clear box. Pancho reaches the plate through a window with a flap door. The program closes the door before anything moves and switches the servo outputs off before it opens it again: the arm and the cat are never in the same space.', view: 'window' },
  { title: 'PWM: one pulse every 20 ms', text: 'A hobby servo reads the width of a pulse sent 50 times a second: about 500 µs for one end, 1500 µs for the middle, 2500 µs for the other end. The PCA9685 makes these pulses for 16 channels from I²C commands, so the ESP32 only says “channel 1: 1722 µs”.', view: 'electronics' },
  { title: 'Joint angles, limits and the servo zero', text: 'The program thinks in joint angles (q0 base, q1 shoulder, q2 elbow, q3 wrist). Each servo angle is ZERO + DIR × joint, clamped to the joint limits, which are set so no link hits the frame. Calibrating means finding ZERO and DIR for your own servos and horns.', view: 'arm' },
  { title: 'Forward kinematics', text: 'From the four angles to the spoon: turn the arm by q0, then add three links in the vertical plane (120, 120 and 70 mm) at angles q1, q1+q2 and q1+q2+q3. The last sum is the spoon pitch: 0 is level, negative tips it to pour.', view: 'arm' },
  { title: 'Inverse kinematics', text: 'From a spoon position and pitch back to the angles: step back 70 mm along the spoon to the wrist, use the law of cosines on the two 120 mm links for the elbow, then the shoulder and the wrist follow. A target too far, too close or past a limit is refused, and the arm does not move.', view: 'arm' },
  { title: 'Scoop', text: 'The spoon goes into the kibble tilted down on the far side of the hopper, drags toward the base while it turns level, and lifts. How much it takes depends on the food: the scale, not the spoon, decides how many scoops are needed.', view: 'hopper' },
  { title: 'Pour with the scale in the loop', text: 'Over the plate the wrist tips the spoon 4° every 250 ms. After each step the program reads the load cell; when the plate holds the ration minus 1 g (food still falling) it turns the spoon back up. What is left in the spoon goes back to the hopper.', view: 'plate' },
  { title: 'Weigh, correct, limit', text: 'With the spoon away, the program waits for a stable reading. Short of the ration: one more scoop, at most 6. Two scoops that add almost nothing mean an empty hopper: fault. Far over the ration: it reports it (it cannot take food back out of the plate).', view: 'plate' },
  { title: 'Faults stop the arm, the door stays shut', text: 'E-stop, the lid, Pancho at the window, a jam (too much servo current), a bad load cell reading or a power cut during a cycle: the arm gets no more pulses and the door servo keeps the door closed. Nothing starts again until the cause is gone and the tutor holds the button for 2 s.', view: 'window' },
];

const SPEEDS = [1, 2, 5, 20];
const GUIDED_SPEED = 20;
const JOINTS = ['q0 base', 'q1 shoulder', 'q2 elbow', 'q3 wrist'];
const BLOCKER_TEXT = {
  estop: 'the E-stop is pressed',
  lid: 'the service lid is open',
  beam: 'Pancho is at the window',
  scale: 'no valid load cell reading',
  calibrated: 'the scale is not calibrated yet (tare, then a known weight)',
  plateNotFull: 'the plate already holds food',
  cooldown: 'the cooldown is running (use “Feed now” to override)',
  noFault: 'a fault must be reset first',
};
const IK_TEXT = { 'out-of-reach': 'too far: outside the reach of the arm', 'too-close': 'too close to the base', 'joint-limit': 'it would need a joint past its limit', 'not-in-manual': 'enter manual mode first' };
const BANNER = { IDLE: 'closed', DOOR_CLOSING: 'watering', TARE: 'watering', CYCLE: 'watering', DOOR_OPENING: 'watering', MANUAL: 'soaking', RECOVERING: 'soaking', FAULT: 'alarm', OFF: 'stopped' };
const fmtS = (ms) => `${(ms / 1000).toFixed(1)} s`;
const g1 = (x) => `${x.toFixed(1)} g`;
const esc = (s) => escapeHtml(String(s));
const deg = (x) => `${x.toFixed(1)}°`;

const simHtml = (s) => `
  <p class="note sim-note"><b>Web simulation.</b> Everything here moves only because the simulated program commands the simulated servos. Click the E-stop, the blue button or Pancho in the 3D scene. Nothing here touches real hardware.</p>

  <div class="alarm-box closed" id="cfBox">
    <div class="al-main" id="cfMain" role="status">Waiting</div>
    <div class="al-sub" id="cfSub"></div>
    <div class="al-bar" aria-hidden="true"><i id="cfFill"></i></div>
    <div class="al-time"><span id="cfLeft"></span><span id="cfTotal"></span></div>
  </div>

  <div class="status-row four">
    <div class="chip" id="chState"><span>State · phase</span><b>–</b></div>
    <div class="chip" id="chScale"><span>Scale (program)</span><b>–</b></div>
    <div class="chip" id="chPlate"><span>Plate (real)</span><b>–</b></div>
    <div class="chip" id="chCur"><span>Servo current</span><b>–</b></div>
  </div>

  <h3>Board</h3>
  <p class="prog-state" id="progState"></p>
  <div class="btn-row three">
    <button id="btnRun" class="btn accent">▶ Run</button>
    <button id="btnOff" class="btn">■ Stop simulation</button>
    <button id="btnPower" class="btn" title="The 6 V supply and the USB go off for 2 s, then come back">⏻ Power cut (2 s)</button>
  </div>
  <div class="speed-row" role="group" aria-label="Simulation speed">
    <span>Speed</span>
    ${SPEEDS.map((v) => `<button class="chip-btn speed" data-speed="${v}" aria-pressed="false">${v}×</button>`).join('')}
    <b id="speedInfo"></b>
  </div>
  <p class="note" id="clockInfo"></p>

  <h3>Automatic mode</h3>
  <div class="slider-ctl">
    <label for="rationRange">Ration (set by the tutor): <b id="rationVal"></b></label>
    <input type="range" id="rationRange" min="${s.rationMinG}" max="${s.rationMaxG}" step="1" value="${s.rationDefaultG}">
    <label for="armSpeed">Arm speed (of the limits in the sketch): <b id="armSpeedVal"></b></label>
    <input type="range" id="armSpeed" min="20" max="100" step="5" value="100">
  </div>
  <p class="note">There is no right ration for every cat. Ask your vet; the sketch accepts ${s.rationMinG} to ${s.rationMaxG} g per ration and waits ${s.cooldownMs / 60000} min between rations.</p>
  <div class="btn-row three">
    <button id="btnFeed" class="btn accent" title="Short press of the button: respects the cooldown">Feed</button>
    <button id="btnFeedNow" class="btn" title="Long press of the button: overrides the cooldown">Feed now</button>
    <button id="btnPause" class="btn">❚❚ Pause arm</button>
  </div>
  <div class="btn-row three">
    <button id="btnStopArm" class="btn">Stop arm</button>
    <button id="btnReset" class="btn" title="Long press of the button after a fault">Reset fault</button>
    <button id="btnHold" class="btn hold-btn">Hold: button IO${s.buttonPin}</button>
  </div>
  <p class="note" id="blockInfo"></p>

  <h3>Scale</h3>
  <div class="btn-row three">
    <button id="btnTare" class="btn">Tare (empty plate)</button>
    <button id="btnCal" class="btn">Calibrate with 100 g</button>
    <label class="opt-inline"><input type="checkbox" id="optWeight"> 100 g weight on the plate</label>
  </div>
  <p class="note" id="calOut"></p>

  <h3>Manual mode</h3>
  <div class="btn-row"><button id="btnManual" class="btn">Enter manual mode</button><button id="btnLeave" class="btn">Leave (park, open the door)</button></div>
  <div class="slider-ctl" id="jointSliders">
    ${JOINTS.map((n, j) => {
      const lim = [[s.q0Min, s.q0Max], [s.q1Min, s.q1Max], [s.q2Min, s.q2Max], [s.q3Min, s.q3Max]][j];
      return `<label for="jq${j}">${n} (${lim[0]}° to ${lim[1]}°): <b id="jv${j}"></b></label><input type="range" id="jq${j}" min="${lim[0]}" max="${lim[1]}" step="1" value="0">`;
    }).join('')}
  </div>
  <div class="xyz-row">
    <label>x <input type="number" id="px" value="200" step="5"></label>
    <label>y <input type="number" id="py" value="0" step="5"></label>
    <label>z <input type="number" id="pz" value="60" step="5"></label>
    <label>pitch <input type="number" id="pphi" value="0" step="5"></label>
    <button id="btnGoPt" class="chip-btn">Go to point (mm, °)</button>
  </div>
  <p class="note" id="ikOut">Manual mode closes the door first and moves at ${s.speedManualDps}°/s at most.</p>

  <h3>Joints</h3>
  <table class="wiring joint-table" id="jointTable"><tr><th>Joint</th><th>Program</th><th>Servo (real)</th><th>Pulse</th></tr>
    ${JOINTS.map((n, j) => `<tr data-j="${j}"><td>${n}</td><td></td><td></td><td></td></tr>`).join('')}
    <tr data-j="4"><td>door</td><td></td><td></td><td></td></tr>
  </table>
  <p class="note" id="poseInfo"></p>

  <h3>Food (mass balance)</h3>
  <table class="wiring" id="massTable"><tr><th>Hopper</th><th>Spoon</th><th>Plate</th><th>Floor</th><th>Eaten</th><th>Balance</th></tr><tr><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>
  <div class="btn-row three"><button id="btnFill" class="btn">Fill the hopper</button><button id="btnEmpty" class="btn">Empty the hopper</button><button id="btnClearPlate" class="btn">Wash the plate</button></div>

  <h3>Pancho and faults to try</h3>
  <div class="options col">
    <label><input type="checkbox" id="optCat"> Pancho at the window (breaks the IR beam)</label>
    <label><input type="checkbox" id="optLid"> Service lid open</label>
    <label><input type="checkbox" id="optEstop"> E-stop pressed (latched)</label>
    <label><input type="checkbox" id="optJam"> Shoulder jammed (stall current)</label>
    <label><input type="checkbox" id="optDoor"> Something blocks the door</label>
    <label><input type="checkbox" id="optReach"> Show the reach of the arm</label>
    <label><input type="checkbox" id="optLabels"> Show labels</label>
  </div>
  <fieldset class="mount-pick"><legend>Load cell</legend>
    <label><input type="radio" name="scaleMode" value="ok" checked> Working</label>
    <label><input type="radio" name="scaleMode" value="disconnected"> Wire off</label>
    <label><input type="radio" name="scaleMode" value="stuck"> Frozen value</label>
  </fieldset>

  <h3>Guided experiments</h3>
  <ol class="guided" id="guided">
    <li data-n="0"><b>Servos: commands, pulses and limits.</b> <span>Manual mode, four joint targets, then a shoulder angle past its limit. Expected: the servos reach the targets, the pulse widths match, 175° is clamped to ${s.q1Max}°.</span><button class="chip-btn">Start experiment 1</button><em></em></li>
    <li data-n="1"><b>Kinematics: reach a point, refuse impossible ones.</b> <span>Spoon to (200, 0, 60) mm, level. Then a point 400 mm away and one behind the base. Expected: the first within 2 mm, the others refused, the arm does not move.</span><button class="chip-btn">Start experiment 2</button><em></em></li>
    <li data-n="2"><b>Load cell: tare, calibrate, check.</b> <span>From a new board (not calibrated). Expected: feeding refused, then tare, 100 g weight, calibrate, and a 50 g check weight reads 50 ± 1 g.</span><button class="chip-btn">Start experiment 3</button><em></em></li>
    <li data-n="3"><b>One automatic ration.</b> <span>Ration ${s.rationDefaultG} g. Expected: scoops until the plate holds ${s.rationDefaultG} ± ${s.rationTolG} g, leftovers back in the hopper, no food lost, door open and outputs off at the end.</span><button class="chip-btn">Start experiment 4</button><em></em></li>
    <li data-n="4"><b>Faults: jam, bad sensor, no food, power cut.</b> <span>Four short cycles. Expected: FAULT with the right reason each time, arm unpowered, and after a power cut no second ration by itself.</span><button class="chip-btn">Start experiment 5</button><em></em></li>
    <li data-n="5"><b>Pancho arrives during a cycle.</b> <span>Expected: safe stop at once, door stays shut, reset refused while he is there, no restart on its own when he leaves, recovery only by the tutor.</span><button class="chip-btn">Start experiment 6</button><em></em></li>
  </ol>
  <p class="note">Experiments run at ${GUIDED_SPEED}×. The program uses its real times and speeds.</p>

  <h3>Spoon height and weight</h3>
  <canvas id="cfCanvas" class="tl-canvas" width="760" height="230" role="img" aria-label="Plot of the spoon height, the weight the program reads on the plate and the target ration"></canvas>
  <p class="note">Last 2 minutes. Orange: spoon height (mm). Green: net weight on the plate (program). Dashed: the target ration.</p>

  <h3>Console</h3>
  <div class="console" id="console" aria-live="off"></div>
  <h3>Camera</h3>
  <div class="views">${viewButtons.map(([v, t]) => `<button class="chip-btn" data-view="${v}">${t}</button>`).join('')}</div>`;

const codeHtml = (s) => `
  ${IDE_INTRO}
  <p>This is the file that runs on the board, the one the simulation follows (its constants are read from it) and the one you download. The loop never blocks.</p>
  <div class="code-head"><span>cat_feeder.ino</span>
    <span class="code-actions"><button id="copyBtn" class="chip-btn">Copy</button><a id="dlLink" class="chip-btn" href="arduino/cat_feeder/cat_feeder.ino" download="cat_feeder.ino">Download</a></span></div>
  <pre class="code" id="code" tabindex="0"></pre>
  <h3>What each part does</h3>
  <ul class="explain-list">
    <li><code>Adafruit_PWMServoDriver pwm(0x40)</code> with <code>setPWMFreq(50)</code>: 50 pulses a second on each channel. <code>servoDeg()</code> turns a servo angle into a pulse between <code>SERVO_US_MIN</code> and <code>SERVO_US_MAX</code> (${s.servoUsMin} and ${s.servoUsMax} µs).</li>
    <li><code>servoOff()</code> sends no pulse at all. An MG996R without pulses stops driving and can be turned by hand: that is how the arm is “off”.</li>
    <li><code>OE_PIN</code> (GPIO${s.oePin}) is set HIGH as the first line of <code>setup()</code>: no servo pulse leaves the PCA9685 until the program decides to move.</li>
    <li><code>forwardK()</code> and <code>inverseK()</code>: the formulas of “How it works”. <code>inverseK()</code> returns false for a target out of reach or past a limit, and the move is not started.</li>
    <li><code>goToJoints()</code> plans a move where all joints start and stop together. Its duration keeps the fastest joint under the speed limit (<code>SPEED_MAX_DPS</code> ${s.speedMaxDps}°/s empty, ${s.speedLoadedDps}°/s with food, ${s.speedPourDps}°/s pouring).</li>
    <li><code>stepMotion()</code> runs every ${s.motionMs} ms (one servo frame): a new point of the smooth profile for the arm, and a limited-speed step for the door (${s.doorDps}°/s).</li>
    <li><code>readScale()</code>: one HX711 reading every ${s.scaleMs} ms, the average of the last 4, and a check: missing for ${s.scaleTimeoutMs} ms, outside ${s.scaleMinG} to ${s.scaleMaxG} g, or the same raw value 20 times means the scale is not working.</li>
    <li><code>readCurrent()</code>: the INA219 measures the servo supply. Above ${s.jamMa} mA for ${s.jamMs} ms is a jam.</li>
    <li>The safety block at the top of <code>loop()</code> runs in every state that can move something, before the state machine: E-stop, lid, jam, Pancho, scale, and the stop request.</li>
    <li><code>enterFault()</code> switches the arm off and saves the reason. The door servo keeps the door closed.</li>
    <li><code>Preferences</code> keeps the tare, the calibration and a <code>cycle</code> flag in flash. The flag is set when the door has closed and cleared when the arm is parked: if <code>setup()</code> finds it set, a cycle was cut and the program goes to FAULT instead of feeding again.</li>
    <li><code>COOLDOWN_MS</code>: after a ration or a restart, the next ration needs ${s.cooldownMs / 60000} min or a long press.</li>
    <li>Serial commands (115200 baud): <code>f</code> feed, <code>F</code> feed now, <code>g20</code> ration 20 g, <code>t</code> tare, <code>c100</code> calibrate with 100 g, <code>m</code> / <code>x</code> manual mode in / out, <code>j 0 90 -90 0</code> joints, <code>p 200 0 60 0</code> point, <code>h</code> pause, <code>s</code> stop, <code>r</code> reset.</li>
  </ul>
  <h3>Upload it to your ESP32</h3>
  <ol class="steps-list">
    <li>Arduino IDE 2 with the <b>esp32 by Espressif Systems</b> board package. Library Manager: <b>Adafruit PWM Servo Driver Library</b>, <b>HX711</b> by Bogdan Necula, <b>Adafruit INA219</b>.</li>
    <li>Download <code>cat_feeder.ino</code> into a folder called <code>cat_feeder</code>.</li>
    <li><b>First upload with the servo supply off</b> (E-stop pressed). Board <b>ESP32 Dev Module</b>, its port, Upload.</li>
    <li>Serial Monitor at 115200 baud: check the lid, beam and E-stop levels change when you operate them, then follow the calibration in “How it works” with the servo horns <b>not yet fitted</b>.</li>
  </ol>
  <p class="note">This page is a web simulation. The logic was checked against a JavaScript port of this sketch with automated tests. It has not been compiled for or run on a real ESP32, and no real parts were measured.</p>`;

function table(head, rows) {
  return `<table class="wiring"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}

const howHtml = (s) => {
  const arm = armOf(s);
  const c = feederChecks(s, WORLD.spoonCapG);
  const f = forward([0, 45, -90, 45], arm);
  const ik = inverse({ x: 200, y: 0, z: 60, phi: 0 }, arm);
  const rw = 200 - s.l3, zw = 60 - s.h0;
  const d = Math.hypot(rw, zw);
  const c2 = (d * d - s.l1 * s.l1 - s.l2 * s.l2) / (2 * s.l1 * s.l2);
  const far = inverse({ x: 400, y: 0, z: 90, phi: 0 }, arm);
  const n1 = (x) => x.toFixed(1), n2 = (x) => x.toFixed(2), n3 = (x) => x.toFixed(3);
  const us = (dg) => Math.round(s.servoUsMin + ((s.servoUsMax - s.servoUsMin) * dg) / 180);
  const wp = waypoints(s);
  return `
  <p>Click a step to move the camera. The highlighted step follows what the program is doing.</p>
  <ol class="steps" id="steps"></ol>

  <h3>The path of the signal</h3>
  <p class="path-line"><b>ration</b> → <b>inverse kinematics</b> → <b>joint angles</b> → <b>I²C</b> → <b>PCA9685 pulses</b> → <b>servos</b> → <b>spoon</b> → <b>food on the plate</b> → <b>load cell</b> → <b>HX711</b> → <b>program</b></p>

  <h3>Parts list</h3>
  ${table(['Part', 'Qty', 'Specification', 'Compatible alternatives'], PARTS.map((p) => [`<b>${esc(p.name)}</b>`, esc(p.qty), esc(p.spec), esc(p.alt)]))}

  <h3>ESP32 pins</h3>
  ${table(['Pin', 'Used for', 'Mode', 'Note'], PIN_TABLE.map((p) => [esc(p.name), esc(p.role), esc(p.mode), esc(p.note)]))}
  <p class="note">None of these is a strapping pin (0, 2, 5, 12, 15) or a flash pin (6 to 11). GPIO34 to 39 are input-only, so SCK, OE and the LED are on other pins.</p>

  <h3>Connections</h3>
  ${table(['From', 'To', 'Why'], CONNECTIONS.map((x) => [esc(x.from), esc(x.to), esc(x.note)]))}

  <h3>PWM, pulses and the PCA9685</h3>
  <ul class="explain-list">
    <li>Period 20 ms (50 Hz). Pulse = ${s.servoUsMin} µs + ${s.servoUsMax - s.servoUsMin} µs × servo angle / 180°. Servo 0° → ${us(0)} µs, 90° → ${us(90)} µs, 180° → ${us(180)} µs.</li>
    <li>The PCA9685 cuts each 20 ms period into 4096 steps of about 4.9 µs, so the pulse resolution is about 0.44° of servo angle.</li>
    <li>Servo angle = ZERO + DIR × joint angle. In the sketch: base ${s.q0Zero} + q0, shoulder ${s.q1Zero} + q1, elbow ${s.q2Zero} + q2, wrist ${s.q3Zero} + q3. The parked pose (${s.homeQ0}, ${s.homeQ1}, ${s.homeQ2}, ${s.homeQ3})° needs pulses of ${[0, 1, 2, 3].map((j) => us([s.q0Zero, s.q1Zero, s.q2Zero, s.q3Zero][j] + [s.homeQ0, s.homeQ1, s.homeQ2, s.homeQ3][j])).join(', ')} µs.</li>
    <li>Joint limits: q0 ${s.q0Min}..${s.q0Max}°, q1 ${s.q1Min}..${s.q1Max}°, q2 ${s.q2Min}..${s.q2Max}°, q3 ${s.q3Min}..${s.q3Max}°. They keep each link off the floor, the frame and the other links. Every command is clamped to them, in manual mode too.</li>
    <li>Many servos do not reach a full 180° between 500 and 2500 µs, and some buzz at the ends. Measure yours (calibration, step 2) and narrow <code>SERVO_US_MIN</code> / <code>SERVO_US_MAX</code> if needed.</li>
  </ul>

  <h3>Forward kinematics: a worked example</h3>
  <p>Angles q = (0°, 45°, −90°, 45°). Link angles from horizontal: 45°, 45° − 90° = −45°, −45° + 45° = 0°.</p>
  <ul class="explain-list">
    <li>Elbow: r = 120 cos 45° = ${n1(f.elbow.x)} mm, z = ${s.h0} + 120 sin 45° = ${n1(f.elbow.z)} mm.</li>
    <li>Wrist: r = ${n1(f.elbow.x)} + 120 cos(−45°) = ${n1(f.wrist.x)} mm, z = ${n1(f.elbow.z)} − ${n1(120 * Math.sin(Math.PI / 4))} = ${n1(f.wrist.z)} mm.</li>
    <li>Spoon: r = ${n1(f.wrist.x)} + 70 = ${n1(f.spoon.x)} mm, z = ${n1(f.spoon.z)} mm, pitch 0° (level). With q0 = 90° the same spoon is at y = ${n1(f.spoon.x)} mm instead of x.</li>
  </ul>

  <h3>Inverse kinematics: a worked example</h3>
  <p>Target: spoon at x = 200, y = 0, z = 60 mm, level (pitch 0°).</p>
  <ul class="explain-list">
    <li>Base: q0 = atan2(y, x) = 0°.</li>
    <li>Wrist point: step back 70 mm along the spoon: r<sub>w</sub> = 200 − 70 = ${rw} mm, z<sub>w</sub> = 60 − ${s.h0} = ${zw} mm (relative to the shoulder). Distance d = ${n1(d)} mm, less than 240 mm: reachable.</li>
    <li>Elbow (law of cosines): cos q2 = (d² − 120² − 120²) / (2·120·120) = ${n3(c2)}, so q2 = −${n3(-ik.q[2])}° (negative: the elbow-up solution).</li>
    <li>Shoulder: q1 = atan2(${zw}, ${rw}) − atan2(120 sin q2, 120 + 120 cos q2) = ${n3(ik.q[1])}°.</li>
    <li>Wrist: q3 = pitch − q1 − q2 = ${n3(ik.q[3])}°. All four are inside the limits. Experiment 2 sends the arm there.</li>
    <li>Impossible target: x = 400, z = 90 puts the wrist 330 mm from the shoulder, more than 240 mm: <b>${esc(far.reason)}</b>, the program refuses it.</li>
  </ul>

  <h3>Workspace and trajectories</h3>
  <ul class="explain-list">
    <li>The wrist reaches up to ${c.reachWrist} mm from the shoulder axis; with the spoon level that is ${c.reachSpoon} mm. The hopper and the plate are at ${s.hopperR} mm, on both sides (${s.hopperAz}° and ${s.plateAz}°), well inside, so the arm never works stretched.</li>
    <li>Cycle waypoints (spoon, mm): above the hopper z ${s.hopperTopZ}, dip z ${s.dipZ} pitch ${s.digPhi}°, drag ${s.strokeMm} mm to z ${s.scoopZ}, above the plate z ${s.plateZ}, pour down to ${s.pourPhiMin}°, dump over the hopper z ${s.dumpZ}. All are checked against the limits by a test (and by the program before every move).</li>
    <li>Each move is a straight line in joint space with a smooth start and stop (smoothstep). The peak speed is 1.5 × the average, so the duration is 1.5 × the largest angle / the speed limit. Example: above the hopper to above the plate turns the base 130°: at ${s.speedLoadedDps}°/s that takes ${n1((1.5 * 130) / s.speedLoadedDps)} s.</li>
    <li>The spoon path between the waypoints is not a straight line in space; the waypoints are high enough above the hopper and plate rims that the curve clears them. The dashed green line in the scene is the planned path of the current move.</li>
  </ul>

  <h3>Torque (on paper)</h3>
  <p>Estimated masses: upper link ${MASSES.upper * 1000} g, elbow servo ${MASSES.elbowServo * 1000} g, forearm ${MASSES.fore * 1000} g, wrist servo ${n1(MASSES.wristServo * 1000)} g, spoon ${MASSES.spoon * 1000} g, full spoon of kibble ${WORLD.spoonCapG} g. Gravity torque τ = Σ m·g·(horizontal distance). Worst pose: the arm stretched out level.</p>
  ${table(['Joint', 'Worst case', 'Carrying over the plate', 'Servo stall (6 V)', 'Margin'], [1, 2, 3].map((j) => [
    esc(JOINTS[j]), `${n2(c.tauWorst[j])} N·m`, c.tauCarry ? `${n2(c.tauCarry[j])} N·m` : '–', `${c.stall[j]} N·m (${j < 3 ? 'MG996R' : 'MG90S'})`, `${n1(c.margin[j])} ×`,
  ]))}
  <p class="note">Keep holding torque under a third of the stall torque (margin 3 × or more): a servo near stall heats up and its gears wear. The shoulder is the tightest; weigh your links and redo this sum. The base turns about a vertical axis and holds no weight.</p>

  <h3>Current</h3>
  <ul class="explain-list">
    <li>Holding still: about ${n2(c.currents.holdA)} A for all servos. Moving together at these speeds: about ${n1(c.currents.movingA)} A. One MG996R stalled: about ${c.currents.oneStallA} A (MG90S ${SERVOS.MG90S.stallA} A).</li>
    <li>The program calls it a jam above ${n1(c.currents.jamA)} A for ${c.currents.jamMs} ms and stops the arm. The 3 A slow fuse is the second line, the E-stop the third.</li>
    <li>The 6 V 5 A supply covers a stall with margin, so the voltage does not dip and the PCA9685 and the servos keep working. The 1000 µF on V+ covers the short peaks when several servos start.</li>
    <li>The ESP32 has its own USB charger: a servo stall can never brown out the board. Only the grounds are joined.</li>
  </ul>

  <h3>Assembly, step by step</h3>
  <ol class="steps-list">
    <li><b>Chamber first.</b> Clear walls, a lid with its switch, the window with the flap door on the inside and the IR beam on the outside, about 3 cm in front of the window and at the height of Pancho's chest.</li>
    <li>Fix the arm base to the chamber floor, the hopper at ${s.hopperAz}° and the plate on the load cell at ${s.plateAz}°, both ${s.hopperR} mm from the base axis. The plate must be the only thing resting on the load cell.</li>
    <li>Electronics outside the chamber, on a board: ESP32, PCA9685, INA219, HX711. Wire the logic first (3V3, GND, SDA, SCL, OE with its 2.2 kΩ, DT, SCK, inputs, LED).</li>
    <li>Servo supply: 6 V + → E-stop main contact → 3 A fuse → INA219 VIN+ → VIN− → PCA9685 V+. 6 V − → PCA9685 GND. Join it to the ESP32 GND. 1000 µF on V+ (+ to V+). Check twice with a multimeter before switching on: 6 V on the ESP32 3V3 pin destroys it.</li>
    <li>Servo cables through a grommet into the chamber, fixed along the links with spiral wrap so no cable can be caught by a joint.</li>
    <li>Upload with the E-stop pressed, then calibrate the servos <b>without the horns fitted</b> (next section). Fit the horns at the calibrated zero.</li>
    <li>Load cell calibration (tare and known weight), then a manual-mode check of every waypoint, at 20 % speed, with a hand on the E-stop.</li>
    <li>First rations with no cat in the room, then with Pancho present and an adult watching.</li>
  </ol>

  <h3>Calibration</h3>
  <ol class="steps-list">
    <li><b>Input levels.</b> On the Serial Monitor check that the lid switch, the beam and the E-stop contact read the levels in the sketch (<code>LID_CLOSED_LEVEL</code>, <code>BEAM_BROKEN_LEVEL</code>, <code>ESTOP_OK_LEVEL</code>). Change them if your parts are the other way.</li>
    <li><b>Servo pulses.</b> One servo at a time, no horn, no load: send pulses from 600 to 2400 µs and note where it stops moving at each end. Use those values for <code>SERVO_US_MIN</code> / <code>SERVO_US_MAX</code>, or keep the joint limits inside them.</li>
    <li><b>Servo zero and direction.</b> Command the joint angle 0° of each joint (manual mode, <code>j</code> command) and fit the horn so the link is in its zero position (level for the shoulder, straight for the elbow, in line for the wrist, forward for the base). If a joint turns the wrong way, set its <code>Qn_DIR</code> to −1. Fine-tune <code>Qn_ZERO</code> by a degree or two.</li>
    <li><b>Load cell.</b> Empty plate on the cell: command <code>t</code> (tare). Put a known weight (100 g, or a kitchen scale reading): <code>c100</code>. Check with a second weight. The values are saved in flash; feeding is refused until this has been done once.</li>
    <li><b>Spoon.</b> In manual mode run one scoop by hand and weigh what it carries. A spoon that carries less than about 3 g needs more scoops than <code>MAX_SCOOPS</code> allows for a normal ration.</li>
    <li><b>Current.</b> Watch the current on the Serial Monitor during a full cycle. Set <code>JAM_MA</code> about 30 % above the highest normal value and below the stall current of one servo.</li>
  </ol>

  <h3>Exercises</h3>
  <ol class="steps-list">
    <li>Compute the forward kinematics of the parked pose (${s.homeQ0}, ${s.homeQ1}, ${s.homeQ2}, ${s.homeQ3})°. <details><summary>Answer</summary>Link angles ${s.homeQ1}°, ${s.homeQ1 + s.homeQ2}°, ${s.homeQ1 + s.homeQ2 + s.homeQ3}°. The spoon is at r ≈ ${n1(forward([s.homeQ0, s.homeQ1, s.homeQ2, s.homeQ3], arm).spoon.x)} mm, z ≈ ${n1(forward([s.homeQ0, s.homeQ1, s.homeQ2, s.homeQ3], arm).spoon.z)} mm: high, folded, away from the door.</details></li>
    <li>Why does the pour stop ${s.anticipateG} g before the target? <details><summary>Answer</summary>Kibble that has left the spoon is still in the air when the scale is read. Without the anticipation every ration would end a little over.</details></li>
    <li>The program cannot take food out of the plate. Which settings limit how far over the ration it can go? <details><summary>Answer</summary>The pour step (${s.pourStepDeg}° every ${s.pourStepMs} ms) and the spoon size: at most what falls in one step after the last reading. <code>EXCESS_G</code> (${s.excessG} g) only reports it.</details></li>
    <li>The beam stops the arm, so why is the door needed? <details><summary>Answer</summary>The beam is a sensor: it can fail, be misaligned or miss a paw. The door is a barrier that does not depend on a sensor. The beam is the complementary protection.</details></li>
    <li>Why is the <code>cycle</code> flag saved after the door closes and not when the button is pressed? <details><summary>Answer</summary>Before the door closes nothing has been scooped, so a restart then can safely do nothing. From the moment food may be moving, a restart must not lead to a second ration: the flag makes setup() go to FAULT.</details></li>
  </ol>

  <h3>Safety (read before building)</h3>
  <ul class="explain-list">
    <li><b>This is a teaching design. It is not a certified safe device.</b> Do not leave it running with an animal unattended until you have built it, tested every fault on the real parts and watched it work for many days.</li>
    <li>The arm and the cat never share space: the arm is enclosed, the door is closed before any move, and the servo outputs are off whenever the door is open. The IR beam is only a complementary protection, not the main one.</li>
    <li>Low force and low speed: speed limits in the sketch (${s.speedMaxDps}°/s at most, ${s.doorDps}°/s for the door), a small door servo with a soft edge, a current limit (jam) and a fuse. A latching E-stop cuts the servo power in hardware.</li>
    <li>After any fault or power cut the feeder does nothing on its own. Only the tutor restarts it, after checking the cause.</li>
    <li>Food-safe parts where food passes: stainless spoon, PP/PET hopper, stainless or ceramic plate. All of them must come out for washing; wash the spoon and plate as you would Pancho's normal bowl. Keep the food dry: damp kibble sticks and goes bad.</li>
    <li>Cables inside the chamber in spiral wrap, through grommets, fixed along the links. No cable or connector on the cat's side.</li>
    <li>The ration and the times are the tutor's decision, with the vet. The values in the sketch are examples.</li>
    <li>Use a certified 6 V supply and a certified USB charger. No mains voltage anywhere in the build.</li>
  </ul>

  <h3>What it cannot do</h3>
  <ul class="explain-list">
    <li>It cannot see food stuck in the spoon, a cat eating too fast or not eating, or kibble that has gone bad.</li>
    <li>It does not know the time of the last ration after a power cut: it waits the full cooldown, or the tutor overrides.</li>
    <li>A servo that slips without a large current (stripped gear) moves the spoon somewhere the program does not expect: servos report no position. A cycle that ends short (scoops limit) or a hopper fault is the only sign.</li>
  </ul>
  <p class="note">The cycle waypoints are at ${wp.aboveHopper.z} mm above the hopper and ${wp.abovePlate.z} mm above the plate; measure your hopper and plate rims and raise them if needed.</p>`;
};

export default {
  id: 'esp32-cat-feeder',
  number: 3,
  title: 'Smart Robotic Cat Feeder',
  chapter: 'Move, measure, stop safely',
  codeTab: 'Arduino C++',
  defaultView: 'circuit',
  viewButtons,
  views: {
    circuit: { t: [0, 0.6, 0.4], r: 27, phi: 0.74, theta: 0, fit: 'book' },
    assembly: { t: [6.0, 1.2, -0.6], r: 18, phi: 0.84, theta: 0.12 },
    arm: { t: [5.5, 2.0, -3.2], r: 11.5, phi: 1.0, theta: -0.45 },
    hopper: { t: [2.0, 1.0, -2.9], r: 7, phi: 0.62, theta: 0.4 },
    plate: { t: [9.1, 0.5, -2.9], r: 7, phi: 0.62, theta: -0.4 },
    window: { t: [11.2, 0.4, -2.9], r: 8.5, phi: 1.1, theta: 1.35 },
    electronics: { t: [5.6, 0.6, 4.0], r: 11.5, phi: 0.72, theta: 0 },
    pins: { t: [3.1, 0.6, 5.0], r: 6.4, phi: 0.78, theta: 0.1 },
  },
  pageContent: ESP32_FEEDER_PAGE,
  textures: () => ({
    left: leftPageTexture(ESP32_FEEDER_PAGE),
    right: rightPageTexture({
      fig: 'FIG. 3', caption: 'Ration → kinematics → PCA9685 → servos → spoon → plate → load cell', page: 6,
      hint: 'Click the E-stop, the blue button or Pancho in the scene, or use the notebook.',
    }),
  }),

  async create(env) {
    let source = null;
    for (let attempt = 0; attempt < 3 && source == null; attempt++) {
      try {
        const res = await fetch('arduino/cat_feeder/cat_feeder.ino', { cache: 'no-store' });
        if (res.ok) source = await res.text();
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    source ??= '// Could not load arduino/cat_feeder/cat_feeder.ino. Start the project with: npm start';
    const { settings: S, missing } = parseFeederSettings(source);
    const scene = buildFeederScene(S);
    const arm = armOf(S);

    /* ---------- state ---------- */
    const factoryPrefs = () => ({ cycle: 0, delivered: 0, offset: S.scaleOffset, cal: S.scaleCal, calibrated: false });
    let store = factoryPrefs(); // the simulated flash (Preferences)
    let world = new FeederWorld(S, {}, 11);
    let buttonDown = false;
    let speed = 5;
    let simOn = false, paused = false;
    let devMs = 0, passMs = 0, lastHist = -1e9;
    let powerOnAt = null;
    let massStart = world.totalG, massAdded = 0;
    let popT = 0, autoStart = false, ui = null;
    let pickWhat = null, pressMoved = false;
    let hist = [];
    let guided = null;
    let doneCount = 0, refusedCount = 0, faultAt = 0;
    let showReach = false;
    let planCache = { move: null, target: null, plan: [] };
    const view = { led: 0, button: 0 };

    const io = {
      readScale: () => world.readScale(),
      readBeam: () => world.readBeam(),
      readLid: () => world.readLid(),
      readEstop: () => world.readEstop(),
      readButton: () => (buttonDown ? 0 : 1),
      readCurrentMa: () => world.currentMa(),
      setServo: (ch, d) => world.setServo(ch, d),
      servoOff: (ch) => world.servoOff(ch),
      setOutputs: (on) => world.setOutputs(on),
      loadPrefs: () => ({ ...store }),
      savePrefs: (p) => (store = { ...p }),
      onEvent: (ev) => onEvent(ev),
    };
    let ctrl = new CatFeeder(S, io);
    const log = (t, c) => ui && ui.log(t, c);
    const ts = () => fmtS(passMs);
    const net = () => ctrl.weightG - (['TARE', 'CYCLE', 'DOOR_OPENING', 'RECOVERING'].includes(ctrl.state) || ctrl.state === 'FAULT' ? ctrl.baseline ?? 0 : 0);
    const ledOn = () => (ctrl.running ? (ctrl.state === 'FAULT' ? Math.floor(passMs / 150) % 2 === 1 : ctrl.state !== 'IDLE') : false);

    function onEvent(ev) {
      if (ev.type === 'state') {
        if (ev.to === 'FAULT') return;
        const why = { DOOR_CLOSING: '# checks passed, door closing, arm going home slowly', TARE: '# door shut, cycle flag saved, weighing the plate', DOOR_OPENING: '# arm parked and off, door opening', IDLE: ev.from === 'DOOR_OPENING' ? '# outputs off, the plate is Pancho’s' : '', MANUAL: '# door closing first', RECOVERING: '# recovery: door shut, arm home slowly' }[ev.to] || '';
        log(`>>> ${ts()}  ${ev.from} → ${ev.to}  ${why}`, 'p');
      } else if (ev.type === 'phase') {
        if (['TO_HOPPER', 'POUR', 'WEIGH', 'TO_DUMP', 'R_TO_DUMP', 'READY'].includes(ev.phase)) log(`    ${ts()}  phase ${ev.phase}`, 'c');
      } else if (ev.type === 'fault') {
        faultAt = passMs;
        log(`>>> ${ts()}  FAULT: ${FAULT_TEXT[ev.code]}. Arm off.`, 'p');
        scene.pulse?.('led', '#ff7a5a');
      } else if (ev.type === 'refused') {
        refusedCount++;
        log(`# refused: ${ev.blockers.map((b) => BLOCKER_TEXT[b] || b).join('; ')}`, 'c');
      } else if (ev.type === 'ik-fail') {
        log(`# not reachable (${IK_TEXT[ev.reason] || ev.reason})`, 'c');
      } else if (ev.type === 'baseline') {
        log(`# plate before the ration: ${g1(ev.g)}`, 'c');
      } else if (ev.type === 'weighed') {
        log(`# weighed: ${g1(ev.delivered)} of ${g1(ctrl.target)} after ${ev.scoops} scoop${ev.scoops > 1 ? 's' : ''} (+${g1(ev.gain)})`, 'c');
      } else if (ev.type === 'excess') {
        log(`# over the ration: ${g1(ev.delivered)} for ${g1(ev.target)} (reported, cannot be taken back)`, 'c');
      } else if (ev.type === 'short') {
        log(`# short ration: ${g1(ev.delivered)} after the scoop limit`, 'c');
      } else if (ev.type === 'done') {
        doneCount++;
        const r = ev.result;
        log(r ? `# done: ${g1(r.delivered ?? 0)} for a target of ${g1(r.target ?? ctrl.ration)}. Next ration after the cooldown.` : '# parked.', 'p');
      } else if (ev.type === 'tare') {
        log(`# tare: offset ${ev.offset} counts saved`, 'c');
      } else if (ev.type === 'calibrated') {
        log(`# calibrated: ${ev.cal.toFixed(1)} counts per gram, saved`, 'c');
      } else if (ev.type === 'door-reopen') {
        log('# Pancho at the window while closing: door opens again', 'c');
      }
    }

    /* ---------- board ---------- */
    function bootBoard(why) {
      ctrl = new CatFeeder(S, io);
      world.power = true;
      powerOnAt = null;
      ctrl.setup(passMs);
      planCache = { move: null, target: null, plan: [] };
      log(why === 'power' ? '# Power back: setup() runs. RAM is lost (ration and speed back to the sketch values), flash is kept.' : '# setup(): outputs disabled, prefs read from flash.', 'p');
      if (ctrl.state === 'FAULT') log(`# setup(): ${FAULT_TEXT[ctrl.fault]}. Nothing will move until the tutor resets.`, 'p');
      if (!store.calibrated) log('# The scale has never been calibrated: tare, then “Calibrate with 100 g”.', 'c');
      ui?.syncControls();
      ui?.refresh();
    }
    function startSim() {
      simOn = true;
      paused = false;
      if (!ctrl.running && powerOnAt == null) bootBoard('run');
      ui?.refresh();
    }
    function stopSim(why) {
      const was = simOn;
      simOn = false;
      paused = false;
      ctrl.powerOff();
      world.setOutputs(false);
      if (was && why === 'user') log('# Simulation stopped: board and servo power off.', 'c');
      ui?.refresh();
    }
    function powerCut(ms = 2000) {
      if (!simOn) return;
      ctrl.powerOff();
      world.power = false;
      world.setOutputs(false);
      for (let ch = 0; ch < 5; ch++) world.servoOff(ch);
      powerOnAt = passMs + ms;
      log(`>>> ${ts()}  POWER CUT: servos limp, the ESP32 is off for ${ms / 1000} s`, 'p');
    }
    function setPaused(on) {
      if (paused === on || !simOn) return;
      paused = on;
      log(on ? '# Paused: simulated time is frozen. Play continues from here.' : '# Playing again.', 'c');
      ui?.refresh();
    }
    function resetWorld(opts = {}) {
      world = new FeederWorld(S, {}, 11);
      Object.assign(world, opts);
      massStart = world.totalG;
      massAdded = 0;
      ui?.syncControls();
    }
    const calibratedPrefs = () => ({ cycle: 0, delivered: 0, offset: world.trueOffset + world.trueCal * world.p.dishG, cal: world.trueCal, calibrated: true });

    /* ---------- guided experiments ---------- */
    const wait = (ms) => (st) => {
      st.until ??= passMs + ms;
      return passMs >= st.until;
    };
    const waitFor = (fn, maxMs) => (st) => {
      st.until ??= passMs + maxMs;
      return fn() || passMs >= st.until;
    };
    const doIt = (fn) => (st, mem) => (fn(mem), true);
    const fresh = (opts = {}, factory = false) => doIt(() => {
      buttonDown = false;
      doneCount = refusedCount = 0;
      resetWorld(opts);
      store = factory ? factoryPrefs() : calibratedPrefs();
      simOn = true;
      paused = false;
      bootBoard('run');
    });
    const st = () => ctrl.state;
    const armLimp = () => world.servo.every((sv) => sv.cmd == null);
    const doorShut = () => Math.abs(world.door.pos - S.doorClosedDeg) < 1;
    const doorOpen = () => Math.abs(world.door.pos - S.doorOpenDeg) < 1;
    const maxErr = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const toManual = [doIt(() => ctrl.enterManual()), waitFor(() => st() === 'MANUAL' && ctrl.phase === 'READY', 20000)];
    const leave = [doIt(() => ctrl.leaveManual()), waitFor(() => st() === 'IDLE', 60000)];
    const feedAndWait = (fn, maxMs) => [doIt(() => ctrl.feed(true)), waitFor(fn, maxMs)];
    const TESTS = [
      () => [
        fresh(), wait(1500), ...toManual,
        doIt((mem) => (mem.r = ctrl.manualJoints([30, 90, -90, 0]))), waitFor(() => !ctrl.moving(), 30000), wait(400),
        doIt((mem) => {
          mem.err = maxErr(world.joints(), mem.r.q);
          mem.us = mem.r.q.map((v, j) => Math.round(ctrl.pulseUs(ctrl.jointToServo(j, v))));
          mem.r2 = ctrl.manualJoints([30, 175, -90, 0]);
        }),
        waitFor(() => !ctrl.moving(), 30000), wait(400), doIt((mem) => (mem.err2 = Math.abs(world.joints()[1] - S.q1Max))), ...leave,
        (s0, mem) => finish(mem.r.ok && mem.err < 1 && mem.r2.q[1] === S.q1Max && mem.err2 < 1 && st() === 'IDLE' && !world.outputsOn,
          `Passed: (30, 90, −90, 0)° reached within ${mem.err.toFixed(2)}°, pulses ${mem.us.join(', ')} µs. 175° for the shoulder was clamped to ${S.q1Max}°. Parked, outputs off, door open.`,
          `Failed: error ${mem.err?.toFixed(2)}°, shoulder ${mem.r2?.q[1]}, state ${st()}.`),
      ],
      () => [
        fresh(), wait(1500), ...toManual,
        doIt((mem) => (mem.r = ctrl.manualPoint({ x: 200, y: 0, z: 60, phi: 0 }))), waitFor(() => !ctrl.moving(), 30000), wait(400),
        doIt((mem) => {
          const p = world.pose();
          mem.err = Math.hypot(p.spoon.x - 200, p.spoon.y, p.spoon.z - 60);
          mem.q = [...ctrl.q];
          mem.far = ctrl.manualPoint({ x: 400, y: 0, z: 90, phi: 0 });
          mem.behind = ctrl.manualPoint({ x: -150, y: -20, z: 120, phi: 0 });
        }),
        wait(1500), doIt((mem) => (mem.still = maxErr(ctrl.q, mem.q))), ...leave,
        (s0, mem) => finish(mem.r.ok && mem.err < 2 && !mem.far.ok && mem.far.reason === 'out-of-reach' && !mem.behind.ok && mem.still < 1e-6,
          `Passed: q = (${mem.r.q.map((v) => v.toFixed(1)).join(', ')})°, the real spoon ended ${mem.err.toFixed(2)} mm from the target. (400, 0, 90): ${IK_TEXT[mem.far.reason]}. (−150, −20, 120): ${IK_TEXT[mem.behind.reason]}. The arm did not move for either.`,
          `Failed: reached ${mem.r?.ok}, error ${mem.err?.toFixed(2)} mm, far ${mem.far?.reason}, behind ${mem.behind?.reason}.`),
      ],
      () => [
        fresh({}, true), wait(1500),
        doIt((mem) => {
          mem.before = ctrl.weightG;
          mem.b0 = ctrl.blockers(passMs, true);
          mem.tare = ctrl.tare();
        }),
        wait(1000), doIt((mem) => (mem.afterTare = ctrl.weightG)),
        doIt(() => (world.knownMassG = 100)), wait(1200), doIt((mem) => (mem.cal = ctrl.calibrate(100))),
        doIt(() => (world.knownMassG = 0)), wait(1200), doIt((mem) => (mem.zero = ctrl.weightG)),
        doIt(() => (world.knownMassG = 50)), wait(1200), doIt((mem) => {
          mem.fifty = ctrl.weightG;
          world.knownMassG = 0;
          mem.b1 = ctrl.blockers(passMs, true);
          ui?.syncControls();
        }),
        (s0, mem) => finish(mem.b0.includes('calibrated') && mem.tare && mem.cal && Math.abs(mem.zero) < 1 && Math.abs(mem.fifty - 50) < 1 && !mem.b1.includes('calibrated'),
          `Passed: before the tare the empty dish read ${g1(mem.before)} and feeding was refused (not calibrated). After the tare ${g1(mem.afterTare)}, after calibrating with 100 g: ${(store.cal).toFixed(1)} counts per gram. Empty ${g1(mem.zero)}, 50 g check weight ${g1(mem.fifty)}.`,
          `Failed: tare ${mem.tare}, calibrate ${mem.cal}, empty ${mem.zero?.toFixed(2)} g, 50 g reads ${mem.fifty?.toFixed(2)} g.`),
      ],
      () => [
        fresh(), wait(1500), doIt((mem) => {
          ctrl.setRation(S.rationDefaultG);
          mem.m0 = world.totalG;
          mem.h0 = world.hopperG;
          mem.d0 = doneCount;
          ui?.syncControls();
        }),
        ...feedAndWait(() => doneCount > 0, 400000),
        (s0, mem) => {
          const r = ctrl.lastResult || {};
          const drift = Math.abs(world.totalG - mem.m0);
          return finish(r.ok && !r.excess && Math.abs(world.plateG - r.delivered) < 1 && drift < 1e-6 && doorOpen() && !world.outputsOn && st() === 'IDLE',
            `Passed: target ${g1(r.target)}, the program weighed ${g1(r.delivered)}, the plate really holds ${g1(world.plateG)} after ${r.scoops} scoops. ${g1(mem.h0 - world.hopperG)} left the hopper, the rest of each spoon went back. Food lost: ${drift.toFixed(6)} g. Door open, outputs off.`,
            `Failed: result ${JSON.stringify(r)}, plate ${g1(world.plateG)}, mass drift ${drift.toFixed(4)} g, state ${st()}.`);
        },
      ],
      () => [
        // a) jam
        fresh(), wait(1500), ...feedAndWait(() => st() === 'CYCLE' && ctrl.phase === 'LIFT', 60000),
        doIt((mem) => {
          world.servo[1].jam = true;
          mem.t0 = passMs;
        }),
        waitFor(() => st() === 'FAULT', 20000),
        doIt((mem) => {
          mem.jam = { ok: ctrl.fault === FAULT.JAM && armLimp(), ms: faultAt - mem.t0 };
          world.servo[1].jam = false;
        }),
        // b) load cell wire off
        fresh(), wait(1500), ...feedAndWait(() => st() === 'CYCLE', 30000), wait(2000),
        doIt(() => (world.scaleMode = 'disconnected')), waitFor(() => st() === 'FAULT', 5000),
        doIt((mem) => (mem.scale = { ok: ctrl.fault === FAULT.SCALE && armLimp() })),
        // c) empty hopper
        fresh({ hopperG: 0 }), wait(1500), ...feedAndWait(() => st() === 'FAULT', 300000),
        doIt((mem) => (mem.empty = { ok: ctrl.fault === FAULT.HOPPER_EMPTY && armLimp(), scoops: ctrl.scoops })),
        // d) power cut while carrying food
        fresh(), wait(1500), ...feedAndWait(() => st() === 'CYCLE' && ctrl.phase === 'TO_PLATE', 60000),
        doIt((mem) => {
          mem.spoon = world.spoonG;
          powerCut(2000);
        }),
        wait(8000),
        doIt((mem) => (mem.power = { ok: st() === 'FAULT' && ctrl.fault === FAULT.INTERRUPTED && !world.outputsOn && armLimp() && doneCount === 0 })),
        (s0, mem) => finish(mem.jam.ok && mem.scale.ok && mem.empty.ok && mem.power.ok,
          `Passed. Jam: FAULT ${mem.jam.ms} ms after the shoulder stuck, arm unpowered. Load cell wire off: FAULT (scale). Empty hopper: FAULT after ${mem.empty.scoops} empty scoops. Power cut with ${g1(mem.spoon)} in the spoon: after the restart FAULT (interrupted), no second ration, outputs off.`,
          `Failed: jam ${mem.jam.ok}, scale ${mem.scale.ok}, empty hopper ${mem.empty.ok}, power cut ${mem.power.ok}.`),
      ],
      () => [
        fresh(), wait(1500), ...feedAndWait(() => st() === 'CYCLE' && ctrl.phase === 'LIFT', 60000),
        doIt((mem) => {
          world.cat = true;
          mem.t0 = passMs;
          ui?.syncControls();
        }),
        waitFor(() => st() === 'FAULT', 2000), wait(3000),
        doIt((mem) => {
          mem.stop = { ok: ctrl.fault === FAULT.PRESENCE && armLimp() && doorShut(), ms: faultAt - mem.t0 };
          mem.r0 = refusedCount;
          ctrl.reset();
        }),
        wait(500), doIt((mem) => {
          mem.refused = refusedCount > mem.r0 && st() === 'FAULT';
          world.cat = false;
          ui?.syncControls();
        }),
        wait(10000), doIt((mem) => {
          mem.stayed = st() === 'FAULT' && armLimp();
          ctrl.reset();
        }),
        waitFor(() => st() === 'IDLE', 120000),
        (s0, mem) => finish(mem.stop.ok && mem.refused && mem.stayed && st() === 'IDLE' && world.spoonG < 0.01 && doorOpen() && !world.outputsOn,
          `Passed: the arm stopped ${mem.stop.ms} ms after the beam broke, the door stayed shut. Reset refused while Pancho was there. 10 s after he left it was still in FAULT. The tutor’s reset emptied the spoon into the hopper, parked the arm, opened the door.`,
          `Failed: stop ${mem.stop?.ok}, refused ${mem.refused}, stayed ${mem.stayed}, state ${st()}, spoon ${g1(world.spoonG)}.`),
      ],
    ];
    function finish(ok, pass, fail) {
      guided.result = { ok, text: ok ? pass : fail };
      ui?.setGuided(guided.n, guided.result);
      log(`# Experiment ${guided.n + 1}: ${ok ? 'passed' : 'failed'}`, 'c');
      guided.done = true;
      return true;
    }
    function startGuided(n) {
      speed = GUIDED_SPEED;
      ui?.setSpeed(speed);
      guided = { n, steps: TESTS[n](), i: 0, st: {}, mem: {}, done: false };
      ui?.setGuided(n, null, true);
      log(`# Experiment ${n + 1} started at ${GUIDED_SPEED}×.`, 'c');
      if (!simOn) {
        simOn = true;
        paused = false;
      }
    }
    function stepGuided() {
      if (!guided) return;
      if (guided.done) {
        guided = null;
        ui?.setGuidedBusy(false);
        return;
      }
      const step = guided.steps[guided.i];
      if (step(guided.st, guided.mem)) {
        guided.st = {};
        guided.i++;
      }
    }
    function cancelGuided(msg) {
      if (!guided) return;
      ui?.setGuided(guided.n, { ok: false, text: msg });
      guided = null;
      ui?.setGuidedBusy(false);
    }

    /* ---------- labels ---------- */
    const A = scene.anchors;
    const doorText = () => (doorShut() ? 'closed' : doorOpen() ? 'open' : 'moving');
    const labels = [
      { id: 'spoon', cls: 'compact', title: 'Spoon', sub: () => `<span class="val">${g1(world.spoonG)}</span>`, at: A.spoon, side: 'right' },
      { id: 'plate', cls: 'compact', title: 'Plate · load cell', sub: () => `<span class="val">${g1(world.plateG)}</span>`, at: A.plate, side: 'right' },
      { id: 'hopper', cls: 'compact', title: 'Hopper', sub: () => `<span class="val">${Math.round(world.hopperG)} g</span>`, at: A.hopper, side: 'left' },
      { id: 'door', cls: 'compact', title: 'Access door', sub: () => `<span class="val">${doorText()}</span>`, at: A.door, side: 'right' },
      { id: 'cat', cls: 'compact', title: 'Pancho', sub: () => `<span class="val">${world.cat ? 'at the window' : 'away'}</span> · click`, at: A.cat, side: 'right' },
      { id: 'beam', cls: 'compact', title: 'IR beam · IO27', sub: () => `<span class="val">${world.cat ? 'broken' : 'clear'}</span>`, at: A.beam, side: 'left', hideNarrow: true },
      { id: 'estop', cls: 'compact', title: 'E-stop · IO25', sub: () => `<span class="val">${world.estopPressed ? 'pressed' : 'ready'}</span> · click`, at: A.estop, side: 'right' },
      { id: 'btn', cls: 'compact', title: 'Button · IO13', sub: () => `<span class="val">${buttonDown ? 'pressed' : 'released'}</span>`, at: A.button, side: 'left' },
      { id: 'pca', cls: 'compact', title: 'PCA9685 · 0x40', sub: () => `<span class="val">OE ${world.outputsOn ? 'LOW: pulses on' : 'HIGH: off'}</span>`, at: A.pca, side: 'right' },
      { id: 'ina', cls: 'compact', title: 'INA219 · 0x45', sub: () => `<span class="val">${Math.round(world.currentMa())} mA</span>`, at: A.ina, side: 'right', hideNarrow: true },
      { id: 'hx', cls: 'compact', title: 'HX711', sub: () => `<span class="val">${ctrl.running && ctrl.lastCounts != null ? ctrl.lastCounts : '–'}</span>`, at: A.hx, side: 'left', hideNarrow: true },
      { id: 'esp', title: 'ESP32-DevKitC', sub: 'WROOM-32E module', at: A.esp, side: 'left', hideNarrow: true },
      { id: 'psu', title: '6 V 5 A supply', sub: 'servos only', at: A.psu, side: 'right', hideNarrow: true },
      { id: 'lid', cls: 'compact', title: 'Lid switch · IO26', sub: () => `<span class="val">${world.lidOpen ? 'open' : 'closed'}</span>`, at: A.lid, side: 'left', hideNarrow: true },
      { id: 'led', title: 'LED · IO4', sub: 'status', at: A.led, side: 'left', hideNarrow: true },
      { id: 'base', cls: 'compact', title: 'Arm · 4 servos', sub: () => `<span class="val">${world.joints().map((v) => Math.round(v)).join(' / ')}°</span>`, at: A.base, side: 'left', hideNarrow: true },
    ];

    /* ---------- notebook ---------- */
    function mountUI(tabs) {
      autoStart = true;
      tabs.sim.innerHTML = simHtml(S);
      tabs.code.innerHTML = codeHtml(S);
      tabs.how.innerHTML = howHtml(S);
      const code = renderCode($('#code', tabs.code), source, 'cpp');
      bindCopy($('#copyBtn', tabs.code), () => source, $('#code', tabs.code));
      const L = {
        IDLE: code.find(/^\s*case IDLE:/), DOOR_CLOSING: code.find(/^\s*case DOOR_CLOSING:/), TARE: code.find(/^\s*case TARE:/),
        DOOR_OPENING: code.find(/^\s*case DOOR_OPENING:/), MANUAL: code.find(/^\s*case MANUAL:/), FAULT: code.find(/^\s*case FAULT:/), RECOVERING: code.find(/^\s*case RECOVERING:/),
        TO_HOPPER: code.find(/case TO_HOPPER:/), DIP: code.find(/case DIP:/), SCOOP: code.find(/case SCOOP:/), LIFT: code.find(/case LIFT:/),
        TO_PLATE: code.find(/case TO_PLATE:/), POUR: code.find(/case POUR: \{/), UNPOUR: code.find(/case UNPOUR:/), WEIGH: code.find(/case WEIGH: \{/),
        TO_DUMP: code.find(/case TO_DUMP: case R_TO_DUMP:/), DUMP: code.find(/case DUMP: case R_DUMP:/), UNDUMP: code.find(/case UNDUMP: case R_UNDUMP:/), HOME: code.find(/case HOME: case R_HOME:/),
        ESTOP: code.find(/enterFault\(F_ESTOP, now\)/), LID_OPEN: code.find(/enterFault\(F_LID, now\)/), JAM: code.find(/enterFault\(F_JAM, now\)/),
        PRESENCE: code.find(/enterFault\(F_PRESENCE, now\)/), SCALE: code.find(/!scaleOk && \(state == TARE/), HOPPER_EMPTY: code.find(/enterFault\(F_HOPPER_EMPTY, now\)/),
        INTERRUPTED: code.find(/enterFault\(F_INTERRUPTED, now\)/), STOPPED: code.find(/enterFault\(F_STOPPED, now\)/), DOOR: code.find(/enterFault\(F_DOOR, now\)/),
        UNREACHABLE: code.find(/enterFault\(F_UNREACHABLE, now\); return false;/),
      };
      const unmatched = Object.entries(L).filter(([, v]) => v < 0).map(([k]) => k);
      const steps = renderSteps($('#steps', tabs.how), STEPS, env.userView);
      const consoleLog = createConsole($('#console', tabs.sim), 12);
      ui = { code, L, log: consoleLog, steps };

      const q = (s) => $(s, tabs.sim);
      const box = q('#cfBox'), main = q('#cfMain'), sub = q('#cfSub'), fill = q('#cfFill'), leftEl = q('#cfLeft'), totalEl = q('#cfTotal');
      const chState = q('#chState'), chScale = q('#chScale'), chPlate = q('#chPlate'), chCur = q('#chCur');
      const btnRun = q('#btnRun'), btnOff = q('#btnOff'), btnPower = q('#btnPower');
      const btnFeed = q('#btnFeed'), btnFeedNow = q('#btnFeedNow'), btnPause = q('#btnPause'), btnStopArm = q('#btnStopArm'), btnReset = q('#btnReset'), btnHold = q('#btnHold');
      const btnTare = q('#btnTare'), btnCal = q('#btnCal'), optWeight = q('#optWeight'), calOut = q('#calOut');
      const btnManual = q('#btnManual'), btnLeave = q('#btnLeave'), ikOut = q('#ikOut');
      const rationRange = q('#rationRange'), rationVal = q('#rationVal'), armSpeed = q('#armSpeed'), armSpeedVal = q('#armSpeedVal');
      const jq = [0, 1, 2, 3].map((j) => q(`#jq${j}`)), jv = [0, 1, 2, 3].map((j) => q(`#jv${j}`));
      const progEl = q('#progState'), speedInfo = q('#speedInfo'), clockInfo = q('#clockInfo'), blockInfo = q('#blockInfo'), poseInfo = q('#poseInfo');
      const opt = { cat: q('#optCat'), lid: q('#optLid'), estop: q('#optEstop'), jam: q('#optJam'), door: q('#optDoor'), reach: q('#optReach'), labels: q('#optLabels') };
      const radios = $$('input[name=scaleMode]', tabs.sim);
      const jointRows = $$('#jointTable tr[data-j]', tabs.sim);
      const massCells = $$('#massTable tr:last-child td', tabs.sim);
      const speedBtns = $$('.speed', tabs.sim);
      const guidedItems = $$('#guided li', tabs.sim);
      const canvas = q('#cfCanvas');

      opt.labels.checked = env.options.labels;
      opt.labels.addEventListener('change', (e) => (env.options.labels = e.target.checked));
      $$('.chip-btn[data-view]', tabs.sim).forEach((b) => b.addEventListener('click', () => env.userView(b.dataset.view)));
      consoleLog('# Web simulation. No real servo, sensor or GPIO is used.', 'c');
      consoleLog(`# Read from cat_feeder.ino: links ${S.h0}/${S.l1}/${S.l2}/${S.l3} mm, speeds ${S.speedMaxDps}/${S.speedLoadedDps}/${S.speedPourDps}°/s, ration ${S.rationDefaultG} g (${S.rationMinG} to ${S.rationMaxG}), jam ${S.jamMa} mA.`, 'c');
      if (missing.length) consoleLog(`# Not found in the sketch (defaults used): ${missing.join(', ')}`, 'c');
      if (unmatched.length) consoleLog(`# Could not match these code lines to highlight: ${unmatched.join(', ')}`, 'c');

      const user = (fn) => () => {
        if (!ctrl.running) {
          log('# The board is off. Press Run first.', 'c');
          return;
        }
        fn();
      };
      btnRun.addEventListener('click', () => (simOn ? setPaused(false) : startSim()));
      btnOff.addEventListener('click', () => {
        cancelGuided('Cancelled: the simulation was stopped.');
        stopSim('user');
      });
      btnPower.addEventListener('click', () => {
        cancelGuided('Cancelled: power cut.');
        powerCut(2000);
      });
      btnFeed.addEventListener('click', user(() => ctrl.feed(false)));
      btnFeedNow.addEventListener('click', user(() => ctrl.feed(true)));
      btnPause.addEventListener('click', user(() => {
        ctrl.pause(!ctrl.paused);
        log(ctrl.paused ? '# arm paused (h): it holds its position' : '# arm continues', 'c');
      }));
      btnStopArm.addEventListener('click', user(() => ctrl.stop()));
      btnReset.addEventListener('click', user(() => ctrl.reset()));
      btnTare.addEventListener('click', user(() => {
        if (!ctrl.tare()) log('# tare refused: only in IDLE with a working load cell', 'c');
      }));
      btnCal.addEventListener('click', user(() => {
        if (world.knownMassG !== 100) {
          log('# put the 100 g weight on the plate first (checkbox), wait a second, then calibrate', 'c');
          return;
        }
        if (!ctrl.calibrate(100)) log('# calibration refused: IDLE, a working load cell, and the tare done first', 'c');
      }));
      optWeight.addEventListener('change', () => (world.knownMassG = optWeight.checked ? 100 : 0));
      btnManual.addEventListener('click', user(() => ctrl.enterManual()));
      btnLeave.addEventListener('click', user(() => ctrl.leaveManual()));
      jq.forEach((el) => el.addEventListener('input', () => {
        if (st() !== 'MANUAL' || ctrl.phase !== 'READY') return;
        ctrl.manualJoints(jq.map((e) => Number(e.value)));
      }));
      q('#btnGoPt').addEventListener('click', user(() => {
        const p = { x: Number(q('#px').value), y: Number(q('#py').value), z: Number(q('#pz').value), phi: Number(q('#pphi').value) };
        const r = ctrl.manualPoint(p);
        ikOut.textContent = r.ok ? `Reachable: q = (${r.q.map((v) => v.toFixed(1)).join(', ')})°. The arm moves there at ${S.speedManualDps}°/s at most.` : `Refused: ${IK_TEXT[r.reason] || r.reason}${r.joints ? ` (${r.joints.map((j) => JOINTS[j]).join(', ')})` : ''}. The arm does not move.`;
      }));
      rationRange.addEventListener('input', () => ctrl.setRation(Number(rationRange.value)));
      armSpeed.addEventListener('input', () => ctrl.setSpeedPct(Number(armSpeed.value)));
      q('#btnFill').addEventListener('click', () => {
        const add = WORLD.hopperCapG - world.hopperG;
        world.hopperG += add;
        massAdded += add;
      });
      q('#btnEmpty').addEventListener('click', () => {
        massAdded -= world.hopperG;
        world.hopperG = 0;
      });
      q('#btnClearPlate').addEventListener('click', () => {
        if (!doorOpen() || world.outputsOn) {
          log('# the plate can only be taken out with the arm parked and the door open', 'c');
          return;
        }
        massAdded -= world.plateG + world.floorG;
        world.plateG = 0;
        world.floorG = 0;
      });
      opt.cat.addEventListener('change', () => (world.cat = opt.cat.checked));
      opt.lid.addEventListener('change', () => (world.lidOpen = opt.lid.checked));
      opt.estop.addEventListener('change', () => (world.estopPressed = opt.estop.checked));
      opt.jam.addEventListener('change', () => (world.servo[1].jam = opt.jam.checked));
      opt.door.addEventListener('change', () => (world.door.blocked = opt.door.checked));
      opt.reach.addEventListener('change', () => (showReach = opt.reach.checked));
      radios.forEach((r) => r.addEventListener('change', () => r.checked && (world.scaleMode = r.value)));
      const down = () => (buttonDown = true);
      const up = () => (buttonDown = false);
      btnHold.addEventListener('pointerdown', (e) => {
        btnHold.setPointerCapture?.(e.pointerId);
        down();
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) btnHold.addEventListener(ev, up);
      btnHold.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          down();
        }
      });
      btnHold.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && up());
      speedBtns.forEach((b) => b.addEventListener('click', () => {
        speed = Number(b.dataset.speed);
        ui.setSpeed(speed);
      }));
      guidedItems.forEach((li) => $('button', li).addEventListener('click', () => {
        if (guided) return;
        startGuided(Number(li.dataset.n));
        ui.setGuidedBusy(true);
      }));

      ui.setSpeed = (v) => speedBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === v)));
      ui.setGuided = (n, result, started) => {
        const li = guidedItems[n];
        const em = $('em', li);
        li.classList.toggle('running', !!started);
        li.classList.toggle('ok', !!result && result.ok);
        li.classList.toggle('bad', !!result && !result.ok);
        em.textContent = started ? 'Running…' : result ? result.text : '';
        if (started) guidedItems.forEach((o) => o !== li && (o.classList.remove('running', 'ok', 'bad'), ($('em', o).textContent = '')));
      };
      ui.setGuidedBusy = (busy) => guidedItems.forEach((li) => ($('button', li).disabled = busy));
      ui.syncControls = () => {
        opt.cat.checked = world.cat;
        opt.lid.checked = world.lidOpen;
        opt.estop.checked = world.estopPressed;
        opt.jam.checked = world.servo[1].jam;
        opt.door.checked = world.door.blocked;
        optWeight.checked = world.knownMassG === 100;
        radios.forEach((r) => (r.checked = r.value === world.scaleMode));
        rationRange.value = String(ctrl.ration);
        armSpeed.value = String(ctrl.speedPct);
        const qq = world.joints();
        jq.forEach((el, j) => (el.value = String(Math.round(qq[j]))));
      };
      ui.refresh = () => {
        btnRun.disabled = simOn && !paused;
        btnRun.textContent = simOn && paused ? '▶ Resume' : '▶ Run';
        btnOff.disabled = !simOn;
        if (!ctrl.running) code.setActive(-1);
      };
      ui.setSpeed(speed);
      ui.syncControls();
      ui.refresh();

      let lastDraw = 0;
      const setText = (el, t) => el.textContent !== t && (el.textContent = t);
      const setHtml = (el, h) => el.innerHTML !== h && (el.innerHTML = h);
      ui.frame = (tNow) => {
        const run = ctrl.running;
        const sName = run ? ctrl.state : 'OFF';
        let m, s2;
        if (!simOn) {
          m = 'Simulation stopped';
          s2 = 'Board and servo power off. Press Run.';
        } else if (!run) {
          m = 'Power cut';
          s2 = 'The ESP32 and the servos have no power. The servos are limp; the food in the spoon stays where it is.';
        } else if (sName === 'IDLE') {
          const b = ctrl.blockers(passMs, true);
          m = 'Parked: door open, arm off';
          s2 = b.length ? `Feeding not possible yet: ${b.map((k) => BLOCKER_TEXT[k]).join('; ')}.` : ctrl.cooldownActive(passMs) ? `Ready. Next ration in ${Math.ceil(ctrl.cooldownLeftMs(passMs) / 60000)} min (or Feed now).` : 'Ready: press Feed (or the button).';
        } else if (sName === 'DOOR_CLOSING') {
          m = 'Closing the door';
          s2 = 'Nothing else moves until the door is shut. Pancho at the window opens it again.';
        } else if (sName === 'TARE') {
          m = 'Weighing the plate';
          s2 = 'What is already on the plate is the baseline: the ration is counted on top of it.';
        } else if (sName === 'CYCLE') {
          m = ctrl.recovering ? `Recovery: ${ctrl.phase}` : `Feeding: ${ctrl.phase}${ctrl.paused ? ' (paused)' : ''}`;
          s2 = ctrl.recovering ? 'Emptying the spoon back into the hopper, then home.' : `Ration ${g1(ctrl.target)}: ${g1(Math.max(0, ctrl.delivered ?? 0))} weighed after ${ctrl.scoops} scoop${ctrl.scoops === 1 ? '' : 's'}.`;
        } else if (sName === 'DOOR_OPENING') {
          m = 'Arm parked and off: opening the door';
          s2 = 'The servo outputs are off before the plate can be reached.';
        } else if (sName === 'MANUAL') {
          m = `Manual mode: ${ctrl.phase === 'READY' ? 'ready' : ctrl.phase === 'HOMING' ? 'going home' : 'closing the door'}`;
          s2 = 'Use the joint sliders or a point. The door stays shut until you leave manual mode.';
        } else if (sName === 'RECOVERING') {
          m = 'Recovering';
          s2 = 'Door shut, arm going home slowly.';
        } else {
          m = `FAULT: ${ctrl.fault}`;
          s2 = `${FAULT_TEXT[ctrl.fault]}. Arm off, door kept shut. Remove the cause, then Reset (long press).`;
        }
        box.className = `alarm-box ${BANNER[simOn ? sName : 'OFF']}`;
        setText(main, m);
        setText(sub, s2);
        const mv = ctrl.move;
        const prog = mv && mv.duration > 0 ? Math.min(1, ctrl.moveT / mv.duration) : 0;
        fill.style.width = run && ctrl.moving() ? `${(prog * 100).toFixed(1)}%` : '0%';
        setText(leftEl, run && ctrl.moving() ? `move ${fmtS((mv.duration - ctrl.moveT) * 1000)} left` : '');
        setText(totalEl, run ? `ration ${g1(ctrl.ration)} · arm speed ${ctrl.speedPct} %` : '');

        setText($('b', chState), run ? `${sName}${ctrl.phase ? ` · ${ctrl.phase}` : ''}` : simOn ? 'NO POWER' : 'OFF');
        chState.className = `chip prog-${sName === 'FAULT' ? 'locked' : sName === 'IDLE' ? 'idle' : sName === 'OFF' ? 'stopped' : 'watering'}`;
        setText($('b', chScale), run ? (ctrl.scaleOk ? `${g1(ctrl.weightG)}${store.calibrated ? '' : ' (not calibrated)'}` : 'NO READING') : '–');
        chScale.classList.toggle('on', run && !ctrl.scaleOk);
        setText($('b', chPlate), g1(world.plateG));
        const mA = world.currentMa();
        setText($('b', chCur), `${Math.round(mA)} mA`);
        chCur.classList.toggle('on', mA > S.jamMa);

        // joints: program command, real servo, pulse
        const real = world.joints();
        jointRows.forEach((row, j) => {
          const td = $$('td', row);
          if (j < 4) {
            const servoDeg = world.servo[j].pos;
            setText(td[1], run ? deg(ctrl.q[j]) : '–');
            setText(td[2], `${deg(real[j])} (servo ${servoDeg.toFixed(0)}°)`);
            setText(td[3], world.servo[j].cmd == null || !world.driven() ? 'no pulse' : `${Math.round(ctrl.pulseUs(world.servo[j].cmd))} µs`);
          } else {
            setText(td[1], run ? `${(ctrl.doorCmd ?? 0).toFixed(0)}°` : '–');
            setText(td[2], `${world.door.pos.toFixed(1)}° (${doorText()})`);
            setText(td[3], world.door.cmd == null || !world.driven() ? 'no pulse' : `${Math.round(ctrl.pulseUs(world.door.cmd))} µs`);
          }
        });
        const pose = world.pose();
        const tgt = planCache.target;
        setHtml(poseInfo, `Spoon: x ${pose.spoon.x.toFixed(0)}, y ${pose.spoon.y.toFixed(0)}, z ${pose.spoon.z.toFixed(0)} mm, pitch ${pose.phi.toFixed(0)}°.${tgt && ctrl.moving() ? ` Target: x ${tgt.x.toFixed(0)}, y ${tgt.y.toFixed(0)}, z ${tgt.z.toFixed(0)} mm.` : ''}`);
        if (!(st() === 'MANUAL' && ctrl.phase === 'READY') || !jq.some((e) => e === document.activeElement)) {
          jq.forEach((el, j) => {
            if (document.activeElement !== el) el.value = String(Math.round(ctrl.running ? ctrl.q[j] : real[j]));
          });
        }
        jq.forEach((el, j) => setText(jv[j], `${Number(el.value)}°`));
        const manualReady = run && st() === 'MANUAL' && ctrl.phase === 'READY';
        jq.forEach((el) => (el.disabled = !manualReady));
        q('#btnGoPt').disabled = !manualReady;
        btnLeave.disabled = !manualReady;
        btnManual.disabled = !(run && st() === 'IDLE');
        btnFeed.disabled = btnFeedNow.disabled = !(run && st() === 'IDLE');
        btnTare.disabled = btnCal.disabled = !(run && st() === 'IDLE');
        btnPause.disabled = !(run && ['CYCLE', 'MANUAL', 'RECOVERING'].includes(st()));
        setText(btnPause, ctrl.paused ? '▶ Continue arm' : '❚❚ Pause arm');
        btnStopArm.disabled = !(run && !['IDLE', 'FAULT'].includes(st()));
        btnReset.disabled = !(run && st() === 'FAULT');
        btnHold.classList.toggle('held', buttonDown);
        setText(rationVal, `${ctrl.ration} g`);
        setText(armSpeedVal, `${ctrl.speedPct} %`);
        setText(blockInfo, run && st() === 'IDLE' ? `Cooldown: ${ctrl.cooldownActive(passMs) ? `${Math.ceil(ctrl.cooldownLeftMs(passMs) / 60000)} min left` : 'over'}. LED ${ledOn() ? 'on' : 'off'}.` : run ? `LED ${ledOn() ? 'on' : 'off'}.` : '');
        setText(calOut, store.calibrated ? `Calibrated: ${store.cal.toFixed(1)} counts per gram, offset ${Math.round(store.offset)} counts (saved in flash).` : `Not calibrated yet: the sketch values (${S.scaleCal} counts/g, offset ${S.scaleOffset}) are only placeholders. Tare, put the 100 g weight on, calibrate, take it off.`);

        const bal = world.totalG - massStart - massAdded;
        [world.hopperG, world.spoonG, world.plateG, world.floorG, world.eatenG].forEach((v, k) => setText(massCells[k], g1(v)));
        setText(massCells[5], `${Math.abs(bal) < 0.0005 ? '0.000' : bal.toFixed(3)} g`);

        setText(progEl, run ? `Board: running · ${sName}${paused ? ' · PAUSED' : ''}` : simOn ? 'Board: NO POWER' : 'Board: OFF');
        progEl.classList.toggle('on', run);
        progEl.classList.toggle('stopped', !run);
        setText(speedInfo, `${speed}×`);
        setText(clockInfo, simOn && paused ? `Paused at ${fmtS(passMs)} of simulated time. Press Play (top bar) or Resume.` : simOn ? `Simulated time: ${fmtS(passMs)}. At ${speed}× one real second is ${speed} simulated seconds.` : 'Simulated time stops with the simulation.');

        let active = -1;
        if (run) {
          if (sName === 'CYCLE') active = L[ctrl.phase.replace(/^R_/, '')] ?? -1;
          else if (sName === 'FAULT') active = L[ctrl.fault] ?? L.FAULT;
          else active = L[sName] ?? -1;
        }
        code.setActive(active);
        code.setTag(L.POUR, run && ctrl.phase === 'POUR' ? `← pitch ${ctrl.pourPhi.toFixed(0)}°, ${g1(ctrl.weightG - (ctrl.baseline ?? 0))} on the plate` : '');

        if (tNow - lastDraw > 80) {
          lastDraw = tNow;
          drawPlot(canvas);
        }
      };
    }

    const WIN = 120;
    function drawPlot(canvas) {
      const ctx = canvas.getContext('2d');
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      const padL = 52, padR = 52, top = 14, plotH = 170, plotW = w - padL - padR;
      const tNow = passMs / 1000;
      const X = (t) => padL + ((t - (tNow - WIN)) / WIN) * plotW;
      const zMax = 250, gMax = Math.max(40, (ctrl.target || ctrl.ration) * 1.5);
      const Yz = (z) => top + (1 - Math.min(zMax, Math.max(0, z)) / zMax) * plotH;
      const Yg = (g) => top + (1 - Math.min(gMax, Math.max(0, g)) / gMax) * plotH;
      const SANS = '"Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(padL, top, plotW, plotH);
      ctx.font = `13px ${SANS}`;
      ctx.fillStyle = '#e0a53a';
      ctx.textAlign = 'right';
      for (const z of [0, 100, 200]) ctx.fillText(`${z} mm`, padL - 6, Yz(z) + 4);
      ctx.fillStyle = '#4cc27a';
      ctx.textAlign = 'left';
      for (const g of [0, Math.round(gMax / 2), Math.round(gMax)]) ctx.fillText(`${g} g`, padL + plotW + 6, Yg(g) + 4);
      const target = ctrl.target || ctrl.ration;
      ctx.strokeStyle = '#4cc27a';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, Yg(target));
      ctx.lineTo(padL + plotW, Yg(target));
      ctx.stroke();
      ctx.setLineDash([]);
      const line = (key, Y, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        let started = false;
        for (const r of hist) {
          if (r.t < tNow - WIN || r[key] == null) {
            started = false;
            continue;
          }
          const x = X(r.t), y = Y(r[key]);
          if (!started) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          started = true;
        }
        ctx.stroke();
      };
      line('z', Yz, '#ffb35a', 2);
      line('g', Yg, '#4cc27a', 2.5);
      ctx.fillStyle = '#8c93b3';
      ctx.textAlign = 'center';
      for (let s = 0; s <= WIN; s += 30) ctx.fillText(s === 0 ? 'now' : `-${s} s`, Math.min(padL + plotW - 16, Math.max(padL + 16, X(tNow - s))), h - 12);
    }

    /* ---------- runtime ---------- */
    function resetAll() {
      ctrl.powerOff();
      // the simulated flash keeps the scale calibration (as the board would); a page turn is not a cut cycle
      store = { ...factoryPrefs(), offset: store.offset, cal: store.cal, calibrated: store.calibrated };
      world = new FeederWorld(S, {}, 11);
      massStart = world.totalG;
      massAdded = 0;
      ctrl = new CatFeeder(S, io);
      buttonDown = false;
      simOn = false;
      paused = false;
      powerOnAt = null;
      speed = 5;
      guided = null;
      autoStart = false;
      hist = [];
      devMs = passMs = 0;
      doneCount = refusedCount = 0;
      planCache = { move: null, target: null, plan: [] };
    }
    function updatePlan() {
      const mv = ctrl.running ? ctrl.move : null;
      if (mv === planCache.move) return;
      planCache.move = mv;
      if (!mv || mv.duration === 0) {
        planCache.target = null;
        planCache.plan = [];
        return;
      }
      planCache.target = forward(mv.to, arm).spoon;
      planCache.plan = Array.from({ length: 40 }, (_, i) => forward(sampleMove(mv, (mv.duration * i) / 39), arm).spoon);
    }

    return {
      root: scene.root,
      popDuration: scene.popDuration,
      labels,
      mountUI,
      unmountUI() {
        ui = null;
      },
      frameUI(t) {
        ui?.frame(t);
        ui?.steps.setActive(this.activeStep());
      },
      setPop(tp) {
        popT = tp;
        scene.setPop(tp);
      },
      update(time, dt) {
        if (autoStart && popT >= scene.popDuration - 0.2) {
          autoStart = false;
          startSim();
        }
        if (simOn && !paused) {
          devMs += Math.min(dt, 0.1) * 1000 * speed;
          const target = Math.floor(devMs);
          while (passMs < target && simOn) {
            passMs++;
            if (powerOnAt != null && passMs >= powerOnAt) bootBoard('power');
            if (ctrl.running) ctrl.loop(passMs);
            if (passMs % 10 === 0) world.step(0.01);
            if (guided) stepGuided();
          }
          if (passMs - lastHist >= 250) {
            lastHist = passMs;
            hist.push({ t: passMs / 1000, z: world.pose().spoon.z, g: ctrl.running && ctrl.scaleOk ? net() : null });
            if (hist.length > 700) hist.splice(0, hist.length - 700);
          }
        }
        stepGuided();
        updatePlan();
        view.led += ((ledOn() ? 1 : 0) - view.led) * (1 - Math.exp(-dt * 20));
        view.button += ((buttonDown ? 1 : 0) - view.button) * (1 - Math.exp(-dt * 25));
        scene.update(time, dt, {
          q: world.joints(), door: world.door.pos, hopperG: world.hopperG, spoonG: world.spoonG, plateG: world.plateG, floorG: world.floorG,
          flows: world.flows, cat: world.cat, lid: world.lidOpen, estop: world.estopPressed, led: view.led, button: view.button,
          target: ctrl.moving() ? planCache.target : null, plan: ctrl.moving() ? planCache.plan : [], showReach,
          outputs: world.outputsOn && world.driven(), current: Math.min(1, world.currentMa() / 2500), armDriven: !!ctrl.armDriven && world.driven(),
        });
      },
      activeStep() {
        if (!ctrl.running) return -1;
        const s = ctrl.state, p = ctrl.phase;
        if (s === 'FAULT') return 8;
        if (s === 'MANUAL') return 4;
        if (s === 'DOOR_CLOSING' || s === 'DOOR_OPENING' || s === 'IDLE') return 0;
        if (s === 'TARE') return 7;
        if (['TO_HOPPER', 'DIP', 'SCOOP', 'LIFT'].includes(p)) return 5;
        if (['TO_PLATE', 'POUR', 'UNPOUR'].includes(p)) return 6;
        if (p === 'WEIGH') return 7;
        return 3;
      },
      /** Stop the program and every animation (page turn, reading mode, closing the book, back to the library). */
      stop(reason) {
        const was = simOn;
        resetAll();
        if (ui) {
          ui.setSpeed(speed);
          ui.setGuidedBusy(false);
          ui.syncControls();
          ui.refresh();
          if (reason === 'reading') ui.log('# Simulation stopped while reading. Press Run to start it again.', 'c');
          else if (was) ui.log('# Simulation stopped.', 'c');
        }
      },
      pick(raycaster) {
        if (popT < 2.4 || !scene.root.visible) return false;
        const hits = raycaster.intersectObjects(scene.hitMeshes(), false);
        if (!hits.length) return false;
        pickWhat = hits[0].object.userData.hit || null;
        return !!pickWhat;
      },
      pressStart() {
        pressMoved = false;
        if (pickWhat === 'button') buttonDown = true;
      },
      pressMove() {
        pressMoved = true;
      },
      pressEnd() {
        if (pickWhat === 'button') buttonDown = false;
        else if (pickWhat === 'estop' && !pressMoved) {
          world.estopPressed = !world.estopPressed;
          log(world.estopPressed ? '# E-stop pressed: servo power cut by the switch' : '# E-stop released (turned to unlatch). The program still needs a reset.', 'c');
          ui?.syncControls();
        } else if (pickWhat === 'cat' && !pressMoved) {
          world.cat = !world.cat;
          log(world.cat ? '# Pancho comes to the window' : '# Pancho walks away', 'c');
          ui?.syncControls();
        }
        pickWhat = null;
      },
      releaseAll() {
        buttonDown = false;
        pickWhat = null;
      },
      runFromQuery(what) {
        if (what === 'run') autoStart = true;
      },
      debugOn() {
        autoStart = true;
      },
      /** Camera bar play / pause. */
      isRunning: () => simOn && !paused,
      setRunning(on) {
        if (on) {
          if (!simOn) startSim();
          else setPaused(false);
        } else setPaused(true);
      },
      inspect() {
        return {
          simOn, paused, running: ctrl.running, state: ctrl.state, phase: ctrl.phase, fault: ctrl.fault, speed, passMs,
          q: [...(ctrl.q || [])], real: world.joints(), door: world.door.pos, outputs: world.outputsOn, armDriven: !!ctrl.armDriven,
          weightG: ctrl.weightG, scaleOk: ctrl.scaleOk, ration: ctrl.ration, lastResult: ctrl.lastResult, store: { ...store },
          world: { hopperG: world.hopperG, spoonG: world.spoonG, plateG: world.plateG, floorG: world.floorG, eatenG: world.eatenG, totalG: world.totalG, cat: world.cat },
          balance: world.totalG - massStart - massAdded, guided: guided ? guided.n : null, hasUi: !!ui, settings: { ...S },
        };
      },
      debugWorld: () => world,
      debugCtrl: () => ctrl,
      debugGuided: (n) => {
        if (!guided) {
          startGuided(n);
          ui?.setGuidedBusy(true);
        }
      },
      debugSpeed: (v) => {
        speed = v;
        ui?.setSpeed(v);
      },
    };
  },
};
