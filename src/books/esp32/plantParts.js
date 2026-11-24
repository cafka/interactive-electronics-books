/*
 * Chapter 2 data: parts list, connection table and the electrical check. The notebook, the book page and the tests
 * all read these objects, so a number is written once. Values are typical datasheet figures: measure your own parts.
 */

/** Supply voltages and limits used in the checks (volts, amps, ohms). */
export const ELEC = {
  vGpio: 3.3, // ESP32 GPIO high level
  v5: 5.0, // USB 5 V
  ledVf: 2.0, // red LED forward voltage
  rLed: 330,
  rGate: 100,
  rGatePull: 10000,
  rSensorPull: 100000,
  gpioMaxRecommended: 0.012, // A per pin that the book allows itself (the chip's absolute maximum is higher)
  sensorSupplyA: 0.005, // the sensor draws about 5 mA
  boardA: 0.08, // ESP32-DevKitC with the radios idle, LED and regulator included
  pumpRunA: 0.25, // a small 3-6 V pump while running
  pumpStallA: 0.6, // the same pump with the rotor blocked (hose kinked, dry rotor stuck)
  usbPortA: 0.5, // what a USB 2.0 port must supply
  chargerA: 2.0,
  mosfetVgsThMax: 2.0, // IRLZ44N: gate threshold 1 to 2 V
  mosfetRdsOn4V: 0.035, // IRLZ44N: Rds(on) specified at Vgs = 4 V
  mosfetVdsMax: 55,
  diodeIfAvg: 1.0, // 1N5819 average forward current
  diodeVrrm: 40,
  adcFullScaleV: 3.1, // ESP32 ADC input range with 11 dB attenuation (the top of the range bends)
};

/** All the numbers the page quotes, computed from ELEC. */
export function electricalCheck(e = ELEC) {
  const gateV = (e.vGpio * e.rGatePull) / (e.rGate + e.rGatePull); // 100 ohm in series with 10 kohm to ground
  const gateAvgA = e.vGpio / (e.rGate + e.rGatePull);
  const ledA = (e.vGpio - e.ledVf) / e.rLed;
  const normalA = e.boardA + e.sensorSupplyA + e.pumpRunA;
  const stallA = e.boardA + e.sensorSupplyA + e.pumpStallA;
  return {
    gateV, // voltage at the MOSFET gate when the pin is high
    gateMargin: gateV - e.mosfetVgsThMax, // above the worst-case threshold
    gateAvgA, // steady current from the pin into the 10 kohm pull-down
    ledA,
    pumpDrop: e.pumpStallA * e.mosfetRdsOn4V, // volts across the MOSFET at the stall current
    pumpHeat: e.pumpStallA * e.pumpStallA * e.mosfetRdsOn4V, // watts in the MOSFET at the stall current
    normalA, // whole project while pumping
    stallA, // worst case with a stalled pump
    usbEnough: normalA <= e.usbPortA,
    usbEnoughStall: stallA <= e.usbPortA,
    chargerEnough: stallA <= e.chargerA,
    flybackA: e.pumpStallA, // the coil current the diode must carry for a moment when the MOSFET opens
    diodeOk: e.pumpStallA <= e.diodeIfAvg && e.v5 + 1 < e.diodeVrrm,
    sensorPullA: e.adcFullScaleV / e.rSensorPull, // most the 100 kohm resistor ever draws
  };
}

/** Raw reading that the sensor reaches at the top of its range. Above it the ESP32 ADC is not linear. */
export const ADC_LINEAR_NOTE = 'Readings above about 2800 (2.25 V) are less linear, which is one more reason to calibrate your own two points.';

