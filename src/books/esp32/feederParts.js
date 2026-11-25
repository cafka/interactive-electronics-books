/*
 * Chapter 3 data: parts, pins, connections, and the paper checks (torque, current, reach) of the cat feeder.
 * The numbers for servos and masses are datasheet-class teaching values, not measurements of real parts:
 * the chapter asks the reader to weigh the real links and measure the real current.
 */
import { holdingTorques, forward, inverse, reachOf } from './armKinematics.js';
import { armOf } from './catFeeder.js';

export const PARTS = [
  { name: 'ESP32-DevKitC (ESP32-WROOM-32E)', qty: '1', spec: 'USB powered from its own 5 V charger, separate from the servos', alt: 'Any ESP32 DevKit with GPIO 4, 13, 18, 19, 21, 22, 25, 26, 27, 33' },
  { name: 'PCA9685 16-channel PWM board', qty: '1', spec: 'I²C address 0x40, 50 Hz servo pulses, V+ terminal for the servo supply', alt: 'Any PCA9685 breakout with an OE pin' },
  { name: 'MG996R metal-gear servo', qty: '3', spec: 'Base, shoulder, elbow. About 1.08 N·m stall at 6 V, about 2.5 A stall', alt: 'DS3218 (more torque, same wiring)' },
  { name: 'MG90S metal-gear micro servo', qty: '2', spec: 'Wrist and access door. About 0.22 N·m stall at 6 V', alt: 'Another 4.8 to 6 V micro servo of the same size' },
  { name: '4-DOF arm brackets', qty: '1 set', spec: 'Shoulder 90 mm above the floor, links 120 mm and 120 mm, wrist to bowl 70 mm', alt: 'PETG 3D-printed links of the same lengths' },
  { name: 'Spoon', qty: '1', spec: 'Stainless steel, bowl about 12 g of dry kibble, screwed to the wrist horn', alt: 'Food-safe PP measuring scoop' },
  { name: 'Load cell + HX711', qty: '1', spec: '1 kg bar cell under the plate, HX711 module powered from 3V3', alt: '500 g or 2 kg bar cell (then calibrate again)' },
  { name: 'INA219 current sensor', qty: '1', spec: '0.1 Ω shunt (reads up to 3.2 A); bridge A0 and A1: address 0x45', alt: 'INA226 (code change needed)' },
  { name: 'IR break-beam pair', qty: '1', spec: '3 to 5 V emitter and receiver with an open-collector output, across the access window', alt: 'A reflective IR sensor (adjust BEAM_BROKEN_LEVEL)' },
  { name: 'Lever microswitch', qty: '1', spec: 'On the service lid; closes to GND when the lid is shut', alt: 'Magnetic reed switch' },
  { name: 'Emergency stop', qty: '1', spec: 'Latching mushroom button with two NC contacts: one rated for the 6 V servo current, one to GPIO25', alt: 'E-stop with one NC + one NO contact (then change ESTOP_OK_LEVEL)' },
  { name: '6 V 5 A power supply', qty: '1', spec: 'Regulated, with certification marks for your country; servos only', alt: '5 V 5 A (slightly less torque)' },
  { name: '3 A slow fuse + holder', qty: '1', spec: 'In the + wire, after the E-stop', alt: '3 A resettable PTC' },
  { name: '1000 µF 16 V electrolytic', qty: '1', spec: 'On the PCA9685 V+ terminal, + to V+', alt: '2 × 470 µF' },
  { name: 'Push button, LED, 330 Ω, 2.2 kΩ', qty: '1 each', spec: 'Button to GND on GPIO13; LED on GPIO4; 2.2 kΩ OE pull-up', alt: 'Any 6 mm button and 3 or 5 mm LED' },
  { name: 'Hopper, plate, chamber', qty: '1 each', spec: 'Hopper of food-safe PP or PET (110 × 110 mm); stainless or ceramic plate; clear acrylic or PETG chamber with a lid and a flap door', alt: 'A food container as the hopper' },
  { name: 'Wiring', qty: '–', spec: '18 AWG silicone wire for the servo supply, Dupont wires for logic, grommets and spiral wrap where cables pass walls', alt: '–' },
];

