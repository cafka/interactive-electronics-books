// Tiny dependency-free static server for the book (ES modules need http://, not file://).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const HOST = '127.0.0.1';

// Only these paths are public. Everything else (server.mjs, package.json...) returns 404.
const PUBLIC = ['index.html', 'styles.css', `src${sep}`, `vendor${sep}`, `python${sep}`, `arduino${sep}`];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const file = resolve(join(ROOT, normalize(urlPath)));
    const rel = file.slice(ROOT.length + 1);
    if (!file.startsWith(ROOT + sep) || !PUBLIC.some((p) => rel === p || rel.startsWith(p))) {
      res.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`Raspberry Pi 5 3D Book running at http://${HOST}:${PORT}/`);
  console.log('Open that address in Google Chrome. Press Ctrl+C to stop.');
});

