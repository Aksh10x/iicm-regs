// Local / single-server mode: serves the website and the API on one port.
// Usage: npm start   (reads .env). On Vercel this file is not used; api/ is.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventsHandler, registerHandler } from './lib/http.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = ['index.html', 'config.js', 'events.csv', 'img'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/events') return eventsHandler(req, res);
  if (url.pathname === '/api/register') return registerHandler(req, res);
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
  const file = path.join(root, rel);
  // Only the website files are served, never .env, lib/ or node_modules/.
  if (!PUBLIC.includes(rel.split('/')[0]) || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const port = +(process.env.PORT || 3000);
server.listen(port, () => console.log(`IICM registration running at http://localhost:${port}`));