export const PARTS = [
  { name: 'ESP32-DevKitC with ESP32-WROOM-32E', qty: '1', spec: '38 pins, micro-USB', alt: 'Another ESP32 dev board works if it exposes GPIO25, 26, 27 and 34 (check its pinout)' },
  { name: 'USB cable and 5 V charger', qty: '1 + 1', spec: 'data cable; charger of at least 5 V 1.5 A (2 A is better)', alt: 'A PC USB port is fine for testing without the pump, but the pump can reset the board' },
  { name: 'Half-size breadboard', qty: '1', spec: '400 points with two power rails', alt: 'Any solderless breadboard with rails' },
  { name: 'Capacitive soil moisture sensor', qty: '1', spec: 'v1.2, 3.3 to 5.5 V, analog output, coated board, 3 wires (VCC, GND, AOUT)', alt: 'Any capacitive sensor with an analog output up to 3.3 V. Do not use bare resistive two-prong sensors: they corrode in weeks' },
  { name: 'Mini submersible pump', qty: '1', spec: 'DC 3 to 6 V, 250 mA or less while running, with tube', alt: 'JT-DC3V or R385 style. A 5 V peristaltic pump also works (slower, tolerates running dry better)' },
  { name: 'Silicone tube', qty: '1 m', spec: 'inner diameter that fits the pump outlet (usually 5 to 7 mm)', alt: 'Any food-grade flexible tube' },
  { name: 'N-channel logic-level MOSFET', qty: '1', spec: 'IRLZ44N (TO-220): gate threshold 1 to 2 V, 55 V, 47 A', alt: 'IRLB8721, FQP30N06L or any logic-level MOSFET with threshold of 2 V or less. Do not use IRF520, IRFZ44N or modules built on them: they need about 10 V at the gate' },
  { name: 'Flyback diode', qty: '1', spec: '1N5819 Schottky (1 A, 40 V)', alt: '1N4007 (1 A, 1000 V) also works. Any diode of 1 A or more and 20 V or more' },
  { name: 'Electrolytic capacitor', qty: '1', spec: '470 µF, 10 V or more (16 V is common)', alt: '220 to 1000 µF. The long leg is +' },
  { name: 'Resistor 100 Ω', qty: '1', spec: '1/4 W, brown black brown', alt: '47 to 220 Ω' },
  { name: 'Resistor 330 Ω', qty: '1', spec: '1/4 W, orange orange brown', alt: '220 to 470 Ω' },
  { name: 'Resistor 10 kΩ', qty: '1', spec: '1/4 W, brown black orange', alt: '4.7 to 100 kΩ' },
  { name: 'Resistor 100 kΩ', qty: '1', spec: '1/4 W, brown black yellow', alt: '47 to 220 kΩ' },
  { name: 'LED', qty: '1', spec: '5 mm, any colour', alt: 'Any LED that lights at about 4 mA' },
  { name: 'Push button', qty: '1', spec: '6 mm tactile switch', alt: 'Any normally open momentary switch' },
  { name: 'Jumper wires (Dupont)', qty: '7 + 6', spec: '7 male to female (ESP32 pin to breadboard), 6 male to male (inside the breadboard)', alt: 'Cut solid wire also works' },
  { name: 'Plant pot with soil', qty: '1', spec: 'small pot (10 to 12 cm) with a drain tray', alt: 'Any container with soil and a hole at the bottom' },
  { name: 'Water container (reservoir)', qty: '1', spec: 'plastic container of 0.5 L or more, where the pump fits', alt: 'A food container with a lid. Keep it lower than the electronics' },
];

/** Connection table. `net` lets the diagram, the table and the tests refer to the same wire. */
export const CONNECTIONS = [
  { from: '3V3 pin', to: 'column 2 (row j). Sensor VCC wire in column 2 (row g)', note: 'powers the sensor from 3.3 V', net: 'v3' },
  { from: 'GPIO34 (IO34)', to: 'column 6 (row j). Sensor AOUT wire in column 6 (row g)', note: 'analog input', net: 'aout' },
  { from: '100 kΩ', to: 'column 6 to column 9 (row i). Jumper from column 9 (row j) to the GND rail', note: 'pull-down: a loose AOUT wire reads about 0', net: 'pulldown' },
  { from: 'Sensor GND wire', to: 'column 9 (row g), the GND column of the sensor', note: '', net: 'gnd' },
  { from: 'GPIO25 (IO25)', to: 'column 11 (row j). 100 Ω from column 11 to column 15 (row i)', note: 'gate resistor', net: 'gate' },
  { from: 'MOSFET (flat face toward you)', to: 'legs in row f: gate column 15, drain column 16, source column 17', note: 'left to right: G, D, S', net: 'fet' },
  { from: '10 kΩ', to: 'column 15 to column 19 (row h). Jumper from column 19 (row j) to the GND rail', note: 'gate pull-down: pump off while the ESP32 starts', net: 'gatepull' },
  { from: 'Source, column 17', to: 'jumper from column 17 (row j) to the GND rail', note: '', net: 'source' },
  { from: 'Pump “−” wire', to: 'column 16 (row j), the drain', note: '', net: 'pumpneg' },
  { from: 'Pump “+” wire', to: '5V rail', note: '', net: 'pumppos' },
  { from: 'Diode 1N5819', to: 'anode in column 16, cathode (band) in column 20 (row i). Jumper from column 20 (row j) to the 5V rail', note: 'across the pump', net: 'diode' },
  { from: '470 µF capacitor', to: 'long leg (+) in the 5V rail, short leg (−) in the GND rail', note: 'smooths the pump start', net: 'cap' },
  { from: 'GPIO26 (IO26)', to: 'column 22 (row j). 330 Ω from column 22 to column 26 (row i)', note: '', net: 'ledr' },
  { from: 'LED', to: 'long leg (anode) in column 26, short leg in column 25 (row f). Jumper from column 25 (row j) to the GND rail', note: '', net: 'led' },
  { from: 'GPIO27 (IO27)', to: 'column 28 (row j). Button legs in columns 28 and 30 (rows g and i). Jumper from column 30 (row j) to the GND rail', note: 'INPUT_PULLUP: pressed = LOW', net: 'button' },
  { from: 'ESP32 GND', to: 'GND rail', note: 'common ground', net: 'espgnd' },
  { from: 'ESP32 5V pin', to: '5V rail', note: 'USB 5 V for the pump', net: 'esp5v' },
];

