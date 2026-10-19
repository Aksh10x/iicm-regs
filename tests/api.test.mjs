// Registration logic with an in-memory stand-in for MongoDB and the mailer.
// Usage: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventsFromCsv, hasClash, scheduleLines, getEvents, clearEventCache } from '../lib/events.js';
import { register } from '../lib/register.js';
import { buildMail } from '../lib/mail.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV = [
  'ID,Cup,Name,Type,Wdate,Wstart,Wend,Wvenue,Sdate,Sstart,Send,Svenue,About,Slots',
  'A1,Cup A,"Dance, Solo",Workshop,2026-11-14,9:00,11:00,Hall A,,,,,,Slot 1|Slot 2',
  'A2,Cup A,Mime,Selection,,,,,2026-11-14,10:00,11:30,Hall B,,',
  'A3,Cup A,Skit,Both,2026-11-15,14:00,16:00,Room C,2026-11-22,10:00,11:00,Hall A,,Slot 1|Slot 2',
  'B1,Cup B,"Quiz ""Pro""",Workshop,2026-11-15,15:00,17:00,Hall B,,,,,,',
  'B2,Cup B,Music,Selection,,,,,2026-11-22,11:00,12:00,Hall B,,',
  'C1,Cup C,Open mic,Selection,,,,,,,,,To be announced,',
].join('\n');
const EV = eventsFromCsv(CSV);