export const PIN_TABLE = [
  { name: 'GPIO21 · IO21', role: 'I²C SDA (PCA9685, INA219)', mode: 'I²C', note: 'Default SDA of the Arduino core' },
  { name: 'GPIO22 · IO22', role: 'I²C SCL', mode: 'I²C', note: 'Default SCL' },
  { name: 'GPIO33 · IO33', role: 'PCA9685 OE', mode: 'output, HIGH = servo outputs off', note: '2.2 kΩ pull-up: off while the ESP32 boots' },
  { name: 'GPIO19 · IO19', role: 'HX711 DT', mode: 'input', note: '' },
  { name: 'GPIO18 · IO18', role: 'HX711 SCK', mode: 'output', note: 'Held HIGH > 60 µs the HX711 sleeps' },
  { name: 'GPIO27 · IO27', role: 'IR beam receiver', mode: 'INPUT_PULLUP, LOW = broken', note: 'Open-collector receiver' },
  { name: 'GPIO26 · IO26', role: 'Service-lid switch', mode: 'INPUT_PULLUP, LOW = closed', note: 'A cut wire reads "open": safe' },
  { name: 'GPIO25 · IO25', role: 'E-stop second NC contact', mode: 'INPUT_PULLUP, LOW = normal', note: 'A cut wire reads "pressed": safe' },
  { name: 'GPIO13 · IO13', role: 'Button', mode: 'INPUT_PULLUP', note: 'Short: feed. Long (2 s): override the cooldown, or reset a fault' },
  { name: 'GPIO4 · IO4', role: 'Status LED', mode: 'output', note: 'On while anything moves, fast blink in a fault' },
];

export const CONNECTIONS = [
  { from: '6 V supply +', to: 'E-stop main NC contact → 3 A fuse → INA219 VIN+', note: 'Pressing the E-stop cuts the servo power in hardware, whatever the program does' },
  { from: 'INA219 VIN−', to: 'PCA9685 V+ terminal, 1000 µF across V+ and GND', note: 'All servo current passes the 0.1 Ω shunt' },
  { from: '6 V supply −', to: 'PCA9685 GND terminal, INA219 GND, ESP32 GND', note: 'Common ground: the PWM signal needs the same reference' },
  { from: 'ESP32 3V3', to: 'PCA9685 VCC, INA219 VCC, HX711 VCC', note: 'Logic power only; never the servo supply' },
  { from: 'ESP32 IO21 / IO22', to: 'PCA9685 SDA / SCL and INA219 SDA / SCL', note: 'The modules have their own I²C pull-ups' },
  { from: 'ESP32 IO33', to: 'PCA9685 OE, 2.2 kΩ to 3V3', note: 'OE HIGH = no servo pulses' },
  { from: 'PCA9685 channels 0 to 4', to: 'base, shoulder, elbow, wrist, door servo plugs', note: 'Brown/black to GND, red to V+, orange/yellow to the signal pin' },
  { from: 'HX711 E+ E− A+ A−', to: 'load cell red, black, green, white', note: 'Typical colours; check the cell datasheet' },
  { from: 'ESP32 IO19 / IO18', to: 'HX711 DT / SCK', note: '' },
  { from: 'IR receiver OUT', to: 'ESP32 IO27', note: 'Emitter and receiver from 3V3 or 5 V as the module says; the output must not exceed 3.3 V' },
  { from: 'Lid switch, E-stop second contact, button', to: 'IO26, IO25, IO13, other side to GND', note: 'Internal pull-ups, no resistors' },
  { from: 'ESP32 IO4', to: '330 Ω → LED → GND', note: 'About 4 mA' },
];

/** Servo data (datasheet-class values at 6 V). */
export const SERVOS = {
  MG996R: { stallNm: 1.08, stallA: 2.5, runA: 0.5, massKg: 0.055 },
  MG90S: { stallNm: 0.22, stallA: 0.7, runA: 0.2, massKg: 0.0134 },
};
/** Estimated masses (kg): links with their brackets and horns. Weigh yours. */
export const MASSES = { upper: 0.045, elbowServo: SERVOS.MG996R.massKg, fore: 0.035, wristServo: SERVOS.MG90S.massKg, spoon: 0.025 };

/** Torque, current and reach checks, computed from the sketch settings (so the page and the code agree). */
export function feederChecks(s, spoonCapG = 12) {
  const arm = armOf(s);
  const payload = spoonCapG / 1000;
  // worst case for gravity: the arm stretched out level (shoulder at its lowest limit, elbow straight, spoon level)
  const qWorst = [0, s.q1Min, 0, -s.q1Min];
  const tauWorst = holdingTorques(qWorst, MASSES, payload, arm);
  const pour = inverse({ x: s.plateR, y: 0, z: s.plateZ, phi: s.carryPhi }, arm);
  const tauCarry = pour.ok ? holdingTorques(pour.q, MASSES, payload, arm) : null;
  const stall = [null, SERVOS.MG996R.stallNm, SERVOS.MG996R.stallNm, SERVOS.MG90S.stallNm];
  const margin = tauWorst.map((t, j) => (j === 0 ? null : stall[j] / t));
  const reach = reachOf(arm);
  const stretched = forward([0, 0, 0, 0], arm);
  return {
    qWorst, tauWorst, tauCarry, carryQ: pour.ok ? pour.q : null, stall, margin,
    reachWrist: reach.max, reachSpoon: stretched.r,
    currents: {
      holdA: 0.12,
      movingA: 3 * SERVOS.MG996R.runA * 0.6 + 2 * SERVOS.MG90S.runA * 0.6, // joints move together but rarely all at full effort
      oneStallA: SERVOS.MG996R.stallA,
      jamA: s.jamMa / 1000, jamMs: s.jamMs,
    },
  };
}
