# IICM 9.0 Registration

Workshops and selections registration for the Inter-IIT Cultural Meet 9.0, IIT Kharagpur. Students pick events, see clashes live, and submit once. Each registration is stored in MongoDB, and the student gets a confirmation email through Gmail SMTP.

| File | Purpose |
|---|---|
| `index.html` | The whole student website: carousel hero, live schedule and clash checking, phone-first form |
| `config.js` | Website settings: `API_URL`, `EVENTS_URL`, contact email, carousel photos, countdown |
| `api/` | Vercel serverless functions: `GET /api/events`, `POST /api/register` |
| `lib/` | Shared server code: events and clash rules, MongoDB, Gmail mailer, registration logic |
| `server.js` | Runs the website and the API together on one port (`npm start`) for local use or any Node host |
| `scripts/` | `npm run export` (CSV of all registrations), `npm run resend` (retry unsent mails), `npm run test-mail` |
| `.env.example` | Settings and secrets template: copy to `.env` |
| `events.csv` | Bundled event list, used when `EVENTS_URL` is not set |
| `tools/build_events.py` | Single source for the real events: regenerates `events.csv` and the list in `Code.gs` |
| `Code.gs` | Old Google Apps Script back end, kept only for loading events into the Sheet |
| `tests/` | `npm test` (server logic), `npm run test:browser` (the page in a real browser, desktop and phone) |

Start with `docs/SETUP.md`.

```sh
npm install
cp .env.example .env   # add MONGODB_URI and the Gmail App Password
npm start              # http://localhost:3000
```
