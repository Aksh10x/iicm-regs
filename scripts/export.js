// Downloads every registration as a CSV you can open in Excel / Google Sheets.
// Usage: npm run export   ->  exports/registrations-YYYY-MM-DD.csv
import fs from 'node:fs';
import { registrations, closeDb } from '../lib/db.js';

const HEAD = ['Registered at', 'Last updated', 'Name', 'Roll', 'Email', 'Phone', 'Institute', 'Year', 'Event IDs', 'Preferences', 'Schedule', 'Mail status', 'Mail sent at', 'Submissions'];
const cell = v => { const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const col = await registrations();
const rows = await col.find({}).sort({ createdAt: 1 }).toArray();
const csv = [HEAD, ...rows.map(r => [r.createdAt, r.updatedAt, r.name, r.roll, r.email, r.phone, r.institute, r.year,
  (r.events || []).join(', '), JSON.stringify(r.prefs || {}), r.schedule, r.mail && r.mail.status, r.mail && r.mail.status === 'sent' ? r.mail.at : '', r.submissions])]
  .map(r => r.map(cell).join(',')).join('\r\n');

fs.mkdirSync('exports', { recursive: true });
const file = `exports/registrations-${new Date().toISOString().slice(0, 10)}.csv`;
fs.writeFileSync(file, '﻿' + csv); // BOM so Excel reads UTF-8 names correctly
console.log(`Wrote ${rows.length} registration(s) to ${file}`);
await closeDb();
