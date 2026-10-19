// IICM 9.0 registration backend.
// Paste into Extensions > Apps Script of the Google Sheet that will hold the data (see docs/SETUP.md).
// The website talks to this script; the script reads/writes the Sheet. No emails are sent automatically.

const CFG = {
  FROM_NAME: 'IICM 9.0',
  REPLY_TO: 'iitkgpcl.iicm9.0@gmail.com',
  SUBJECT: 'IICM 9.0: registration confirmed',
};

const YEARS = ['1st year', '2nd year', '3rd year', '4th year', '5th year', 'PG / PhD'];
const ATTEND = ['Attend', 'Maybe', 'Skip'];
const COUNTS = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3]; // placeholder events per Cup A..M

const EV_HEAD = ['ID', 'Cup', 'Name', 'Type (Workshop/Selection/Both)', 'Workshop date (YYYY-MM-DD)', 'Workshop start (HH:MM)',
  'Workshop end', 'Workshop venue', 'Selection date (YYYY-MM-DD)', 'Selection start (HH:MM)', 'Selection end', 'Selection venue',
  'About', 'Workshop slots (separate with |)'];

// Registrations columns (1-based): keep this order, the mail merge uses these headers.
const RG_HEAD = ['Timestamp', 'Name', 'Roll', 'Email', 'Phone', 'Institute', 'Year', 'Event IDs', 'Preferences',
  'Schedule', 'Mail status', 'Mail sent at', 'Submissions'];
const C = { TS: 1, NAME: 2, ROLL: 3, EMAIL: 4, PHONE: 5, INST: 6, YEAR: 7, IDS: 8, PREFS: 9, SCHED: 10, STATUS: 11, SENT: 12, COUNT: 13 };

/* ---------------- small helpers ---------------- */

const mins_ = t => { const m = /(\d+):(\d+)/.exec(t); return m ? +m[1] * 60 + +m[2] : 0; };
const sheet_ = n => { const s = SpreadsheetApp.getActive().getSheetByName(n); if (!s) throw new Error('Missing sheet tab: ' + n); return s; };
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const DAYS_ = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate_(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return DAYS_[t.getUTCDay()] + ', ' + (+m[3]) + ' ' + MONTHS_[+m[2] - 1];
}

// A date cell holds one date ('2026-10-28'), a range ('2026-10-28 to 2026-11-03'), or a comma-separated list of those.
function oneDate_(s) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(s).trim());
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : String(s).trim();
}
function normDate_(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v) return '';
  return v.split(',').map(p => p.trim()).filter(Boolean).map(p => p.split(/\s+to\s+/i).map(oneDate_).join(' to ')).join(', ');
}
function utc_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}
// Every calendar day a date cell covers, as ISO strings.
function dates_(spec) {
  const out = [];
  String(spec || '').split(',').forEach(p => {
    const r = p.trim().split(/\s+to\s+/i), a = utc_(r[0]), b = r[1] ? utc_(r[1]) : a;
    if (isNaN(a) || isNaN(b)) return;
    for (let t = a, i = 0; t <= b && i < 60; t += 864e5, i++) out.push(new Date(t).toISOString().slice(0, 10));
  });
  return out;
}
function fmtSpec_(spec) {
  return String(spec || '').split(',').map(p => {
    const r = p.trim().split(/\s+to\s+/i);
    return r.length > 1 ? fmtDate_(r[0]) + ' - ' + fmtDate_(r[1]) : fmtDate_(r[0]);
  }).join(' & ');
}
function t12_(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  const h = +m[1];
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM');
}
function fmtTime_(s, e) { return !s ? 'time TBA' : e ? t12_(s) + '-' + t12_(e) : 'from ' + t12_(s); }

function normTime_(s) {
  const v = String(s == null ? '' : s).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : v;
}

/* ---------------- events ---------------- */

