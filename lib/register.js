// Validates a registration, saves it (one document per email) and sends the confirmation mail.
import { getEvents, hasClash, scheduleLines } from './events.js';
import { registrations } from './db.js';
import { sendConfirmation } from './mail.js';

export const YEARS = ['1st year', '2nd year', '3rd year', '4th year', '5th year', 'PG / PhD'];
const ATTEND = ['Attend', 'Maybe', 'Skip'];

const clean = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

// Only institute addresses may register. EMAIL_DOMAINS (comma-separated) overrides; '*' allows any domain.
export const emailDomains = () => (process.env.EMAIL_DOMAINS || 'kgpian.iitkgp.ac.in').split(',').map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
export const domainOk = email => { const D = emailDomains(); return D.includes('*') || D.includes(email.slice(email.lastIndexOf('@') + 1)); };

// Returns { ok, error?, updated?, mailed? }. deps are swappable for tests.
export async function register(b, deps = {}) {
  const { events = getEvents, col = registrations, mail = sendConfirmation, now = () => new Date() } = deps;
  b = b && typeof b === 'object' ? b : {};
  if (b.website) return { ok: true }; // honeypot: only bots fill it

  const name = clean(b.name, 100), roll = clean(b.roll, 40), email = clean(b.email, 120).toLowerCase();
  const phone = clean(b.phone, 20), inst = clean(b.inst, 120), year = clean(b.year, 20);
  if (!name || !roll || !phone || !inst || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please complete your details.' };
  if (!domainOk(email)) return { ok: false, error: `Use your institute email (ending in @${emailDomains()[0]}).` };
  if (!/^\+?[\d\s-]{7,18}$/.test(phone)) return { ok: false, error: 'Enter a valid WhatsApp number.' };
  if (!YEARS.includes(year)) return { ok: false, error: 'Pick your year.' };

  const ids = Array.isArray(b.events) ? b.events.filter((x, i, a) => typeof x === 'string' && a.indexOf(x) === i).slice(0, 80) : [];
  if (!ids.length) return { ok: false, error: 'Pick at least one event.' };

  const byId = new Map((await events()).map(ev => [ev.id, ev]));
  const chosen = ids.map(id => byId.get(id));
  if (chosen.some(x => !x)) return { ok: false, error: 'An event you picked no longer exists. Please reload the page.', reload: true };
  if (hasClash(chosen)) return { ok: false, error: 'Two of your events clash. Please fix and resubmit.' };

  const prefs = {};
  chosen.forEach(ev => {
    if (ev.type === 'Selection') return;
    const slots = ev.slots ? ev.slots.split('|').map(s => s.trim()).filter(Boolean) : [];
    const g = (b.prefs && typeof b.prefs === 'object' && b.prefs[ev.id]) || {};
    prefs[ev.id] = { a: ATTEND.includes(g.a) ? g.a : 'Attend', s: slots.includes(g.s) ? g.s : (slots[0] || '') };
  });

  const c = await col();
  const at = now();
  const doc = {
    name, roll, email, phone, institute: inst, year,
    events: chosen.map(x => x.id), prefs, schedule: scheduleLines(chosen).join('\n'),
    updatedAt: at, mail: { status: 'pending' },
  };
  // One document per email: a repeat registration replaces the earlier one and bumps the counter.
  const upsert = () => c.findOneAndUpdate({ email },
    { $set: doc, $inc: { submissions: 1 }, $setOnInsert: { createdAt: at } },
    { upsert: true, returnDocument: 'before', projection: { _id: 1 } });
  let before;
  try { before = await upsert(); }
  catch (err) { if (err && err.code === 11000) before = await upsert(); else throw err; } // two submits raced on the same email

  // A failed mail never fails the registration; scripts/resend.js retries anything not marked sent.
  let mailed = false;
  try {
    const r = await mail({ to: email, name, events: chosen.map(e => ({ id: e.id, name: e.name, cup: e.cup })) });
    await c.updateOne({ email }, { $set: { mail: { status: 'sent', at: now(), messageId: r && r.messageId } } });
    mailed = true;
  } catch (err) {
    await c.updateOne({ email }, { $set: { mail: { status: 'failed', at: now(), error: String((err && err.message) || err).slice(0, 200) } } }).catch(() => {});
  }
  return { ok: true, updated: !!before, mailed };
}
