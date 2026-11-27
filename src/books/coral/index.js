import chapter1 from './chapter1.js';
import chapter2 from './chapter2.js';
import chapter3 from './chapter3.js';
import { paintCoralCover } from './cover.js';
import { coverFromPainter } from '../../textures.js';

/* Coral book: the Google Coral Dev Board Micro (NXP i.MX RT1176 + Coral Edge TPU, on-board camera). */
export default {
  id: 'coral',
  name: 'Coral Dev Board Micro',
  board: 'Coral Dev Board Micro · i.MX RT1176 + Edge TPU',
  title: 'Google Coral Dev Board Micro · The Interactive Book',
  blurb: 'A microcontroller board with a camera and an Edge TPU. Chapter 1: how its demo knows someone is there. Chapter 2: a person wakes a pose model on the Edge TPU. Chapter 3: its microphone and YAMNet listen for sound events.',
  eyebrow: 'An interactive science book · Coral Dev Board Micro',
  coverColor: '#2a1520',
  lessons: [chapter1, chapter2, chapter3],
  paintCover: paintCoralCover,
  coverTexture: () => coverFromPainter(paintCoralCover),
  canvasLabel: '3D book with a Coral Dev Board Micro standing on a stand, its camera pointed at a person who can walk into or out of its view',
};
