// End-to-end check of index.html in a real browser with a fake Sheet CSV and a fake registration API.
// Usage: npm run test:browser   (needs the global `playwright` package; set CHROME to use a specific browser)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS || '/tmp';

const CSV = [
  'ID,Cup,Name,Type,Wdate,Wstart,Wend,Wvenue,Sdate,Sstart,Send,Svenue,About,Slots',
  'A1,Cup A,"Dance, Solo",Workshop,2026-11-14,9:00,11:00,Hall A,,,,,,Slot 1|Slot 2',
  'A2,Cup A,Mime,Selection,,,,,2026-11-14,10:00,11:30,Hall B,,',
  'A3,Cup A,Skit,Both,2026-11-15,14:00,16:00,Room C,2026-11-22,10:00,11:00,Hall A,,Slot 1|Slot 2',
  'B1,Cup B,"Quiz ""Pro""",Workshop,2026-11-15,15:00,17:00,Hall B,,,,,,',
  'B2,Cup B,Music,Selection,,,,,2026-11-22,11:00,12:00,Hall B,,',
].join('\n');

const server = http.createServer((req, res) => {
  const f = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(8123, r));

const CONFIG = "window.IICM={API_URL:'https://api.test/api',EVENTS_URL:'https://sheet.test/events.csv',CONTACT_EMAIL:'team@example.com',RULES_URL:''};";
const cors = { 'Access-Control-Allow-Origin': '*' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = [];
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('https://sheet.test/**', (r) => (opts.csvFails ? r.fulfill({ status: 500, body: 'x' }) : r.fulfill({ headers: cors, contentType: 'text/csv', body: CSV })));
  await page.route('https://api.test/**', async (r) => {
    const req = r.request();
    if (req.method() === 'POST') {
      posts.push(JSON.parse(req.postData()));
      assert.equal(new URL(req.url()).pathname, '/api/register');
      const busy = posts.length === 1 && opts.busyFirst;
      const body = busy ? { ok: false, busy: true } : { ok: true, updated: !!opts.updated, mailed: !opts.mailFails };
      return r.fulfill({ status: busy ? 503 : 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    const events = CSV.split('\n').slice(1).map((l) => l.split(',')[0]).map((id) => ({ id, cup: 'Cup ' + id[0], name: 'From API ' + id, type: 'Workshop', wd: '2026-11-14', ws: '09:00', we: '10:00', wv: 'H', sd: '', ss: '', se: '', sv: '', about: '', slots: '' }));
    return r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, events }) });
  });
  return { page, ctx, errors, posts };
}

const tick = (page, id) => page.locator(`input[type=checkbox][data-id="${id}"]`).click();
const fill = async (page) => {
  await page.fill('#nm', 'Asha Rao'); await page.fill('#rl', '21CS10001'); await page.selectOption('#yr', '3rd year');
  await page.fill('#em', 'asha@kgpian.iitkgp.ac.in'); await page.fill('#ph', '+91 98765 43210'); await page.fill('#in', 'IIT Kharagpur');
};
let n = 0; const ok = (m) => console.log(`ok ${++n} - ${m}`);

