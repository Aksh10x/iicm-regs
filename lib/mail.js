// Confirmation email through Gmail SMTP (needs a Google App Password, see docs/SETUP.md).
import nodemailer from 'nodemailer';

let transport = null;
function getTransport() {
  if (!transport) {
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS are not set');
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: +(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_PORT || '465') === '465',
      auth: { user, pass: pass.replace(/\s+/g, '') }, // Google shows app passwords with spaces
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
  }
  return transport;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// events: [{ id, name, cup }] the student picked, listed in the mail.
export function buildMail(name, events = []) {
  const subject = process.env.MAIL_SUBJECT || 'IICM 9.0: your registration has been received';
  const label = e => [e.id, e.name].filter(Boolean).join(' ') + (e.cup ? ` (${e.cup})` : '');
  const text = `Hi ${name},\n\nYour registration has been received.` +
    (events.length ? `\n\nEvents you registered for:\n${events.map(e => '- ' + label(e)).join('\n')}` : '') +
    `\n\nTeam IICM 9.0, IIT Kharagpur`;
  const html = `<div style="font-family:Arial,sans-serif;color:#2A140F;max-width:560px;line-height:1.5">` +
    `<p>Hi ${esc(name)},</p><p><b>Your registration has been received.</b></p>` +
    (events.length ? `<p style="margin-bottom:4px">Events you registered for:</p><ul style="margin-top:0;padding-left:20px">` +
      events.map(e => `<li>${e.id ? `<b>${esc(e.id)}</b> ` : ''}${esc(e.name || '')}${e.cup ? ` <span style="color:#6B5040">(${esc(e.cup)})</span>` : ''}</li>`).join('') + `</ul>` : '') +
    `<p style="color:#6B5040;font-size:13px">Team IICM 9.0, IIT Kharagpur</p></div>`;
  return { subject, text, html };
}

export async function sendConfirmation({ to, name, events }) {
  const m = buildMail(name, events);
  const from = `"${process.env.MAIL_FROM_NAME || 'IICM 9.0'}" <${process.env.SMTP_USER}>`;
  const info = await getTransport().sendMail({ from, to, replyTo: process.env.MAIL_REPLY_TO || undefined, subject: m.subject, text: m.text, html: m.html });
  return { messageId: info.messageId };
}
