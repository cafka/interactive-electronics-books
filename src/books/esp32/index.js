import chapter1 from './chapter1.js';
import { paintEsp32Cover } from './cover.js';
import { coverFromPainter } from '../../textures.js';

/* ESP32 book: ESP32-DevKitC with an ESP32-WROOM-32E, programmed in Arduino C++. */
export default {
  id: 'esp32',
  name: 'ESP32',
  board: 'ESP32-DevKitC · WROOM-32E',
  title: 'ESP32 · The Interactive Book',
  blurb: 'Arduino C++ on an ESP32-DevKitC. Chapter 1 builds an open-door alarm.',
  eyebrow: 'An interactive science book · ESP32',
  coverColor: '#10302d',
  lessons: [chapter1],
  paintCover: paintEsp32Cover,
  coverTexture: () => coverFromPainter(paintEsp32Cover),
  canvasLabel: '3D book with an ESP32 board, a breadboard, a refrigerator door and a magnetic sensor',
};