// ---- 1. main flow on desktop ----
{
  const { page, errors, posts } = await newPage({ busyFirst: true });
  await page.goto('http://localhost:8123/');
  await page.waitForSelector('.rw');
  assert.equal(await page.locator('.rw').count(), 5); ok('5 events loaded from the published CSV');
  assert.equal(await page.textContent('#sc'), '2'); assert.equal(await page.textContent('#se'), '5');
  assert.equal(await page.textContent('#sd'), '3'); ok('stats: 2 cups, 5 events, 3 days');
  assert.match(await page.textContent('#list'), /Dance, Solo/); assert.match(await page.textContent('#list'), /Quiz "Pro"/); ok('quoted CSV names parse');

  await page.fill('#q', 'Cup B'); await page.waitForTimeout(250); assert.equal(await page.locator('.rw').count(), 2);
  await page.fill('#q', ''); await page.waitForTimeout(250); assert.equal(await page.locator('.rw').count(), 5); ok('search by cup works');
  await page.click('#types [data-t="Selection"]'); assert.equal(await page.locator('.rw').count(), 3); // A2, A3(Both), B2
  await page.click('#types [data-t="All"]'); ok('type filter includes Both');

  await tick(page, 'A1'); await tick(page, 'A2');
  assert.equal(await page.locator('.rw.x').count(), 2); ok('time clash highlights both events (9:00 vs 10:00 start)');
  assert.match(await page.textContent('#w1'), /2 events clash/);
  await fill(page); await page.check('#c1'); await page.check('#c2');
  await page.click('#sub');
  assert.match(await page.textContent('#msg'), /clash/); assert.equal(posts.length, 0); ok('submit is blocked while clashing');

  await tick(page, 'A2'); assert.equal(await page.locator('.rw.x').count(), 0);
  await tick(page, 'B2'); await tick(page, 'A3');
  assert.equal(await page.locator('.rw.x').count(), 0); ok('back-to-back (10-11 then 11-12) is not a clash');
  assert.equal(await page.textContent('#n1'), '3');
  assert.equal(await page.locator('#pf .pr').count(), 2); ok('workshop preferences only for Workshop/Both events');
  await page.selectOption('#pf select[data-s="A3"]', 'Slot 2');
  await page.locator('input[name="aA1"][value="Maybe"]').check();

  await page.reload(); await page.waitForSelector('.rw');
  assert.equal(await page.inputValue('#nm'), 'Asha Rao'); assert.equal(await page.textContent('#n1'), '3'); ok('unfinished form survives a refresh');
  await page.check('#c1'); await page.check('#c2');

  await page.screenshot({ path: `${shots}/desktop.png`, fullPage: false });
  await page.click('#sub');
  await page.waitForSelector('.done', { timeout: 8000 });
  assert.equal(posts.length, 2); ok('first attempt was "busy"; page retried automatically');
  const p = posts[1];
  assert.deepEqual(p.events.sort(), ['A1', 'A3', 'B2']);
  assert.equal(p.email, 'asha@kgpian.iitkgp.ac.in'); assert.equal(p.year, '3rd year'); assert.equal(p.website, '');
  assert.deepEqual(p.prefs, { A1: { a: 'Maybe', s: 'Slot 1' }, A3: { a: 'Attend', s: 'Slot 2' } }); ok('payload has details, events and workshop preferences');
  const done = await page.textContent('.done');
  assert.match(done, /asha@kgpian.iitkgp.ac.in/); assert.match(done, /team@example.com/); assert.match(done, /Dance, Solo/); assert.match(done, /on its way/); ok('success screen shows email, contact and the schedule');
  await page.screenshot({ path: `${shots}/success.png`, fullPage: true });
  assert.deepEqual(errors, []); ok('no JavaScript errors');
  assert.equal(await page.evaluate(() => localStorage.getItem('iicm9-sheet-draft')), null); ok('draft cleared after submit');
}

// ---- 2. re-registration message ----
{
  const { page } = await newPage({ updated: true });
  await page.goto('http://localhost:8123/'); await page.waitForSelector('.rw');
  await tick(page, 'A1'); await fill(page); await page.check('#c1'); await page.check('#c2'); await page.click('#sub');
  await page.waitForSelector('.done');
  assert.match(await page.textContent('.done'), /replaced your earlier one/); ok('re-registration says it replaced the earlier entry');
}

// ---- 3. fallback when the CSV is down ----
{
  const { page } = await newPage({ csvFails: true });
  await page.goto('http://localhost:8123/'); await page.waitForSelector('.rw');
  assert.match(await page.textContent('#list'), /From API A1/); ok('falls back to the API when the CSV fails');
}

// ---- 4. validation messages ----
{
  const { page, posts } = await newPage();
  await page.goto('http://localhost:8123/'); await page.waitForSelector('.rw');
  await page.click('#sub'); assert.match(await page.textContent('#msg'), /all your details/);
  await fill(page); await page.fill('#em', 'bad@'); await page.click('#sub'); assert.match(await page.textContent('#msg'), /institute email/);
  await page.fill('#em', 'asha@gmail.com'); await page.click('#sub'); assert.match(await page.textContent('#msg'), /institute email \(ending in @kgpian\.iitkgp\.ac\.in\)/);
  assert.equal(await page.getAttribute('#em', 'aria-invalid'), 'true'); ok('non-institute email is rejected in the form');
  await page.fill('#em', 'a.rao'); await page.locator('#em').blur(); assert.equal(await page.inputValue('#em'), 'a.rao@kgpian.iitkgp.ac.in'); ok('typing just the username fills in the institute domain');
  await page.click('#sub'); assert.match(await page.textContent('#msg'), /at least one event/);
  await tick(page, 'A1'); await page.click('#sub'); assert.match(await page.textContent('#msg'), /both confirmations/);
  assert.equal(posts.length, 0); ok('form validation messages');
  await page.fill('#hp', 'spam'); await page.check('#c1'); await page.check('#c2'); await page.click('#sub'); await page.waitForSelector('.done');
  assert.equal(posts[0].website, 'spam'); ok('honeypot value is sent so the server can drop bots');
}

