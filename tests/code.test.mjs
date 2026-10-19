// Runs Code.gs against an in-memory fake of the Apps Script / Sheets APIs.
// Usage: node --test tests/code.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'Code.gs'), 'utf8');

function makeSheet(name) {
  const data = []; // data[r][c], 0-based
  const sh = {
    name, frozen: 0, formats: [],
    getLastRow: () => { let n = data.length; while (n > 0 && data[n - 1].every((v) => v === '' || v == null)) n--; return n; },
    getMaxRows: () => Math.max(data.length, 1000),
    appendRow: (row) => { data.push([...row]); },
    clear: () => { data.length = 0; },
    setFrozenRows: (n) => { sh.frozen = n; },
    getDataRange: () => {
      const rows = data.slice(0, sh.getLastRow()).map((r) => r.map((v) => (v instanceof Date ? v.toISOString() : String(v == null ? '' : v))));
      return { getDisplayValues: () => rows };
    },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (data[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (data[r - 1] || [])[c - 1] ?? '',
      setValues: (v) => v.forEach((row, i) => row.forEach((val, j) => { (data[r - 1 + i] ||= [])[c - 1 + j] = val; })),
      setValue: (val) => { (data[r - 1] ||= [])[c - 1] = val; },
      setNumberFormat: (f) => sh.formats.push([r, c, nr, nc, f]),
    }),
  };
  return { sh, data };
}

function boot({ quota = 100, lockOk = true } = {}) {
  const tabs = {};
  const sent = [];
  const cache = new Map();
  const ctx = {
    console,
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: (n) => tabs[n]?.sh || null,
        insertSheet: (n) => { tabs[n] = makeSheet(n); return tabs[n].sh; },
        toast: () => {},
      }),
      getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockOk, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent: () => s }),
    },
    MailApp: { sendEmail: (m) => sent.push(m), getRemainingDailyQuota: () => quota - sent.length },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create() {} }) }) }), deleteTrigger() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  run('setup()');
  const post = (obj) => JSON.parse(run(`doPost(${JSON.stringify({ postData: { contents: JSON.stringify(obj) } })}).getContent()`));
  return { tabs, sent, run, post, ctx };
}

const person = { name: 'Asha Rao', roll: '21CS10001', email: 'Asha@Example.com', phone: '+91 98765 43210', inst: 'IIT Kharagpur', year: '3rd year', events: ['A1'] };

test('setup creates both tabs, 50 placeholder events and headers', () => {
  const { tabs } = boot();
  assert.equal(tabs.Events.sh.getLastRow(), 51);
  assert.equal(tabs.Registrations.sh.getLastRow(), 1);
  assert.equal(tabs.Registrations.data[0][3], 'Email');
});

test('setup does not overwrite existing events when run again', () => {
  const { tabs, run } = boot();
  tabs.Events.sh.getRange(2, 3).setValue('My real event');
  run('setup()');
  assert.equal(tabs.Events.sh.getRange(2, 3).getValue(), 'My real event');
  assert.equal(tabs.Events.sh.getLastRow(), 51);
});

test('doGet returns the event list', () => {
  const { run } = boot();
  const d = JSON.parse(run('doGet({}).getContent()'));
  assert.equal(d.ok, true);
  assert.equal(d.events.length, 50);
  assert.equal(d.events[0].id, 'A1');
  assert.match(d.events[0].wd, /^\d{4}-\d{2}-\d{2}$/);
});

test('valid registration is saved with mail-merge columns', () => {
  const { tabs, post } = boot();
  const r = post(person);
  assert.deepEqual(r, { ok: true, updated: false });
  const row = tabs.Registrations.data[1];
  assert.equal(row[1], 'Asha Rao');
  assert.equal(row[3], 'asha@example.com'); // lowercased
  assert.equal(row[4], '+91 98765 43210');
  assert.equal(row[7], 'A1');
  assert.match(row[9], /^Sat, 14 Nov 9:00 AM-11:00 AM \| Workshop \| A1 Placeholder Title 1 \| Hall A$/);
  assert.equal(row[10], ''); // mail status blank = needs mail
  assert.equal(row[12], 1);
});

test('same email again replaces the entry instead of adding a row', () => {
  const { tabs, post } = boot();
  post(person);
  tabs.Registrations.sh.getRange(2, 11).setValue('Sent');
  const r = post({ ...person, email: ' ASHA@example.com ', events: ['A1', 'A3'] });
  assert.deepEqual(r, { ok: true, updated: true });
  assert.equal(tabs.Registrations.sh.getLastRow(), 2);
  const row = tabs.Registrations.data[1];
  assert.equal(row[7], 'A1, A3');
  assert.equal(row[12], 2);
  assert.equal(row[10], ''); // reset so the new version gets mailed
});

