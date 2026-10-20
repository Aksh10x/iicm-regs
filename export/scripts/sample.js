// Writes sample.zip from made-up registrations, to check the files without the database.
// Usage: npm run sample -- <password>
import fs from 'node:fs';
import { buildZip } from '../lib/build.js';
import { SAMPLE } from '../tests/sample-data.js';

const { zip } = await buildZip(SAMPLE, { password: process.argv[2] || 'sample' });
fs.writeFileSync('sample.zip', zip);
console.log(`Wrote sample.zip (${Math.round(zip.length / 1024)} KB)`);
