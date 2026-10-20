// POST /api/export  { password }  ->  the encrypted zip of all registrations.
// The same password unlocks this endpoint and the zip (EXPORT_PASSWORD on Vercel).
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { buildZip } from '../lib/build.js';

let client;
const db = async () => {
  if (!client) client = await new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 8000 }).connect();
  return client.db(process.env.MONGODB_DB || 'iicm').collection('registrations');
};

// Compare hashes so the check takes the same time whatever was typed.
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));

// Slow down guessing: per warm instance, at most 8 wrong tries per address in 15 minutes.
const misses = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use the download page.' });
  const secret = process.env.EXPORT_PASSWORD;
  if (!secret || !process.env.MONGODB_URI) return send(res, 500, { ok: false, error: 'The export is not configured (EXPORT_PASSWORD / MONGODB_URI).' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now(), recent = (misses.get(ip) || []).filter(t => now - t < 15 * 60_000);
  if (recent.length >= 8) return send(res, 429, { ok: false, error: 'Too many wrong passwords. Try again in 15 minutes.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!password || !same(password, secret)) {
    misses.set(ip, [...recent, now]);
    await sleep(1200);
    return send(res, 401, { ok: false, error: 'Wrong password.' });
  }
  misses.delete(ip);

  try {
    const rows = await (await db()).find({}, { projection: { _id: 0 } }).toArray();
    const at = new Date();
    const { zip, students, events } = await buildZip(rows, { password: secret, at });
    const stamp = at.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16).replace(' ', '_').replace(':', '');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="IICM-registrations-${stamp}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Students', String(students));
    res.setHeader('X-Events', String(events));
    res.end(zip);
  } catch (err) {
    console.error('export failed', err);
    send(res, 500, { ok: false, error: 'Could not build the export. Try again in a minute.' });
  }
}
