import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runWebsiteAccessibilityAudit } from '../src/doctor/website-accessibility.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
let playwright;
let axe;
try {
  playwright = require('playwright');
  require.resolve('axe-core');
  axe = true;
} catch {}

test('real axe-core accessibility audit detects an unnamed button in a local browser fixture', { skip: !playwright || !axe ? 'Optional Playwright/axe-core packages are not installed.' : false }, async (t) => {
  const browserName = ['chromium', 'firefox', 'webkit'].includes(process.env.PAXI_BROWSER_ENGINE) ? process.env.PAXI_BROWSER_ENGINE : 'chromium';
  let browser;
  try { browser = await playwright[browserName].launch({ headless: true }); }
  catch { t.skip(`The ${browserName} browser binary is not installed.`); return; }
  await browser.close();
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Accessibility fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><button></button><h1>Fixture</h1></main></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const report = await runWebsiteAccessibilityAudit({
    url: `http://127.0.0.1:${address.port}/`,
    projectRoot: root,
    profiles: ['compact'],
    browserEngine: browserName,
    confirm: true
  });
  assert.equal(report.cases.length, 1);
  assert.equal(report.status, 'review');
  assert.ok(report.cases[0].violations.some((item) => item.id === 'button-name'));
});
