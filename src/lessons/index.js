/*
 * Lesson registry. To add a lesson, create src/lessons/lessonN.js with the same shape as lesson1.js
 * (metadata, textures(), views, viewButtons and create(env)) and append it to this array.
 * Every lesson owns one book spread: left page = text, right page = 3D circuit.
 */
import lesson1 from './lesson1.js';
import lesson2 from './lesson2.js';

import lesson3 from './lesson3.js';
import lesson4 from './lesson4.js';
export const LESSONS = [lesson1, lesson2, lesson3, lesson4];
