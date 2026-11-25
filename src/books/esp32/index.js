import chapter1 from './chapter1.js';
import chapter2 from './chapter2.js';
import chapter3 from './chapter3.js';
import { paintEsp32Cover } from './cover.js';
import { coverFromPainter } from '../../textures.js';

/* ESP32 book: ESP32-DevKitC with an ESP32-WROOM-32E, programmed in Arduino C++. */
export default {
  id: 'esp32',
  name: 'ESP32',
  board: 'ESP32-DevKitC · WROOM-32E',
  title: 'ESP32 · The Interactive Book',
  blurb: 'Arduino C++ on an ESP32-DevKitC. Chapter 1 builds an open-door alarm, chapter 2 a plant watering system, chapter 3 a robotic cat feeder.',
  eyebrow: 'An interactive science book · ESP32',
  coverColor: '#10302d',
  lessons: [chapter1, chapter2, chapter3],
  paintCover: paintEsp32Cover,
  coverTexture: () => coverFromPainter(paintEsp32Cover),
  canvasLabel: '3D book with an ESP32 board, a breadboard, a refrigerator door and a magnetic sensor (chapter 1), or a pot, a soil sensor and a pump (chapter 2), or a robotic arm feeding a cat (chapter 3)',
};

