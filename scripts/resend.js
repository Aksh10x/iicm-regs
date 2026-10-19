// Retries confirmation emails that were not sent (Gmail quota hit, network error, ...).
// Usage: npm run resend            (sends up to 400 by default)
//        npm run resend -- 50      (sends at most 50)
import { registrations, closeDb } from '../lib/db.js';
import { sendConfirmation } from '../lib/mail.js';
import { getEvents } from '../lib/events.js';

const limit = +(process.argv[2] || 400);
const col = await registrations();
const todo = await col.find({ 'mail.status': { $ne: 'sent' } }, { projection: { email: 1, name: 1, events: 1 } }).sort({ updatedAt: 1 }).limit(limit).toArray();
const byId = new Map((await getEvents()).map(e => [e.id, e]));
const picked = ids => (ids || []).map(id => { const e = byId.get(id); return e ? { id, name: e.name, cup: e.cup } : { id }; });
console.log(`${todo.length} unsent confirmation(s)` + (todo.length === limit ? ` (limited to ${limit})` : ''));

let sent = 0, failed = 0;
for (const r of todo) {
  try {
    const info = await sendConfirmation({ to: r.email, name: r.name, events: picked(r.events) });
    await col.updateOne({ _id: r._id }, { $set: { mail: { status: 'sent', at: new Date(), messageId: info.messageId } } });
    sent++;
  } catch (err) {
    const msg = String(err.message || err).slice(0, 200);
    await col.updateOne({ _id: r._id }, { $set: { mail: { status: 'failed', at: new Date(), error: msg } } });
    failed++;
    console.log(`  ${r.email}: ${msg}`);
    if (/daily|quota|limit|5\.4\.5|421|454/i.test(msg)) { console.log('Gmail sending limit reached. Run this again tomorrow.'); break; }
  }
}
console.log(`Sent ${sent}, failed ${failed}.`);
await closeDb();
