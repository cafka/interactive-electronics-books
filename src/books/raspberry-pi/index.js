import { LESSONS } from '../../lessons/index.js';
import { coverFromPainter, paintPiCover } from '../../textures.js';

/* Raspberry Pi book: the chapters stay in src/lessons/ (shared parts live in src/*.js). */
export default {
  id: 'raspberry-pi',
  name: 'Raspberry Pi 5',
  board: 'Raspberry Pi 5',
  title: 'Raspberry Pi 5 · The Interactive Book',
  blurb: 'GPIO from the first LED to a traffic light, with Python and gpiozero.',
  eyebrow: 'An interactive science book · Raspberry Pi 5',
  coverColor: '#17294f',
  lessons: LESSONS,
  paintCover: paintPiCover,
  coverTexture: () => coverFromPainter(paintPiCover),
  canvasLabel: '3D book with a Raspberry Pi 5, breadboard, LED and resistor',
};

