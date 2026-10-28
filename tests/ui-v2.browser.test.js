// The quality panel is a thin layer over the original selects: clicking it must drive them, and the page must keep working.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let chromium; try { ({ chromium } = require('playwright')); } catch { /* optional */ }
const root = path.resolve(__dirname, '..');
const mockSource = fs.readFileSync(path.join(__dirname, 'library.browser.test.js'), 'utf8').match(/function mockExtension\(\)\{[\s\S]*?\n\}\n/)[0];
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };

async function withPage(run) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x').pathname;
    const file = path.join(root, url === '/' ? 'recorder.html' : url);
    try { res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(eval('(' + mockSource.replace('function mockExtension', 'function') + ')'));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true' && document.querySelector('.v2-quality'));
    await run(page, errors);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
}

test('preset cards drive the original quality, content and frame-rate controls and show distinct sizes', { skip: !chromium }, () => withPage(async page => {
  await page.locator('.v2-preset[data-preset="motion"]').click();
  assert.deepEqual(await page.evaluate(() => [$('quality').value, $('capture-content').value, $('framerate').value]), ['standard', 'motion', '30']);
  assert.equal(await page.locator('.v2-preset[data-preset="motion"]').getAttribute('aria-pressed'), 'true');
  await page.locator('.v2-preset[data-preset="lecture"]').click();
  assert.deepEqual(await page.evaluate(() => [$('quality').value, $('capture-content').value, $('framerate').value]), ['compact', 'detail', '24']);
  const sizes = await page.locator('.v2-preset-size').allTextContents();
  assert.equal(new Set(sizes).size, 3, 'each preset states its own estimated size: ' + sizes.join(' | '));
}));

test('format chips set the format, never enable an unsupported one, and the record button sits in the settings column', { skip: !chromium }, () => withPage(async page => {
  await page.locator('.v2-chip[data-format="vp9"]').click();
  assert.equal(await page.evaluate(() => $('format').value), 'vp9');
  assert.equal(await page.evaluate(() => $('engine').value), 'standard');
  await page.locator('.v2-chip[data-format="mp4"]').click();
  assert.equal(await page.evaluate(() => $('format').value), 'mp4');
  assert.equal(await page.evaluate(() => !!document.querySelector('.studio-record-settings #start')), true);
  const disabled = await page.evaluate(() => [...document.querySelectorAll('.v2-chip')].filter(chip => chip.disabled).map(chip => chip.dataset.format));
  for (const format of disabled) assert.equal(await page.evaluate(f => $('format').querySelector('[value="' + f + '"]').disabled, format), true);
}));

test('the appearance toggle switches theme and remembers it', { skip: !chromium }, () => withPage(async page => {
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.locator('#theme-toggle').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.equal(await page.evaluate(() => localStorage.getItem('wescreen-theme')), 'light');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
}));