function readEvents_() {
  const v = sheet_('Events').getDataRange().getDisplayValues();
  v.shift();
  return v.filter(r => String(r[0]).trim()).map(r => ({
    id: String(r[0]).trim(), cup: String(r[1]).trim(), name: String(r[2]).trim(), type: String(r[3]).trim(),
    wd: normDate_(r[4]), ws: normTime_(r[5]), we: normTime_(r[6]), wv: String(r[7]).trim(),
    sd: normDate_(r[8]), ss: normTime_(r[9]), se: normTime_(r[10]), sv: String(r[11]).trim(),
    about: String(r[12]).trim(), slots: String(r[13]).trim(),
  }));
}

// Cached for a minute so a registration rush does not re-read the Sheet for every visitor.
function getEvents_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('events');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* fall through */ } }
  const ev = readEvents_();
  try { cache.put('events', JSON.stringify(ev), 60); } catch (e) { /* too large for cache: fine */ }
  return ev;
}

// A session exists when its date cell is filled. Start and end times are optional (blank = time to be announced).
function ses_(e) {
  const out = [];
  [['Workshop', e.wd, e.ws, e.we, e.wv], ['Selection', e.sd, e.ss, e.se, e.sv]].forEach(x => {
    const ds = dates_(x[1]);
    if (ds.length) out.push({ k: x[0], spec: x[1], dates: ds, d: ds[0], s: x[2], e: x[3], v: x[4], ev: e });
  });
  return out;
}
const sortL_ = L => L.slice().sort((a, b) => a.d.localeCompare(b.d) || (a.s ? mins_(a.s) : 1e4) - (b.s ? mins_(b.s) : 1e4));

// True when two different events have sessions that overlap in time on a shared day.
// Sessions without both a start and an end time are never treated as clashing.
function hasClash_(events) {
  const L = events.flatMap(ses_);
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const A = L[i], B = L[j];
      if (A.ev.id === B.ev.id || !A.s || !A.e || !B.s || !B.e) continue;
      if (!A.dates.some(d => B.dates.indexOf(d) >= 0)) continue;
      if (mins_(A.s) < mins_(B.e) && mins_(B.s) < mins_(A.e)) return true;
    }
  }
  return false;
}

function scheduleText_(events) {
  const lines = sortL_(events.flatMap(ses_))
    .map(l => fmtSpec_(l.spec) + ' ' + fmtTime_(l.s, l.e) + ' | ' + l.k + ' | ' + l.ev.id + ' ' + l.ev.name + (l.v ? ' | ' + l.v : ''));
  events.filter(ev => !ses_(ev).length)
    .forEach(ev => lines.push('Dates to be announced | ' + ev.id + ' ' + ev.name + (ev.about ? ' | ' + ev.about : '')));
  return lines.join('\n');
}

/* ---------------- web app ---------------- */

// GET ?action=events returns the event list (fallback if the published CSV is not used).
function doGet(e) {
  try {
    return json_({ ok: true, events: getEvents_() });
  } catch (err) {
    return json_({ ok: false, error: 'Could not load events.' });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(handleRegistration_(body));
  } catch (err) {
    return json_({ ok: false, error: 'Invalid request.' });
  }
}

