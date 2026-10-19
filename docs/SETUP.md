# Setup guide: website + MongoDB + Gmail

Total time: about 30 minutes. Total cost: $0.

```
Student browser ──> website + API (Vercel, or `npm start` on any server)
        │ reads events                     │ POST /api/register
        ▼                                  ├──> MongoDB Atlas (free M0): one document per email
  Events tab of the Google Sheet           └──> Gmail SMTP: "your registration has been received"
  (published CSV), or events.csv
```

Every registration is saved first, then the confirmation email is sent. If Gmail refuses (daily limit, network), the registration is still saved and marked `failed`, and `npm run resend` sends it later.

## 1. MongoDB Atlas, free tier (10 min)

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Create a cluster** and choose **M0 (Free)**. Pick AWS **Mumbai (ap-south-1)** as the region, since it's closest to Kharagpur.
3. **Database Access**: add a database user with a password (letters and digits only avoids URL-escaping trouble). Role: *Read and write to any database*.
4. **Network Access**: add `0.0.0.0/0` (allow from anywhere). Vercel has no fixed IP address, so this is required. The password still protects the database.
5. **Connect, Drivers, Node.js**: copy the connection string and put your password into it. This is your `MONGODB_URI`.

M0 is free with no time limit and gives 512 MB. A registration is about 1 to 2 KB, so 3,000 students use well under 10 MB. You can browse the data in Atlas under **Browse Collections**: database `iicm`, collection `registrations`.

## 2. Gmail SMTP with an App Password (5 min)

Gmail does not let apps sign in with your normal password. You need an **App Password**:

1. Sign in as **akshathsurwase@gmail.com** and open <https://myaccount.google.com/security>.
2. Turn on **2-Step Verification** if it's off. App Passwords only exist after this.
3. Open <https://myaccount.google.com/apppasswords>, create one called `IICM`, and copy the 16-character password. This is your `SMTP_PASS`. Google shows it once.

To switch to the official account later (for example iitkgpcl.iicm9.0@gmail.com), repeat these steps there and change `SMTP_USER` and `SMTP_PASS`. Nothing else changes.

**Sending limit.** A personal Gmail account can send to roughly **500 recipients per rolling 24 hours** (Workspace accounts get about 2,000). Google can apply lower limits to new accounts or to bursts that look like spam, so treat 500 as a ceiling. Going over it locks sending for up to 24 hours. With 2,000 to 3,000 students:

- The first ~500 confirmations go out immediately and the rest are marked `failed`.
- Run `npm run resend` once a day (it sends up to 400 by default, leaving headroom) until everyone is covered.
- The success screen already shows each student their full schedule, so a late email is not a problem.
- If you need everything sent the same day, use a Workspace sender or a transactional provider (Brevo's free plan allows 300 a day; Amazon SES costs about $0.10 per 1,000) by changing the `SMTP_*` settings.

## 3. Run it on your laptop (5 min)

Needs Node.js 20.12 or newer.

```sh
npm install
cp .env.example .env        # then fill in MONGODB_URI and SMTP_PASS
npm run test-mail           # sends one test email to SMTP_USER
npm start                   # http://localhost:3000
```

Register once with your own email. You should get the email, and the registration should appear in Atlas.

## 4. Deploy for free on Vercel (10 min)

1. Push this folder to a GitHub repository. `.env` is git-ignored, so keep it that way: never commit your passwords.
2. At <https://vercel.com/new>, import the repository. Leave Framework as **Other** and leave the build settings empty.
3. Under **Environment Variables**, add everything from your `.env` except `PORT`: `MONGODB_URI`, `MONGODB_DB`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM_NAME`, `MAIL_SUBJECT`, and `EVENTS_URL` if you use the Sheet.
4. Deploy. The website and API share one address, for example `https://iicm.vercel.app`, so `API_URL` in `config.js` stays empty.
5. Optional: add your own domain under **Settings, Domains**.

The Vercel Hobby plan is free and needs no card. After any change to the environment variables, redeploy (Deployments, ⋯, Redeploy).

**Hosting the website somewhere else** (GitHub Pages, Cloudflare Pages): set `API_URL` in `config.js` to `https://<your-vercel-app>.vercel.app/api`, and set `ALLOWED_ORIGIN` on Vercel to the website's address (for example `https://iicm.pages.dev`).

**Any other Node host** (Render, Railway, a college server): run `npm install && npm start` with the same environment variables. `server.js` serves the website and the API on `PORT`. Render's free plan sleeps after 15 minutes of no traffic, and the first visitor then waits about a minute, so avoid it on registration day.

## 5. Events

Events come from the first of these that works:

1. `EVENTS_URL`: the **Events** tab of the Google Sheet, published as CSV (**File, Share, Publish to web**, choose the Events tab, then CSV). The team can keep editing events in the Sheet, and changes show within about a minute. Set the same link in both `.env` (for the server's checks) and `config.js` (so pages load fast).
2. `events.csv` in this folder. Regenerate it from `tools/build_events.py`.

Columns, in order: ID, Cup, Name, Type (`Workshop`/`Selection`/`Both`), workshop date/start/end/venue, selection date/start/end/venue, About, Workshop slots (`Slot 1|Slot 2`, optional).

- A date cell can be one date `2026-10-28`, a range `2026-10-28 to 2026-11-03`, or a comma-separated list. Times are optional 24-hour `HH:MM`.
- Two events clash only if both have a start and end time and overlap on a shared day. Back-to-back is fine.
- Never change an event's ID once students have registered for it.

`Code.gs` is the old Apps Script back end. You only need it for its **IICM, Load final events** menu, which fills the Sheet's Events tab. Registrations no longer go to the Sheet.

## 6. Photos, countdown and look

Put images in `img/` (landscape 1920x1080 JPG, under about 400 KB each) and list them under `SLIDES` in `config.js`. `COUNTDOWN_TO`, `MARQUEE` and `GALLERY` are also in `config.js`.

## 7. During registration

| Task | Command |
|---|---|
| Download all registrations as CSV (opens in Excel / Sheets) | `npm run export` writes `exports/registrations-YYYY-MM-DD.csv` |
| Send confirmations that failed (quota, network) | `npm run resend` (or `npm run resend -- 100` to cap it) |
| Check mail settings | `npm run test-mail -- someone@example.com` |

Run these on your laptop with the same `.env` as production. Each student has one document, keyed by email. Registering again with the same email replaces the earlier choices, bumps `submissions`, and sends a fresh confirmation.

## 8. Test before announcing

1. `npm test` checks the server logic (no database needed). `npm run test:browser` checks the page in a real browser (needs the global `playwright` package).
2. Open the live site on a phone. Tick two overlapping events: both turn red and name each other, and submit is blocked.
3. Register with your own email. You should see the success screen and get the email (check spam the first time). The registration should appear in Atlas.
4. Register again with the same email and a different choice. Atlas should still have one document, with `submissions: 2`.

## Things to know

- **Secrets** live only in `.env` and in Vercel's environment variables. If the App Password leaks, delete it at <https://myaccount.google.com/apppasswords> and make a new one.
- **Spam / bots:** the form has a hidden honeypot field and the server re-validates everything (fields, event IDs, clashes). Someone could still send junk registrations to the public API. Sort by `createdAt` in Atlas and delete anything odd.
- **Privacy:** registrations hold phone numbers and emails. Share Atlas access and the exports only with the team.
- **Busy moments:** if the database is briefly unreachable, the API answers "busy" and the page retries automatically.