test('different people get different rows', () => {
  const { tabs, post } = boot();
  post(person);
  post({ ...person, email: 'b@example.com', name: 'B' });
  assert.equal(tabs.Registrations.sh.getLastRow(), 3);
});

test('clashing events are rejected on the server', () => {
  const { tabs, post, run } = boot();
  const ev = tabs.Events.sh;
  ev.getRange(2, 1, 2, 14).setValues([
    ['X1', 'Cup A', 'One', 'Workshop', '2026-11-14', '09:00', '11:00', 'Hall', '', '', '', '', '', ''],
    ['X2', 'Cup A', 'Two', 'Selection', '', '', '', '', '2026-11-14', '10:30', '12:00', 'Hall', '', ''],
  ]);
  ev.getRange(4, 1, 49, 14).setValues(Array.from({ length: 49 }, () => Array(14).fill('')));
  const r = post({ ...person, events: ['X1', 'X2'] });
  assert.equal(r.ok, false);
  assert.match(r.error, /clash/);
  assert.equal(tabs.Registrations.sh.getLastRow(), 1);
  // back-to-back is fine
  ev.getRange(3, 9, 1, 3).setValues([['2026-11-14', '11:00', '12:00']]);
  assert.equal(post({ ...person, events: ['X1', 'X2'] }).ok, false); // events are cached for 60s, so the edit is not seen yet
  run("CacheService.getScriptCache().remove('events')");
  assert.equal(post({ ...person, events: ['X1', 'X2'] }).ok, true);
});

test('unknown event id is rejected and asks the page to reload', () => {
  const { post } = boot();
  const r = post({ ...person, events: ['A1', 'ZZ9'] });
  assert.equal(r.ok, false);
  assert.equal(r.reload, true);
});

test('bad details are rejected', () => {
  const { post, tabs } = boot();
  assert.equal(post({ ...person, email: 'nope' }).ok, false);
  assert.equal(post({ ...person, phone: 'abc' }).ok, false);
  assert.equal(post({ ...person, year: '9th year' }).ok, false);
  assert.equal(post({ ...person, name: '' }).ok, false);
  assert.equal(post({ ...person, events: [] }).ok, false);
  assert.equal(tabs.Registrations.sh.getLastRow(), 1);
});

test('honeypot silently succeeds without saving', () => {
  const { post, tabs } = boot();
  assert.equal(post({ ...person, website: 'http://spam' }).ok, true);
  assert.equal(tabs.Registrations.sh.getLastRow(), 1);
});

test('busy lock is reported so the page can retry', () => {
  const { post } = boot({ lockOk: false });
  const r = post(person);
  assert.equal(r.ok, false);
  assert.equal(r.busy, true);
});

test('workshop preferences are sanitised', () => {
  const { tabs, post } = boot();
  post({ ...person, events: ['A1'], prefs: { A1: { a: 'Hax', s: 'Not a slot' }, ZZ: { a: 'Skip' } } });
  const prefs = JSON.parse(tabs.Registrations.data[1][8]);
  assert.deepEqual(prefs, { A1: { a: 'Attend', s: 'Slot 1' } });
});

test('garbage body does not crash the endpoint', () => {
  const { run } = boot();
  const d = JSON.parse(run('doPost({postData:{contents:"not json"}}).getContent()'));
  assert.equal(d.ok, false);
});

test('sendConfirmations mails only unsent rows and marks them', () => {
  const { tabs, post, run, sent } = boot();
  post(person);
  post({ ...person, email: 'b@example.com', name: 'B <script>' });
  tabs.Registrations.sh.getRange(2, 11).setValue('Sent');
  const msg = run('sendConfirmations()');
  assert.match(msg, /Sent 1 /);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'b@example.com');
  assert.match(sent[0].htmlBody, /B &lt;script&gt;/); // escaped
  assert.equal(tabs.Registrations.data[2][10], 'Sent');
  assert.equal(run('sendConfirmations()').startsWith('Sent 0'), true); // nothing left
});

test('sendConfirmations stops when the daily quota is used up', () => {
  const { post, run, sent, tabs } = boot({ quota: 2 });
  for (let i = 0; i < 4; i++) post({ ...person, email: `s${i}@example.com` });
  const msg = run('sendConfirmations()');
  assert.equal(sent.length, 2);
  assert.match(msg, /quota/);
  assert.equal(tabs.Registrations.data[3][10], ''); // third row still waiting
});