/** The same wiring as a list of electrical nodes: used by the tests to check that nothing is shorted or left open. */
export const NETS = {
  GND: ['sensor GND', 'source', 'gate pull-down', 'R100k end', 'LED cathode', 'button', 'cap −', 'ESP32 GND'],
  V5: ['pump +', 'diode cathode', 'cap +', 'ESP32 5V'],
  V3: ['sensor VCC', 'ESP32 3V3'],
  AOUT: ['sensor AOUT', 'R100k', 'IO34'],
  GATE: ['IO25 through 100 Ω', 'MOSFET gate', 'R10k'],
  DRAIN: ['MOSFET drain', 'pump −', 'diode anode'],
};

/** What the hardware of this chapter can and cannot notice. Used by the faults table of the notebook and the book page. */
export const FAULTS = [
  { fault: 'Sensor cable off or short circuit', seen: true, how: 'The reading leaves the valid window (200 to 3900) for 2 s: locked, code 1 (one blink)' },
  { fault: 'Tank empty, pump broken or hose blocked', seen: 'indirectly', how: 'The program does not see the tank. It sees that the soil did not get wetter after a pulse: locked, code 2. The pump has already run once (3 s) with no water' },
  { fault: 'Pump too weak or soil that cannot hold water', seen: 'indirectly', how: 'The soil gains a little each pulse but never gets wet: when the total pump time passes 24 s it locks, code 3' },
  { fault: 'Program or board resets in a loop', seen: false, how: 'The lock is saved in flash, so a reset does not clear it. A loop of resets before a lock could still add pump time: use a supply that does not brown out' },
  { fault: 'Water level in the tank', seen: false, how: 'Needs a float switch or a level sensor (an extra part and a spare GPIO)' },
  { fault: 'Pump current, a pump that stalls or a leaking hose', seen: false, how: 'Needs a current sensor (INA219) or a flow sensor. The sketch cannot tell' },
  { fault: 'Water in the saucer or on the table', seen: false, how: 'Needs a water-detection probe. The safe layout keeps water away from all the electronics' },
  { fault: 'MOSFET shorted on, with the pump running forever', seen: false, how: 'Hardware failure that software cannot undo. Limits damage: small tank, small pump, tray under the pot, no mains power' },
];

/** Pin table: the connectors of the ESP32 the chapter uses. */
export const PIN_TABLE = [
  { name: 'IO34', gpio: 34, role: 'soil sensor AOUT', mode: 'analog input (ADC1)', note: 'input only; ADC1 works at all times' },
  { name: 'IO25', gpio: 25, role: 'MOSFET gate through 100 Ω', mode: 'output', note: 'LOW at rest; HIGH only while WATERING' },
  { name: 'IO26', gpio: 26, role: 'LED through 330 Ω', mode: 'output', note: 'state pattern' },
  { name: 'IO27', gpio: 27, role: 'lock-clear button to GND', mode: 'input with pull-up', note: 'pressed = LOW' },
  { name: '3V3', gpio: null, role: 'sensor VCC', mode: 'power', note: '3.3 V keeps AOUT below the ADC limit' },
  { name: '5V', gpio: null, role: 'pump supply', mode: 'power', note: 'USB 5 V through the board' },
  { name: 'GND', gpio: null, role: 'common ground', mode: 'power', note: '' },
];