function clean_(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

function handleRegistration_(b) {
  if (b.website) return { ok: true }; // honeypot: only bots fill it

  const name = clean_(b.name, 100), roll = clean_(b.roll, 40), email = clean_(b.email, 120).toLowerCase();
  const phone = clean_(b.phone, 20), inst = clean_(b.inst, 120), year = clean_(b.year, 20);
  if (!name || !roll || !phone || !inst || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please complete your details.' };
  if (!/^\+?[\d\s-]{7,18}$/.test(phone)) return { ok: false, error: 'Enter a valid WhatsApp number.' };
  if (YEARS.indexOf(year) < 0) return { ok: false, error: 'Pick your year.' };

  const ids = Array.isArray(b.events) ? b.events.filter((x, i, a) => typeof x === 'string' && a.indexOf(x) === i).slice(0, 80) : [];
  if (!ids.length) return { ok: false, error: 'Pick at least one event.' };

  const byId = {};
  getEvents_().forEach(ev => { byId[ev.id] = ev; });
  const chosen = ids.map(id => byId[id]);
  if (chosen.some(x => !x)) return { ok: false, error: 'An event you picked no longer exists. Please reload the page.', reload: true };
  if (hasClash_(chosen)) return { ok: false, error: 'Two of your events clash. Please fix and resubmit.' };

  const prefs = {};
  chosen.forEach(ev => {
    if (ev.type === 'Selection') return;
    const slots = ev.slots ? ev.slots.split('|').map(s => s.trim()).filter(Boolean) : [];
    const g = (b.prefs && b.prefs[ev.id]) || {};
    prefs[ev.id] = { a: ATTEND.indexOf(g.a) >= 0 ? g.a : 'Attend', s: slots.indexOf(g.s) >= 0 ? g.s : (slots[0] || '') };
  });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, busy: true, error: 'The server is busy. Please try again.' };
  let updated = false;
  try {
    const sh = sheet_('Registrations');
    const last = sh.getLastRow();
    let row = 0;
    if (last > 1) {
      const emails = sh.getRange(2, C.EMAIL, last - 1, 1).getValues();
      for (let i = emails.length - 1; i >= 0; i--) {
        if (String(emails[i][0]).trim().toLowerCase() === email) { row = i + 2; break; }
      }
    }
    let count = 1;
    if (row) { updated = true; count = (Number(sh.getRange(row, C.COUNT).getValue()) || 1) + 1; } else { row = last + 1; }
    // Status and sent-time are cleared so the mail merge sends the new version.
    sh.getRange(row, 1, 1, RG_HEAD.length).setValues([[new Date(), name, roll, email, phone, inst, year,
      chosen.map(x => x.id).join(', '), JSON.stringify(prefs), scheduleText_(chosen), '', '', count]]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, updated: updated };
}

/* ---------------- one-time setup ---------------- */

// Creates the two tabs if missing and fills Events with placeholders only when it is empty.
function setup() {
  const ss = SpreadsheetApp.getActive();
  const ev = ss.getSheetByName('Events') || ss.insertSheet('Events');
  const rg = ss.getSheetByName('Registrations') || ss.insertSheet('Registrations');

  ev.getRange(1, 5, ev.getMaxRows(), 3).setNumberFormat('@');   // workshop date/start/end as plain text
  ev.getRange(1, 9, ev.getMaxRows(), 3).setNumberFormat('@');   // selection date/start/end as plain text
  if (ev.getLastRow() === 0) {
    ev.appendRow(EV_HEAD); ev.setFrozenRows(1);
    const types = ['Workshop', 'Selection', 'Both'], W = ['2026-11-14', '2026-11-15', '2026-11-21'], S = ['2026-11-22', '2026-11-28', '2026-11-29'],
      ST = ['09:00', '11:00', '14:00', '16:00'], V = ['Hall A', 'Hall B', 'Room C'],
      add = (t, h) => ('0' + (+t.slice(0, 2) + h)).slice(-2) + ':00', rows = [];
    let n = 0;
    COUNTS.forEach((c, i) => {
      for (let k = 1; k <= c; k++, n++) {
        const L = 'ABCDEFGHIJKLM'[i], t = types[n % 3], hw = t !== 'Selection', hs = t !== 'Workshop', a = ST[n % 4], b = ST[(n + 1) % 4];
        rows.push([L + k, 'Cup ' + L, 'Placeholder Title ' + (n + 1), t,
          hw ? W[n % 3] : '', hw ? a : '', hw ? add(a, 2) : '', hw ? V[n % 3] : '',
          hs ? S[(n + 1) % 3] : '', hs ? b : '', hs ? add(b, 1) : '', hs ? V[(n + 2) % 3] : '',
          'Placeholder description.', hw ? 'Slot 1|Slot 2' : '']);
      }
    });
    ev.getRange(2, 1, rows.length, EV_HEAD.length).setValues(rows);
  }

  if (rg.getLastRow() === 0) { rg.appendRow(RG_HEAD); rg.setFrozenRows(1); }
  rg.getRange(1, C.ROLL, rg.getMaxRows(), 3).setNumberFormat('@');   // Roll, Email, Phone stay text
  rg.getRange(1, C.IDS, rg.getMaxRows(), 3).setNumberFormat('@');    // Event IDs, Preferences, Schedule
  rg.getRange(1, C.STATUS, rg.getMaxRows(), 1).setNumberFormat('@');
  CacheService.getScriptCache().remove('events');
}

/* ---------------- final programme ---------------- */

// BEGIN FINAL EVENTS (generated by tools/build_events.py)
const FINAL_EVENTS = [
  ["PHO1", "Photography Cup", "Open-for-All Workshops", "Workshop", "", "", "", "Online", "", "", "", "", "Open to all. Online workshops running throughout DP, dates to be announced.", ""],
  ["PHO2", "Photography Cup", "Contingent Selection", "Selection", "", "", "", "", "2026-10-28", "", "", "", "Contingent selection. Time and venue to be announced.", ""],
  ["QUI1", "Quiz Cup", "Quiz Week", "Selection", "", "", "", "", "2026-10-28 to 2026-11-03", "18:00", "", "Bhatnagar Auditorium", "Contingent selection. From 6 PM each day.", ""],
  ["DIG1", "Digital Arts Cup", "Digital Illustration", "Workshop", "2026-10-17, 2026-10-20", "10:00", "11:00", "Online", "", "", "", "", "Open to all.", ""],
  ["DIG2", "Digital Arts Cup", "3D Sculpting", "Workshop", "2026-10-23, 2026-10-26", "19:30", "20:30", "Online", "", "", "", "", "Open to all.", ""],
  ["DIG3", "Digital Arts Cup", "Digital Arts", "Selection", "", "", "", "", "2026-10-30", "17:30", "20:30", "S301/302", "Selection interview. Digital art task submission deadline: 29 Oct.", ""],
  ["FAS1", "Fashion Cup", "Costume Design", "Both", "2026-10-24", "", "", "Online", "2026-10-27", "17:30", "20:30", "S301/302", "Workshop is open to all.", ""],
  ["FAS2", "Fashion Cup", "Fashion Designing", "Workshop", "2026-10-24", "", "", "Online", "", "", "", "", "", ""],
  ["FAS3", "Fashion Cup", "Fashion Photography", "Workshop", "2026-10-27", "", "", "Offline", "", "", "", "", "Offline workshop, no venue needed.", ""],
  ["FAS4", "Fashion Cup", "Fashion", "Selection", "", "", "", "", "2026-10-28 to 2026-10-29", "18:00", "", "Kalidas", "", ""],
  ["FIN1", "Fine Arts Cup", "Sketching", "Selection", "", "", "", "", "2026-10-27, 2026-10-28", "17:30", "20:30", "S301/302", "", ""],
  ["FIN2", "Fine Arts Cup", "Charcoal Art", "Selection", "", "", "", "", "2026-10-28", "17:30", "20:30", "S301/302", "", ""],
  ["FIN3", "Fine Arts Cup", "Canvas Painting", "Selection", "", "", "", "", "2026-10-29", "17:30", "20:30", "S301/302", "", ""],
  ["FIL1", "Filmmaking Arts Cup", "Crew", "Selection", "", "", "", "", "2026-10-27 to 2026-10-29", "", "", "VP Room (preferred)", "", ""],
  ["FIL2", "Filmmaking Arts Cup", "Acting Auditions and Music Team", "Selection", "", "", "", "", "2026-10-30 to 2026-11-03, 2026-11-09 to 2026-11-10", "", "", "VP Room (preferred)", "Round 1: 30 Oct - 3 Nov. Round 2: 9 - 10 Nov.", ""],
  ["COM1", "Comedic Arts Cup", "Improv", "Both", "2026-10-27", "18:00", "22:00", "SN Bose / Raman / Bhatnagar", "2026-10-28", "", "", "SN Bose / Raman / Bhatnagar", "Buffer dates for Improv selections: 29 Oct - 2 Nov.", ""],
  ["COM2", "Comedic Arts Cup", "Stand-up", "Selection", "", "", "", "", "2026-10-29 to 2026-11-02", "", "", "SN Bose / Raman / Bhatnagar", "These dates also act as buffer dates for Improv selections.", ""],
  ["CUL1", "Culinary Arts Cup", "Culinary Arts", "Selection", "", "", "", "", "2026-10-27 to 2026-10-29, 2026-11-02 to 2026-11-03", "", "", "Round 1: any classroom or auditorium. Round 2: Gymkhana Kitchen and ESR", "Round 1: 27 - 29 Oct. Round 2: 2 - 3 Nov.", ""],
  ["CUL2", "Culinary Arts Cup", "Mixology (with Open IIT)", "Selection", "", "", "", "", "2026-10-30", "", "", "", "Held together with Open IIT.", ""],
  ["DAN1", "Dance Arts Cup", "Dance Arts", "Selection", "", "", "", "", "2026-11-04 to 2026-11-05", "18:00", "", "Vikramshila V1 / V2 / V3 / V4", "Contingent selection.", ""],
  ["LIT1", "Literary Arts Cup", "English Slam Poetry", "Selection", "", "", "", "", "2026-10-29 to 2026-10-30", "", "", "Main Building Auditoriums / Gargi / Maitreyee / Vikramshila Rooms", "", ""],
  ["LIT2", "Literary Arts Cup", "Hindi Creative and English Poetry Writing", "Selection", "", "", "", "", "2026-10-31", "", "", "Bhatnagar / Raman Auditorium", "Writing event.", ""],
  ["LIT3", "Literary Arts Cup", "Mushaira and Hindi Slam Poetry", "Selection", "", "", "", "", "2026-10-31 to 2026-11-01", "", "", "Main Building Auditoriums / Gargi / Maitreyee / Vikramshila Rooms", "", ""],
  ["LIT4", "Literary Arts Cup", "English Creative and Hindi Poetry Writing", "Selection", "", "", "", "", "2026-11-01", "", "", "Bhatnagar / Raman Auditorium", "Writing event.", ""],
  ["SPE1", "Speaking Arts Cup", "J-a-M", "Both", "2026-10-27", "", "", "Any Main Building room", "2026-10-28 to 2026-10-29", "", "", "Two separate Main Building rooms", "", ""],
  ["SPE2", "Speaking Arts Cup", "Cryptic", "Both", "2026-10-28", "", "", "Separate Main Building room", "2026-10-29, 2026-10-30", "", "", "Prelims: separate Main Building room. Final round: any Main Building room", "Prelims on 29 Oct, final round on 30 Oct.", ""],
  ["SPE3", "Speaking Arts Cup", "Scrabble", "Both", "2026-10-30", "", "", "Any Main Building room", "2026-10-31", "", "", "Open IIT-booked room or Main Building room", "Selection is held together with Open IIT.", ""]
];
// END FINAL EVENTS

// Replaces everything on the Events tab with the final programme above. Menu: IICM > Load final events.
function loadFinalEvents() {
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { /* no UI when run from a trigger */ }
  if (ui && ui.alert && ui.alert('Replace the Events tab?', 'This overwrites every row on the Events tab with the final programme (' + FINAL_EVENTS.length + ' events). Registrations are not touched.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return 'Cancelled.';
  const ss = SpreadsheetApp.getActive();
  const ev = ss.getSheetByName('Events') || ss.insertSheet('Events');
  ev.clear();
  ev.getRange(1, 1, ev.getMaxRows(), EV_HEAD.length).setNumberFormat('@');   // dates and times stay plain text
  ev.getRange(1, 1, 1, EV_HEAD.length).setValues([EV_HEAD]);
  ev.setFrozenRows(1);
  ev.getRange(2, 1, FINAL_EVENTS.length, EV_HEAD.length).setValues(FINAL_EVENTS);
  CacheService.getScriptCache().remove('events');
  const msg = 'Loaded ' + FINAL_EVENTS.length + ' events.';
  try { ss.toast(msg, 'IICM', 6); } catch (e) { /* ignore */ }
  return msg;
}

/* ---------------- optional: built-in confirmation sender ---------------- */
// Sends one email per row whose "Mail status" is empty, from the account that owns this script,
// and stops when the account's daily quota is used up. Run again the next day (or turn on auto-send).

function onOpen() {
  SpreadsheetApp.getUi().createMenu('IICM')
    .addItem('Send confirmations to unsent rows', 'sendConfirmations')
    .addItem('Turn on hourly auto-send', 'installTrigger')
    .addItem('Turn off auto-send', 'removeTrigger')
    .addSeparator()
    .addItem('Load final events (replaces Events tab)', 'loadFinalEvents')
    .addItem('Create tabs (first-time setup)', 'setup')
    .addToUi();
}

const esc_ = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildMail_(name, scheduleLines) {
  const text = 'Hi ' + name + ',\n\nYou are registered for IICM 9.0. Your schedule:\n\n' + scheduleLines.join('\n') +
    '\n\nTo change anything, register again on the website with the same email; your latest submission replaces this one.\n\nTeam IICM 9.0, IIT Kharagpur';
  const rows = scheduleLines.map(l => '<tr><td style="padding:8px 12px;border-bottom:1px solid #E3DFF3">' + esc_(l).replace(/ \| /g, ' &middot; ') + '</td></tr>').join('');
  const html = '<div style="font-family:Arial,sans-serif;color:#14112E;max-width:600px"><h2>You\'re registered, ' + esc_(name) + '</h2>' +
    '<p>Your schedule for the Inter-IIT Cultural Meet 9.0:</p><table style="border:1px solid #E3DFF3;border-collapse:collapse;width:100%;font-size:14px">' + rows + '</table>' +
    '<p style="color:#5C5878;font-size:13px">To change anything, register again on the website with the same email; your latest submission replaces this one.</p>' +
    '<p style="color:#5C5878;font-size:13px">Team IICM 9.0, IIT Kharagpur</p></div>';
  return { text: text, html: html };
}

function sendConfirmations() {
  const sh = sheet_('Registrations');
  const last = sh.getLastRow();
  if (last < 2) return;
  const data = sh.getRange(2, 1, last - 1, RG_HEAD.length).getValues();
  const t0 = Date.now();
  let sent = 0, stoppedFor = '';
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (String(r[C.STATUS - 1]).trim()) continue;
    if (MailApp.getRemainingDailyQuota() < 1) { stoppedFor = 'daily email quota used up'; break; }
    if (Date.now() - t0 > 4.5 * 60 * 1000) { stoppedFor = 'time limit, run again'; break; }
    const row = i + 2;
    try {
      const lines = String(r[C.SCHED - 1]).split('\n').filter(Boolean);
      const m = buildMail_(r[C.NAME - 1], lines);
      MailApp.sendEmail({ to: r[C.EMAIL - 1], subject: CFG.SUBJECT, body: m.text, htmlBody: m.html, name: CFG.FROM_NAME, replyTo: CFG.REPLY_TO });
      sh.getRange(row, C.STATUS, 1, 2).setValues([['Sent', new Date()]]);
      sent++;
    } catch (err) {
      sh.getRange(row, C.STATUS).setValue('Error: ' + String(err.message || err).slice(0, 80));
    }
  }
  const msg = 'Sent ' + sent + ' email(s).' + (stoppedFor ? ' Stopped: ' + stoppedFor + '.' : '');
  try { SpreadsheetApp.getActive().toast(msg, 'IICM', 8); } catch (e) { /* running from a trigger */ }
  return msg;
}

function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('sendConfirmations').timeBased().everyHours(1).create();
}
function removeTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendConfirmations').forEach(t => ScriptApp.deleteTrigger(t));
}