/* ---- final programme, date ranges, missing times ---- */
const setEvents = (tabs, run, rows) => {
  const ev = tabs.Events.sh;
  ev.getRange(2, 1, 50, 14).setValues(Array.from({ length: 50 }, () => Array(14).fill('')));
  ev.getRange(2, 1, rows.length, 14).setValues(rows);
  run("CacheService.getScriptCache().remove('events')");
};
const R = (id, type, wd, ws, we, sd, ss, se, about = '') => [id, 'Test Cup', 'Event ' + id, type, wd, ws, we, 'Hall', sd, ss, se, 'Room', about, ''];

test('loadFinalEvents replaces the Events tab with the real programme', () => {
  const { tabs, run } = boot();
  assert.match(run('loadFinalEvents()'), /Loaded 27 events/);
  assert.equal(tabs.Events.sh.getLastRow(), 28);
  const d = JSON.parse(run('doGet({}).getContent()'));
  assert.equal(d.events.length, 27);
  assert.equal(new Set(d.events.map((e) => e.cup)).size, 11);
  const quiz = d.events.find((e) => e.id === 'QUI1');
  assert.equal(quiz.sd, '2026-10-28 to 2026-11-03'); assert.equal(quiz.ss, '18:00'); assert.equal(quiz.se, '');
  assert.equal(d.events.find((e) => e.id === 'DIG1').wd, '2026-10-17, 2026-10-20');
  assert.ok(!d.events.some((e) => /placeholder/i.test(e.name + e.about)));
});

test('every final event can be registered and is clash-free on its own', () => {
  const { run, post } = boot();
  run('loadFinalEvents()');
  const ids = JSON.parse(run('doGet({}).getContent()')).events.map((e) => e.id);
  ids.forEach((id, i) => assert.equal(post({ ...person, email: `e${i}@x.com`, events: [id] }).ok, true, id));
});

test('real clashes in the final programme are caught, TBA sessions never clash', () => {
  const { run, post } = boot();
  run('loadFinalEvents()');
  assert.equal(post({ ...person, events: ['FAS1', 'FIN1'] }).ok, false); // both 5:30-8:30 PM at S301/302 on 27 Oct
  assert.equal(post({ ...person, events: ['FIN1', 'FIN3'] }).ok, true);  // 27/28 Oct vs 29 Oct
  assert.equal(post({ ...person, events: ['QUI1', 'FAS4'] }).ok, true);  // open-ended 6 PM starts, no end time
  assert.equal(post({ ...person, events: ['PHO2', 'COM1'] }).ok, true);  // 28 Oct, no time
});

test('multi-day range overlaps a single day inside it', () => {
  const { tabs, run, post } = boot();
  setEvents(tabs, run, [R('R1', 'Selection', '', '', '', '2026-10-28 to 2026-10-30', '17:00', '19:00'), R('R2', 'Selection', '', '', '', '2026-10-30', '18:00', '20:00'), R('R3', 'Selection', '', '', '', '2026-10-31', '18:00', '20:00')]);
  assert.equal(post({ ...person, events: ['R1', 'R2'] }).ok, false);
  assert.equal(post({ ...person, events: ['R1', 'R3'] }).ok, true);
});

test('date lists, ranges and missing times read well in the saved schedule', () => {
  const { tabs, run, post } = boot();
  setEvents(tabs, run, [R('L1', 'Workshop', '2026-10-17, 2026-10-20', '10:00', '11:00', '', '', ''), R('L2', 'Selection', '', '', '', '2026-10-28 to 2026-11-03', '18:00', ''), R('L3', 'Selection', '', '', '', '2026-10-28', '', ''), R('L4', 'Workshop', '', '', '', '', '', '', 'Open to all.')]);
  assert.equal(post({ ...person, events: ['L1', 'L2', 'L3', 'L4'] }).ok, true);
  const lines = tabs.Registrations.data[1][9].split('\n');
  assert.equal(lines[0], 'Sat, 17 Oct & Tue, 20 Oct 10:00 AM-11:00 AM | Workshop | L1 Event L1 | Hall');
  assert.equal(lines[1], 'Wed, 28 Oct from 6:00 PM | Selection | L2 Event L2 | Room'.replace('Wed, 28 Oct', 'Wed, 28 Oct - Tue, 3 Nov'));
  assert.equal(lines[2], 'Wed, 28 Oct time TBA | Selection | L3 Event L3 | Room');
  assert.equal(lines[3], 'Dates to be announced | L4 Event L4 | Open to all.');
});
