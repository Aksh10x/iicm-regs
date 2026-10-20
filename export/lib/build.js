// Turns registration documents into an AES-256 encrypted zip holding:
//   IICM registrations.xlsx  - Summary, All registrations, Email not sent, and one sheet per event
//   IICM registrations.pdf   - summary table, then one section per event
//   csv/                     - the same tables as CSV (All registrations + one file per event)
import ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import { createRequire } from 'node:module';
import { configure, ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } from '@zip.js/zip.js';

configure({ useWebWorkers: false });
const require = createRequire(import.meta.url);
const vfs = require('pdfmake/build/vfs_fonts.js');
const font = f => Buffer.from(vfs[f], 'base64');
const printer = new PdfPrinter({ Roboto: { normal: font('Roboto-Regular.ttf'), bold: font('Roboto-Medium.ttf'), italics: font('Roboto-Italic.ttf'), bolditalics: font('Roboto-MediumItalic.ttf') } });

// Dates in India time, e.g. "21 Oct 2026, 14:05".
const ist = d => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const MAIL = { sent: 'Sent', failed: 'Failed', pending: 'Not sent yet' };
const mailStatus = r => r.mailStatus || (r.mail && r.mail.status) || 'pending'; // (older documents kept it under mail.status)
const mailLabel = r => MAIL[mailStatus(r)] || mailStatus(r);

// The events a student picked: eventDetails, or (older registrations) parsed from the stored schedule lines,
// "QUI1 General Quiz (Quiz Cup) | Selection: 28 Oct · Venue: Raman Auditorium", or just the ids.
export function detailsOf(r) {
  if (r.eventDetails && r.eventDetails.length) return r.eventDetails;
  const parsed = new Map(String(r.schedule || '').split('\n').map(line => line.match(/^(\S+) (.+) \(([^()]+)\) \| (.*)$/)).filter(Boolean)
    .map(([, id, name, cup, when]) => {
      const part = k => (when.match(new RegExp(`${k}: (.*?)(?: · (?:Workshop|Selection|Practice|Venue):|$)`)) || [])[1] || '';
      return [id, { id, name, cup, date: part('Selection') || part('Workshop') || part('Practice'), venue: part('Venue') }];
    }));
  return (r.events || []).map(id => parsed.get(id) || { id, name: id, cup: '' });
}

