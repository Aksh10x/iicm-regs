// Event list, date/time parsing, clash check and schedule text.
// Same rules as the website (index.html): a date cell is one date, a range ("2026-10-28 to 2026-11-03")
// or a comma-separated list of those; start/end times are optional HH:MM.
import fs from 'node:fs';
import path from 'node:path';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPES = ['Workshop', 'Selection', 'Both'];

export const mins = t => { const m = /(\d+):(\d+)/.exec(t); return m ? +m[1] * 60 + +m[2] : 0; };

/* ---------------- CSV ---------------- */

export function parseCsv(t) {
  const rows = []; let r = [], c = '', q = false;
  t = String(t).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; rows.push(r); r = []; }
    else c += ch;
  }
  if (c !== '' || r.length) { r.push(c); rows.push(r); }
  return rows.filter(x => x.some(y => y.trim()));
}

const oneDate = s => {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(s).trim());
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : String(s).trim();
};
export const normDate = s => {
  const v = String(s == null ? '' : s).trim();
  return v ? v.split(',').map(p => p.trim()).filter(Boolean).map(p => p.split(/\s+to\s+/i).map(oneDate).join(' to ')).join(', ') : '';
};
export const normTime = s => {
  const v = String(s == null ? '' : s).trim(), m = /^(\d{1,2}):(\d{2})/.exec(v);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : v;
};

export function eventsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length && /^id$/i.test(rows[0][0].trim())) rows.shift();
  return rows.filter(r => (r[0] || '').trim()).map(r => {
    const g = i => (r[i] || '').trim();
    const type = TYPES.find(x => x.toLowerCase() === g(3).toLowerCase()) || 'Workshop';
    return {
      id: g(0), cup: g(1), name: g(2), type,
      wd: normDate(g(4)), ws: normTime(g(5)), we: normTime(g(6)), wv: g(7),
      sd: normDate(g(8)), ss: normTime(g(9)), se: normTime(g(10)), sv: g(11),
      about: g(12), slots: g(13),
    };
  });
}

/* ---------------- loading (cached for a minute) ---------------- */

let cache = { at: 0, events: null };

// EVENTS_URL is the Google Sheet "Events" tab published as CSV, so the team keeps editing events in the Sheet.
// Without it (or if Google is down) the bundled events.csv is used.
export async function getEvents({ url = process.env.EVENTS_URL, file = path.join(process.cwd(), 'events.csv'), now = Date.now() } = {}) {
  if (cache.events && now - cache.at < 60_000) return cache.events;
  let events = null;
  if (url) {
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(now / 60_000), { signal: AbortSignal.timeout(5000) });
      const t = r.ok ? await r.text() : '';
      if (t && !/^\s*<(!doctype|html)/i.test(t)) { const ev = eventsFromCsv(t); if (ev.length) events = ev; }
    } catch { /* fall back to the file */ }
  }
  if (!events && cache.events) return cache.events; // keep the last good copy rather than switching sources
  if (!events) events = eventsFromCsv(fs.readFileSync(file, 'utf8'));
  cache = { at: now, events };
  return events;
}
export const clearEventCache = () => { cache = { at: 0, events: null }; };

/* ---------------- sessions, clashes, schedule ---------------- */

const utc = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim()); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
export function dates(spec) {
  const out = [];
  String(spec || '').split(',').forEach(p => {
    const r = p.trim().split(/\s+to\s+/i), a = utc(r[0]), b = r[1] ? utc(r[1]) : a;
    if (isNaN(a) || isNaN(b)) return;
    for (let t = a, i = 0; t <= b && i < 60; t += 864e5, i++) out.push(new Date(t).toISOString().slice(0, 10));
  });
  return out;
}

export function sessions(e) {
  const out = [];
  [['Workshop', e.wd, e.ws, e.we, e.wv], ['Selection', e.sd, e.ss, e.se, e.sv]].forEach(x => {
    const ds = dates(x[1]);
    if (ds.length) out.push({ k: x[0], spec: x[1], dates: ds, d: ds[0], s: x[2], e: x[3], v: x[4], ev: e });
  });
  return out;
}

// True when two different events overlap in time on a shared day. Sessions without both a start and end never clash.
export function hasClash(events) {
  const L = events.flatMap(sessions);
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const A = L[i], B = L[j];
      if (A.ev.id === B.ev.id || !A.s || !A.e || !B.s || !B.e) continue;
      if (!A.dates.some(d => B.dates.includes(d))) continue;
      if (mins(A.s) < mins(B.e) && mins(B.s) < mins(A.e)) return true;
    }
  }
  return false;
}

const fmtDate = d => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] + ', ' + (+m[3]) + ' ' + MONTHS[+m[2] - 1];
};
const fmtSpec = spec => String(spec || '').split(',').map(p => {
  const r = p.trim().split(/\s+to\s+/i);
  return r.length > 1 ? fmtDate(r[0]) + ' - ' + fmtDate(r[1]) : fmtDate(r[0]);
}).join(' & ');
const t12 = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; const h = +m[1]; return (h % 12 || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM'); };
const fmtTime = (s, e) => !s ? 'time TBA' : e ? t12(s) + '-' + t12(e) : 'from ' + t12(s);

// One line per session, sorted by date then start time; events with no dates go last.
export function scheduleLines(events) {
  const lines = events.flatMap(sessions)
    .sort((a, b) => a.d.localeCompare(b.d) || (a.s ? mins(a.s) : 1e4) - (b.s ? mins(b.s) : 1e4))
    .map(l => fmtSpec(l.spec) + ' ' + fmtTime(l.s, l.e) + ' | ' + l.k + ' | ' + l.ev.id + ' ' + l.ev.name + (l.v ? ' | ' + l.v : ''));
  events.filter(ev => !sessions(ev).length)
    .forEach(ev => lines.push('Dates to be announced | ' + ev.id + ' ' + ev.name + (ev.about ? ' | ' + ev.about : '')));
  return lines;
}