// ---- 5. mobile layout ----
{
  const { page, errors, posts } = await newPage({ viewport: { width: 390, height: 844 }, mailFails: true });
  await page.goto('http://localhost:8123/'); await page.waitForSelector('.rw');
  assert.equal(await page.isVisible('#rail'), false);
  assert.equal(await page.evaluate(() => document.getElementById('bar').classList.contains('off')), true); ok('mobile: bottom bar stays out of the way over the hero');
  await page.locator('#choose').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.getElementById('bar').classList.contains('off')), false); ok('mobile: bottom bar appears once past the hero');
  const chipsH = await page.evaluate(() => document.getElementById('chips').getBoundingClientRect().height);
  assert.ok(chipsH < 70, 'chips height ' + chipsH); ok('mobile: Cup chips are one swipeable row');

  await page.locator('.rw[data-id="A1"] .sd').click(); // tap the row, not the checkbox
  assert.equal(await page.isChecked('input[data-id="A1"]'), true); ok('mobile: tapping anywhere on an event row ticks it');
  await tick(page, 'A2');
  assert.match(await page.textContent('.rw[data-id="A1"] .warn'), /Clashes with A2 Mime/); ok('clash warning names the other event');
  assert.match(await page.textContent('#w2'), /2 clash/);
  await tick(page, 'A2');

  await page.click('#bb'); await page.waitForTimeout(900);
  await page.click('#sub'); await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'nm');
  assert.equal(await page.getAttribute('#nm', 'aria-invalid'), 'true'); ok('mobile: submit with empty details jumps to and focuses the first field');
  assert.ok(await page.evaluate(() => document.getElementById('toast').classList.contains('on'))); ok('error toast is visible after the jump');
  await page.fill('#ph', 'call me'); await page.locator('#ph').blur();
  assert.equal(await page.getAttribute('#ph', 'aria-invalid'), 'true'); assert.equal(await page.isVisible('#ph + .fe'), true); ok('invalid phone is flagged as soon as you leave the field');
  await fill(page); assert.equal(await page.getAttribute('#ph', 'aria-invalid'), null); ok('flag clears when corrected');

  await page.focus('#em'); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.getElementById('bar').classList.contains('off')), true); ok('mobile: bottom bar hides while typing');
  await page.locator('#em').blur();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'horizontal overflow ' + overflow); ok('mobile: no horizontal scroll');
  await page.screenshot({ path: `${shots}/mobile.png` });
  await page.check('#c1'); await page.check('#c2'); await page.click('#sub'); await page.waitForSelector('.done');
  assert.equal(posts.length, 1);
  assert.match(await page.textContent('.done'), /will be sent to/); ok('success screen copes with a delayed email');
  assert.deepEqual(errors, []); ok('no JavaScript errors on mobile');
}

// ---- 6. hero carousel, marquee, reveal ----
{
  const { page, errors } = await newPage();
  await page.goto('http://localhost:8123/'); await page.waitForSelector('.rw');
  assert.equal(await page.locator('.slide').count(), 5); assert.equal((await page.textContent('#cn')).trim(), '01 / 05');
  await page.click('#nx'); assert.equal((await page.textContent('#cn')).trim(), '02 / 05');
  await page.click('#pv'); await page.click('#pv'); assert.equal((await page.textContent('#cn')).trim(), '05 / 05'); ok('carousel: 5 placeholder slides, next/prev wrap around');
  await page.click('#pp'); assert.equal(await page.getAttribute('#pp', 'aria-label'), 'Play slideshow'); ok('carousel: pause button toggles');
  await page.click('#segs .seg:nth-child(3)'); assert.equal((await page.textContent('#cn')).trim(), '03 / 05'); ok('carousel: progress segments jump to a slide');
  assert.equal(await page.isHidden('#cd'), true); ok('countdown stays hidden until COUNTDOWN_TO is set');
  assert.ok(await page.locator('#mt span').count() >= 20); ok('marquee is filled');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${shots}/hero.png` });
  await page.locator('#choose').scrollIntoViewIfNeeded(); await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => document.querySelector('#choose').classList.contains('in')), true); ok('tall cards reveal on scroll');
  await page.screenshot({ path: `${shots}/events.png` });
  assert.deepEqual(errors, []); ok('no JavaScript errors in carousel flow');
}

await browser.close(); server.close();
console.log('ALL PASSED');
