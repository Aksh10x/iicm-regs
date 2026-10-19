// Request handlers shared by the Vercel functions (api/) and the local server (server.js).
import { getEvents } from './events.js';
import { register } from './register.js';

function send(req, res, status, body) {
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  if (body === undefined) { res.statusCode = status; return res.end(); }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body; // Vercel parses it already
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 32_000) throw new Error('too large'); }
  return JSON.parse(raw || '{}');
}

export async function eventsHandler(req, res) {
  if (req.method === 'OPTIONS') return send(req, res, 204);
  try {
    const events = await getEvents();
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300'); // edge-cached on Vercel
    send(req, res, 200, { ok: true, events });
  } catch (err) {
    console.error('events', err);
    send(req, res, 500, { ok: false, error: 'Could not load events.' });
  }
}

export async function registerHandler(req, res) {
  if (req.method === 'OPTIONS') return send(req, res, 204);
  if (req.method !== 'POST') return send(req, res, 405, { ok: false, error: 'Use POST.' });
  let body;
  try { body = await readBody(req); } catch { return send(req, res, 400, { ok: false, error: 'Invalid request.' }); }
  try {
    const out = await register(body);
    send(req, res, out.ok ? 200 : 400, out);
  } catch (err) {
    console.error('register', err);
    send(req, res, 503, { ok: false, busy: true, error: 'The server is busy. Please try again.' });
  }
}
