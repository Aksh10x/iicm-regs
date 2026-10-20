// Builds a zip from sample registrations and opens it again: password, files, sheets, PDF.
// Usage: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { buildZip, groupByEvent, detailsOf } from '../lib/build.js';
import handler from '../api/export.js';
import { SAMPLE } from './sample-data.js';

const PW = 'Correct-Horse-9';
const built = buildZip(SAMPLE, { password: PW, at: new Date('2026-10-21T08:00:00Z') });

test('events are grouped with their students, in id order', () => {
  const ev = groupByEvent(SAMPLE);
  assert.deepEqual(ev.map(e => [e.id, e.people.length]), [['COM1', 2], ['FIL1', 2], ['QUI1', 3]]);
  assert.equal(ev[1].hasTracks, true); assert.equal(ev[1].date, 'Depends on track');
});

test('older registrations (no eventDetails) take names, cups, dates and venues from their schedule lines', () => {
  const old = { name: 'Old', email: 'old@kgpian.iitkgp.ac.in', events: ['CRE7', 'MUS3'], mail: { status: 'sent' },
    schedule: 'CRE7 Graphic Design Competition (OGD) (Creative Cup) | Selection: 29 Oct · Digital Art task submission · Venue: S 302\nMUS3 Solo Singing (Musical Arts Cup) | Schedule to be confirmed' };
  assert.deepEqual(detailsOf(old), [
    { id: 'CRE7', name: 'Graphic Design Competition (OGD)', cup: 'Creative Cup', date: '29 Oct · Digital Art task submission', venue: 'S 302' },
    { id: 'MUS3', name: 'Solo Singing', cup: 'Musical Arts Cup', date: '', venue: '' }]);
  assert.deepEqual(detailsOf({ events: ['X1'] }), [{ id: 'X1', name: 'X1', cup: '' }]);
  assert.deepEqual(groupByEvent([old]).map(e => e.name), ['Graphic Design Competition (OGD)', 'Solo Singing']);
});

test('the zip is AES-encrypted and needs the password', async () => {
  const { zip, students, events } = await built;
  assert.equal(students, 4); assert.equal(events, 3);
  const entries = await new ZipReader(new Uint8ArrayReader(zip)).getEntries();
  assert.deepEqual(entries.map(e => e.filename).sort(), ['IICM registrations.pdf', 'IICM registrations.xlsx', 'csv/All registrations.csv',
    'csv/COM1 Standup Comedy.csv', 'csv/FIL1 Online Short Film Competition.csv', 'csv/QUI1 Quiz Cup Registration.csv']);
  assert.ok(entries.every(e => e.encrypted));
  await assert.rejects(entries[0].getData(new Uint8ArrayWriter(), { password: 'wrong' }));
  await assert.rejects(entries[0].getData(new Uint8ArrayWriter()));
});

const open = async name => {
  const entries = await new ZipReader(new Uint8ArrayReader((await built).zip)).getEntries();
  return entries.find(e => e.filename === name);
};

test('Excel: summary, all registrations, email not sent, one sheet per event', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await (await open('IICM registrations.xlsx')).getData(new Uint8ArrayWriter(), { password: PW }));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'All registrations', 'Email not sent', 'COM1 Standup Comedy', 'FIL1 Online Short Film Competit', 'QUI1 Quiz Cup Registration']);
  const all = wb.getWorksheet('All registrations');
  assert.equal(all.rowCount, 5);
  const head = all.getRow(1).values.slice(1);
  assert.ok(['Name', 'Roll number', 'Joined WhatsApp community', 'Confirmation email', 'Email error'].every(h => head.includes(h)));
  const unsent = wb.getWorksheet('Email not sent');
  assert.deepEqual(unsent.getColumn(5).values.slice(2), ['Not sent yet', 'Failed']); // in registration order
  assert.match(unsent.getRow(3).getCell(6).value, /sending limit/);
  const film = wb.getWorksheet('FIL1 Online Short Film Competit');
  const fh = film.getRow(1).values.slice(1);
  assert.ok(fh.includes('Track'));
  assert.deepEqual(film.getColumn(fh.indexOf('Track') + 1).values.slice(2), ['Music & Acting Team', 'Crew Member']); // in registration order
  assert.equal(wb.getWorksheet('Summary').getRow(2).getCell(6).value, 2);
});

test('PDF and CSV are readable', async () => {
  const pdf = Buffer.from(await (await open('IICM registrations.pdf')).getData(new Uint8ArrayWriter(), { password: PW }));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5000);
  const raw = Buffer.from(await (await open('csv/COM1 Standup Comedy.csv')).getData(new Uint8ArrayWriter(), { password: PW }));
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM, so Excel reads names as UTF-8
  const csv = raw.subarray(3).toString('utf8');
  assert.ok(csv.startsWith('#,Name,Roll number'));
  assert.match(csv, /"Ānanya “Annie” Rao, Jr\."/); // quoted because of the comma
});

// A tiny stand-in for Vercel's req/res.
const call = async (method, body, env = {}) => {
  Object.assign(process.env, { EXPORT_PASSWORD: PW, MONGODB_URI: 'mongodb://127.0.0.1:1/never-used', ...env });
  const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method, body, headers: { 'x-forwarded-for': '203.0.113.9' } }, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
};

test('the endpoint refuses wrong or missing passwords and GET requests', async () => {
  assert.equal((await call('GET')).status, 405);
  for (const body of [{}, { password: 'nope' }, '{"password": 1}']) {
    const r = await call('POST', body);
    assert.equal(r.status, 401); assert.equal(r.json.error, 'Wrong password.');
  }
  assert.equal((await call('POST', { password: PW }, { EXPORT_PASSWORD: '' })).status, 500);
});
