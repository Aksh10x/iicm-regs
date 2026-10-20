// Made-up registrations in the shape the registration site stores.
const d = (s) => new Date(s);
const person = (i, o) => ({
  name: `Student ${i}`, roll: `24CS1000${i}`, email: `student${i}@kgpian.iitkgp.ac.in`, personalEmail: i % 2 ? `s${i}@gmail.com` : '',
  phone: `+91 98765 4321${i}`, dept: 'Computer Science and Engineering', hall: 'Azad Hall of Residence', year: 'UG 2nd Year',
  whatsappCommunity: true, createdAt: d(`2026-10-2${i % 3}T0${i}:00:00Z`), updatedAt: d(`2026-10-2${i % 3}T0${i}:30:00Z`),
  mailStatus: 'sent', mailError: '', mailSentAt: d(`2026-10-2${i % 3}T0${i}:31:00Z`), submissions: 1, ...o,
});
const QUIZ = { id: 'QUI1', name: 'Quiz Cup Registration', cup: 'Quiz Cup', date: '29 Oct–4 Nov', venue: 'Raman Auditorium, Main Building' };
const FILM = t => ({ id: 'FIL1', name: 'Online Short Film Competition', cup: 'Filmmaking Arts Cup', track: t, date: t === 'Crew Member' ? '27–29 Oct' : '30 Oct–3 Nov', venue: 'VP Room' });
const STAND = { id: 'COM1', name: 'Standup Comedy', cup: 'Comedic Arts Cup', date: '27 Oct–2 Nov', venue: 'SN Bose Auditorium, Main Building' };
export const SAMPLE = [
  person(1, { events: ['QUI1', 'FIL1'], tracks: { FIL1: 'Crew Member' }, eventDetails: [QUIZ, FILM('Crew Member')] }),
  person(2, { events: ['COM1'], eventDetails: [STAND], mailStatus: 'failed', mailError: '550 5.4.5 Daily user sending limit exceeded', mailSentAt: null }),
  person(3, { events: ['FIL1', 'COM1', 'QUI1'], tracks: { FIL1: 'Music & Acting Team' }, eventDetails: [FILM('Music & Acting Team'), STAND, QUIZ], name: 'Ānanya “Annie” Rao, Jr.' }),
  person(4, { events: ['QUI1'], eventDetails: [QUIZ], dept: 'Dual degree, IDD', mailStatus: 'pending', mailSentAt: null }),
];
