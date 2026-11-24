/*
 * Book registry. A book is { id, board, title, blurb, eyebrow, coverColor, lessons[], paintCover(ctx, W, H),
 * coverTexture(), canvasLabel }. Every book has its own cover, board model, chapters, circuits and code; the engine
 * (page turn, notebook, reading mode, cameras) is shared. To add a book (for example Arduino), create
 * src/books/<id>/index.js and add it here.
 */
import raspberryPi from './raspberry-pi/index.js';
import esp32 from './esp32/index.js';

export const BOOKS = [raspberryPi, esp32];
export const DEFAULT_BOOK = 'raspberry-pi';
export const getBook = (id) => BOOKS.find((b) => b.id === id);
