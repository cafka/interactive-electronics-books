import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeading, pageSections, GUIDE_SECTIONS, guideFileName } from '../src/guide.js';
import { PAGE_CONTENT } from '../src/pageContent.js';
import { ESP32_DOOR_PAGE, ESP32_PLANT_PAGE, ESP32_FEEDER_PAGE } from '../src/books/esp32/pageContent.js';
import { CORAL_PRESENCE_PAGE } from '../src/books/coral/pageContent.js';

const PAGES = { ...PAGE_CONTENT, ESP32_DOOR_PAGE, ESP32_PLANT_PAGE, ESP32_FEEDER_PAGE, CORAL_PRESENCE_PAGE };

test('the headings the chapters use land in the right section of the guide', () => {
  const cases = {
    materials: ['YOU WILL NEED', 'Parts list'],
    wiring: ['SCHEMATIC', 'SCHEMATIC (GPIO NAMES)', 'WIRING', 'WIRING (SAME AS LESSON 1)', 'Wiring recap', 'ESP32 pins', 'Connection table (breadboard columns as in the 3D model)', 'Connections', 'The path of the signal'],
    steps: ['Assembly, step by step', 'Calibration', 'Upload it to your ESP32', 'Run it on your Raspberry Pi 5', 'Try it on a real board', 'Programming the ESP32 with the Arduino IDE'],
    safety: ['Safety', 'Safety (read before building)', 'What the hardware can and cannot detect', 'What it cannot do'],
    troubleshooting: ['Diagnosis'],
    exercises: ['Exercises'],
    references: ['Sources'],
    how: ['Why 330 Ω?', 'STATES', 'Electrical check (on paper)', 'Forward kinematics: a worked example', 'Checked facts', 'What the lines do'],
  };
  for (const [bucket, titles] of Object.entries(cases)) for (const t of titles) assert.equal(classifyHeading(t), bucket, t);
  assert.equal(classifyHeading(null, 'code'), 'code', 'no heading: the fallback of the tab');
});

test('every left page splits into known sections, starting with the objective', () => {
  const known = new Set(GUIDE_SECTIONS.map(([k]) => k));
  for (const [name, page] of Object.entries(PAGES)) {
    const s = pageSections(page);
    assert.ok(s.length > 0, name);
    assert.equal(s[0].bucket, 'objective', `${name} starts with its introduction`);
    for (const x of s) assert.ok(known.has(x.bucket), `${name}: ${x.bucket}`);
    // nothing is lost: every block of the page appears in some section
    const blocks = page.blocks.filter((b) => b.type !== 'h').length;
    assert.equal(s.reduce((n, x) => n + x.parts.length, 0), blocks, `${name}: all blocks kept`);
    // schematics go to the wiring diagram
    for (const b of page.blocks.filter((q) => q.type === 'svg' && /aria-label="Schematic/i.test(q.svg))) {
      assert.ok(s.some((x) => x.bucket === 'wiring' && x.parts.some((p) => p.includes(b.svg.slice(0, 60)))), `${name}: schematic in wiring`);
    }
  }
});

test('the Raspberry Pi LED page gives materials, wiring and objective', () => {
  const s = pageSections(PAGE_CONTENT.led);
  const b = s.map((x) => x.bucket);
  assert.ok(b.includes('objective') && b.includes('materials') && b.includes('wiring'));
  assert.match(s.find((x) => x.bucket === 'materials').parts.join(''), /330 Ω/);
});

test('file name: readable, no spaces or symbols', () => {
  const n = guideFileName({ name: 'Coral Dev Board Micro', id: 'coral' }, { number: 1, title: 'How does Coral know someone is there?' });
  assert.equal(n, 'Inside-the-Circuit_Coral-Dev-Board-Micro_Chapter-1_How-does-Coral-know-someone-is-there');
});
