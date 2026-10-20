# IICM 9.0 registrations export

A one-page site for organisers: enter the password, get every registration as a password-protected zip.

The zip (AES-256, same password) holds:

| File | What is in it |
|---|---|
| `IICM registrations.xlsx` | **Summary** (registrations per event), **All registrations** (one row per student), **Email not sent** (confirmation failed or still pending, with the reason), and one sheet per event |
| `IICM registrations.pdf` | The summary, then one landscape page section per event, ready to print |
| `csv/` | The same tables as CSV: all registrations plus one file per event |

Opening the zip: AES-256 is not supported by the built-in unzip in macOS Finder or Windows Explorer. Use **The Unarchiver** or **Keka** (Mac, free) or **7-Zip** (Windows, free).

## How it works

- `public/index.html` is the page. It posts the password to `api/export.js`.
- `api/export.js` checks the password (slowly, with a cap on wrong tries), reads the `registrations` collection from MongoDB, and returns the zip.
- `lib/build.js` builds the Excel, PDF, CSV and zip. It reads what the registration site stores: student details, `eventDetails` (id, name, cup, track, date, venue), `whatsappCommunity` and `mailStatus` / `mailError`.

## Settings (Vercel project `iicm-regs-export`)

| Variable | Value |
|---|---|
| `MONGODB_URI` | The registration database (a read-only Atlas user is enough) |
| `MONGODB_DB` | `iicm` |
| `EXPORT_PASSWORD` | Unlocks the page **and** the zip. Change it here, then redeploy |

## Commands

```bash
npm install
npm test                      # builds a zip from sample data and opens it again
npm run sample -- <password>  # writes sample.zip from made-up registrations
npx vercel@62.2.0 deploy --prod   # run from this folder
```

This folder is its own Vercel project. Deploy from here, not from the repository root (the root is linked to the registration project).