// One entry per event that has registrations, with the students in registration order.
export function groupByEvent(rows) {
  const events = new Map();
  for (const r of rows) {
    for (const e of detailsOf(r)) {
      if (!events.has(e.id)) events.set(e.id, { id: e.id, name: e.name, cup: e.cup, date: '', venue: e.venue || '', hasTracks: false, people: [] });
      const ev = events.get(e.id);
      if (e.track) ev.hasTracks = true;
      if (!ev.date && e.date && !e.track) ev.date = e.date;
      ev.people.push({ r, track: e.track || '' });
    }
  }
  for (const ev of events.values()) if (!ev.date && ev.hasTracks) ev.date = 'Depends on track';
  // Natural order by id (COM1, COM2, ..., CRE10), which also keeps cups together.
  return [...events.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

// The columns used everywhere a list of students is shown.
const PERSON = [
  ['Name', r => r.name, 24], ['Roll number', r => r.roll, 13], ['Department', r => r.dept, 28], ['Hall', r => r.hall, 24],
  ['Year', r => r.year, 13], ['WhatsApp', r => r.phone, 16], ['Institute email', r => r.email, 30], ['Personal email', r => r.personalEmail, 26],
];
const ALL = [
  ['Registered at (IST)', r => ist(r.createdAt), 19], ['Last updated (IST)', r => ist(r.updatedAt), 19], ...PERSON,
  ['Joined WhatsApp community', r => r.whatsappCommunity ? 'Yes' : 'No', 12],
  ['Events', r => detailsOf(r).map(e => `${e.id} ${e.name}${e.track ? ` (${e.track})` : ''}`).join('\n'), 44],
  ['Number of events', r => (r.events || []).length, 9],
  ['Confirmation email', mailLabel, 14], ['Email error', r => r.mailError || (r.mail && r.mail.error) || '', 30],
  ['Email sent at (IST)', r => ist(r.mailSentAt || (r.mail && r.mail.status === 'sent' && r.mail.at)), 19], ['Submissions', r => r.submissions || 1, 11],
];
const eventColumns = ev => [['#', (r, i) => i + 1, 5], ...PERSON, ...(ev.hasTracks ? [['Track', (r, i, p) => p.track, 20]] : []),
  ['Registered at (IST)', r => ist(r.createdAt), 19], ['Confirmation email', mailLabel, 14]];
const eventRows = ev => ev.people.map((p, i) => eventColumns(ev).map(([, f]) => f(p.r, i, p) ?? ''));
const title = ev => `${ev.id} · ${ev.name}${ev.cup ? ` (${ev.cup})` : ''}`;

// ---------- Excel ----------
const sheetName = (s, used) => {
  let n = s.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31), k = 2;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
  used.add(n.toLowerCase()); return n;
};
function addTable(wb, name, cols, rows, used) {
  const ws = wb.addWorksheet(sheetName(name, used), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(([header, , width]) => ({ header, width }));
  rows.forEach(r => ws.addRow(r));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF142039' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  ws.eachRow((row, i) => { if (i > 1) row.alignment = { vertical: 'top', wrapText: true }; });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}
async function excel(rows, events, at) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IICM 9.0 registrations export'; wb.created = at;
  const used = new Set();
  const summary = addTable(wb, 'Summary', [['Event ID', , 10], ['Event', , 40], ['Cup', , 24], ['Date', , 16], ['Venue', , 34], ['Registrations', , 14]],
    events.map(e => [e.id, e.name, e.cup, e.date, e.venue, e.people.length]), used);
  summary.addRow([]);
  summary.addRow(['', 'Students registered', '', '', '', rows.length]).font = { bold: true };
  summary.addRow(['', `Exported ${ist(at)} IST`]);
  addTable(wb, 'All registrations', ALL, rows.map(r => ALL.map(([, f]) => f(r) ?? '')), used);
  const unsent = rows.filter(r => mailStatus(r) !== 'sent');
  addTable(wb, 'Email not sent', [['Name', , 24], ['Institute email', , 30], ['Personal email', , 26], ['WhatsApp', , 16], ['Status', , 14], ['Reason', , 50]],
    unsent.map(r => [r.name, r.email, r.personalEmail || '', r.phone, mailLabel(r), r.mailError || (r.mail && r.mail.error) || '']), used);
  for (const ev of events) addTable(wb, `${ev.id} ${ev.name}`, eventColumns(ev), eventRows(ev), used);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- PDF ----------
const NOWRAP = ['WhatsApp', 'Roll number', 'Year', 'Date'];
const cellsFor = (cols, rows) => [cols.map(([h]) => ({ text: h, style: 'th' })), ...rows.map(r => r.map((v, i) => ({ text: String(v ?? ''), noWrap: NOWRAP.includes(cols[i][0]) })))];
function pdf(rows, events, at) {
  const unsent = rows.filter(r => mailStatus(r) !== 'sent').length;
  const content = [
    { text: 'IICM 9.0 Selections: registrations', style: 'h1' },
    { text: `Exported ${ist(at)} IST · ${rows.length} students · ${events.length} events with registrations${unsent ? ` · ${unsent} confirmation email(s) not sent` : ''}`, style: 'sub' },
    { text: 'Registrations per event', style: 'h2' },
    { table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto', '*', 'auto'], body: cellsFor([['ID'], ['Event'], ['Cup'], ['Date'], ['Venue'], ['Count']], events.map(e => [e.id, e.name, e.cup, e.date, e.venue, e.people.length])) }, layout: 'lightHorizontalLines' },
  ];
  for (const ev of events) {
    const cols = eventColumns(ev).filter(([h]) => !['Personal email', 'Registered at (IST)'].includes(h)); // keep the page readable
    const pick = cols.map(([h]) => eventColumns(ev).findIndex(([x]) => x === h));
    content.push(
      { text: title(ev), style: 'h2', pageBreak: 'before' },
      { text: [ev.date && `Date: ${ev.date}`, ev.venue && `Venue: ${ev.venue}`, `${ev.people.length} registered`].filter(Boolean).join('   ·   '), style: 'sub' },
      { table: { headerRows: 1, dontBreakRows: true, widths: cols.map(([h]) => ['Name', 'Department', 'Hall', 'Institute email'].includes(h) ? '*' : 'auto'), body: cellsFor(cols, eventRows(ev).map(r => pick.map(i => r[i]))) }, layout: 'lightHorizontalLines' },
    );
  }
  const doc = printer.createPdfKitDocument({
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [28, 30, 28, 34],
    info: { title: 'IICM 9.0 registrations', creator: 'IICM 9.0 registrations export' },
    defaultStyle: { font: 'Roboto', fontSize: 8, lineHeight: 1.15 },
    styles: { h1: { fontSize: 18, bold: true, color: '#142039' }, h2: { fontSize: 13, bold: true, color: '#b84d37', margin: [0, 12, 0, 4] }, sub: { color: '#6f6c65', margin: [0, 2, 0, 8] }, th: { bold: true, color: '#142039' } },
    footer: (page, pages) => ({ text: `IICM 9.0 registrations · page ${page} of ${pages}`, alignment: 'right', fontSize: 7, color: '#6f6c65', margin: [28, 10, 28, 0] }),
    content,
  });
  return new Promise((resolve, reject) => {
    const parts = [];
    doc.on('data', c => parts.push(c)); doc.on('end', () => resolve(Buffer.concat(parts))); doc.on('error', reject);
    doc.end();
  });
}

// ---------- CSV ----------
const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (cols, rows) => '﻿' + [cols.map(([h]) => h), ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'); // BOM: Excel reads UTF-8
const fileName = s => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90);

// ---------- zip ----------
export async function buildZip(rows, { password, at = new Date() }) {
  if (!password) throw new Error('A zip password is required');
  rows = [...rows].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const events = groupByEvent(rows);
  const zip = new ZipWriter(new Uint8ArrayWriter(), { password, encryptionStrength: 3 }); // 3 = AES-256
  await zip.add('IICM registrations.xlsx', new Uint8ArrayReader(await excel(rows, events, at)));
  await zip.add('IICM registrations.pdf', new Uint8ArrayReader(await pdf(rows, events, at)));
  await zip.add('csv/All registrations.csv', new TextReader(csv(ALL, rows.map(r => ALL.map(([, f]) => f(r) ?? '')))));
  for (const ev of events) await zip.add(`csv/${fileName(`${ev.id} ${ev.name}`)}.csv`, new TextReader(csv(eventColumns(ev), eventRows(ev))));
  return { zip: Buffer.from(await zip.close()), students: rows.length, events: events.length };
}
