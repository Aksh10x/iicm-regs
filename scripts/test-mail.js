// Sends one confirmation email to check the Gmail settings. Usage: npm run test-mail -- you@example.com
import { sendConfirmation } from '../lib/mail.js';

const to = process.argv[2] || process.env.SMTP_USER;
const info = await sendConfirmation({ to, name: 'Test', events: [{ id: 'DIG1', name: 'Digital Illustration', cup: 'Digital Arts Cup' }, { id: 'QUI1', name: 'Quiz Week', cup: 'Quiz Cup' }] });
console.log(`Sent to ${to} (${info.messageId}). Check the inbox and the spam folder.`);