function fakeCol() {
  const docs = new Map();
  const apply = (d, u) => {
    Object.assign(d, structuredClone(u.$set || {}));
    for (const [k, v] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + v;
  };
  return {
    docs,
    async findOneAndUpdate(q, u, o) {
      const before = docs.get(q.email);
      if (before) { const prev = structuredClone(before); apply(before, u); return prev; }
      if (!o.upsert) return null;
      const d = { email: q.email, ...structuredClone(u.$setOnInsert || {}) }; apply(d, u); docs.set(q.email, d); return null;
    },
    async updateOne(q, u) { const d = docs.get(q.email); if (d) apply(d, u); },
  };
}

function setup({ mailFails = false } = {}) {
  const col = fakeCol(), sent = [];
  const deps = {
    events: async () => EV,
    col: async () => col,
    mail: async (m) => { if (mailFails) throw new Error('550 5.4.5 Daily user sending limit exceeded'); sent.push(m); return { messageId: '<id' + sent.length + '>' }; },
  };
  return { col, sent, deps };
}

const good = (o = {}) => ({ name: ' Asha Rao ', roll: '21CS10001', email: 'Asha@KGPian.iitkgp.ac.in', phone: '+91 98765 43210', inst: 'IIT Kharagpur', year: '3rd year', events: ['A1', 'A3', 'B2'], prefs: { A1: { a: 'Maybe', s: 'Slot 2' }, A3: { a: 'Bogus', s: 'Nope' } }, website: '', ...o });

test('CSV parsing handles quotes, commas and loose times', () => {
  assert.equal(EV.length, 6);
  assert.equal(EV[0].name, 'Dance, Solo'); assert.equal(EV[3].name, 'Quiz "Pro"');
  assert.equal(EV[0].ws, '09:00');
  assert.equal(EV[2].type, 'Both');
});

test('clash detection matches the website rules', () => {
  const by = id => EV.find(e => e.id === id);
  assert.equal(hasClash([by('A1'), by('A2')]), true);   // 9-11 vs 10-11:30
  assert.equal(hasClash([by('A3'), by('B2')]), false);  // 10-11 then 11-12 is back-to-back
  assert.equal(hasClash([by('A3'), by('B1')]), true);   // 14-16 vs 15-17 on 15 Nov
});

test('schedule text is sorted and lists undated events last', () => {
  const lines = scheduleLines(['C1', 'B2', 'A1'].map(id => EV.find(e => e.id === id)));
  assert.match(lines[0], /^Sat, 14 Nov 9:00 AM-11:00 AM \| Workshop \| A1 Dance, Solo \| Hall A$/);
  assert.match(lines[1], /B2 Music/);
  assert.equal(lines[2], 'Dates to be announced | C1 Open mic | To be announced');
});

test('a valid registration is saved and mailed', async () => {
  const { col, sent, deps } = setup();
  const r = await register(good(), deps);
  assert.deepEqual(r, { ok: true, updated: false, mailed: true });
  const d = col.docs.get('asha@kgpian.iitkgp.ac.in');
  assert.equal(d.name, 'Asha Rao'); assert.equal(d.institute, 'IIT Kharagpur'); assert.equal(d.submissions, 1);
  assert.deepEqual(d.events, ['A1', 'A3', 'B2']);
  assert.deepEqual(d.prefs, { A1: { a: 'Maybe', s: 'Slot 2' }, A3: { a: 'Attend', s: 'Slot 1' } }); // bad values fall back
  assert.equal(d.prefs.B2, undefined); // selections have no preferences
  assert.match(d.schedule, /A3 Skit/);
  assert.equal(d.mail.status, 'sent'); assert.equal(d.mail.messageId, '<id1>');
  assert.ok(d.createdAt instanceof Date);
  assert.deepEqual(sent, [{ to: 'asha@kgpian.iitkgp.ac.in', name: 'Asha Rao', events: [
    { id: 'A1', name: 'Dance, Solo', cup: 'Cup A' }, { id: 'A3', name: 'Skit', cup: 'Cup A' }, { id: 'B2', name: 'Music', cup: 'Cup B' }] }]);
});

test('registering again with the same email replaces the entry', async () => {
  const { col, deps } = setup();
  await register(good(), deps);
  const first = col.docs.get('asha@kgpian.iitkgp.ac.in').createdAt;
  const r = await register(good({ email: 'asha@kgpian.iitkgp.ac.in', events: ['B1'] }), deps);
  assert.equal(r.updated, true);
  assert.equal(col.docs.size, 1);
  const d = col.docs.get('asha@kgpian.iitkgp.ac.in');
  assert.deepEqual(d.events, ['B1']); assert.equal(d.submissions, 2); assert.equal(d.createdAt, first);
});

test('a mail failure still saves the registration, marked failed', async () => {
  const { col, deps } = setup({ mailFails: true });
  const r = await register(good(), deps);
  assert.deepEqual(r, { ok: true, updated: false, mailed: false });
  const d = col.docs.get('asha@kgpian.iitkgp.ac.in');
  assert.equal(d.mail.status, 'failed'); assert.match(d.mail.error, /sending limit/);
});

test('validation rejects bad input and never writes', async () => {
  const { col, sent, deps } = setup();
  const bad = [
    [{ name: '' }, /complete your details/],
    [{ email: 'nope' }, /complete your details/],
    [{ phone: 'call me' }, /WhatsApp/],
    [{ year: '9th year' }, /year/],
    [{ events: [] }, /at least one event/],
    [{ events: ['ZZ9'] }, /no longer exists/],
    [{ events: ['A1', 'A2'] }, /clash/],
  ];
  for (const [o, re] of bad) {
    const r = await register(good(o), deps);
    assert.equal(r.ok, false, JSON.stringify(o)); assert.match(r.error, re);
  }
  assert.equal((await register(null, deps)).ok, false);
  assert.equal(col.docs.size, 0); assert.equal(sent.length, 0);
});

test('only institute email addresses can register', async () => {
  const { col, deps } = setup();
  for (const email of ['asha@gmail.com', 'asha@iitkgp.ac.in', 'asha@kgpian.iitkgp.ac.in.evil.com', 'asha@evilkgpian.iitkgp.ac.in']) {
    const r = await register(good({ email }), deps);
    assert.equal(r.ok, false, email); assert.match(r.error, /institute email \(ending in @kgpian\.iitkgp\.ac\.in\)/);
  }
  assert.equal(col.docs.size, 0);
  process.env.EMAIL_DOMAINS = '*';
  try { assert.equal((await register(good({ email: 'asha@gmail.com' }), deps)).ok, true); }
  finally { delete process.env.EMAIL_DOMAINS; }
});

test('honeypot submissions are accepted silently and dropped', async () => {
  const { col, sent, deps } = setup();
  assert.deepEqual(await register(good({ website: 'http://spam' }), deps), { ok: true });
  assert.equal(col.docs.size, 0); assert.equal(sent.length, 0);
});

test('events load from the bundled events.csv when no URL is set', async () => {
  clearEventCache();
  const ev = await getEvents({ url: '', file: path.join(root, 'events.csv') });
  assert.ok(ev.length >= 20);
  assert.ok(ev.every(e => e.id && e.cup && e.name));
  clearEventCache();
});

test('confirmation mail lists the chosen events and escapes user text', () => {
  const m = buildMail('<b>Asha</b>', [{ id: 'A1', name: 'Dance, Solo', cup: 'Cup A' }, { id: 'B2', name: 'Music <live>', cup: 'Cup B' }]);
  assert.match(m.subject, /registration has been received/);
  assert.match(m.text, /Your registration has been received/);
  assert.match(m.text, /Events you registered for:\n- A1 Dance, Solo \(Cup A\)\n- B2 Music <live> \(Cup B\)/);
  assert.ok(m.html.includes('&lt;b&gt;Asha&lt;/b&gt;'));
  assert.ok(m.html.includes('<li><b>A1</b> Dance, Solo') && m.html.includes('Music &lt;live&gt;'));
  assert.doesNotMatch(buildMail('Asha').text, /Events you registered/);
});

test('local server: serves the site and API, never secrets', async (t) => {
  const { spawn } = await import('node:child_process');
  const port = 3900 + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT: String(port), EVENTS_URL: '', MONGODB_URI: '' };
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  await new Promise((res, rej) => { child.stdout.on('data', res); child.on('exit', rej); });
  const u = p => `http://localhost:${port}${p}`;

  assert.match(await (await fetch(u('/'))).text(), /<title>IICM 9.0 Registration<\/title>/);
  for (const p of ['/.env', '/.env.example', '/package.json', '/lib/db.js', '/node_modules/mongodb/package.json', '/img/../.env', '/%2e%2e/etc/passwd'])
    assert.equal((await fetch(u(p))).status, 404, p);

  const ev = await (await fetch(u('/api/events'))).json();
  assert.equal(ev.ok, true); assert.ok(ev.events.length >= 20);

  const bad = await fetch(u('/api/register'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /complete your details/);
  assert.equal((await fetch(u('/api/register'), { method: 'POST', body: '{not json' })).status, 400);
  assert.equal((await fetch(u('/api/register'))).status, 405);
});
