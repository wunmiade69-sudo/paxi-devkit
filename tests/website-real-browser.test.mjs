import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

let playwright = null;
try { playwright = await import('playwright'); } catch {}
const engine = process.env.PAXI_BROWSER_ENGINE || 'chromium';

test(`real Playwright ${engine} engine executes the PAXI semantic journey against a local fixture`, { skip: !playwright && 'Optional Playwright package is not installed in this environment.' }, async () => {
  assert.ok(['chromium','firefox','webkit'].includes(engine), 'PAXI_BROWSER_ENGINE must be chromium, firefox or webkit.');
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PAXI QA fixture</title></head><body>
    <h1>Profile</h1>
    <button id="load" aria-label="Load profile">Load profile</button>
    <button id="help">Help</button>
    <img src="/pixel.png" alt="PAXI test fixture pixel">
    <p id="result" data-testid="result" aria-live="polite">Not loaded</p>
    <script>
      document.querySelector('#load').addEventListener('click', async () => {
        const response = await fetch('/api/profile');
        const data = await response.json();
        document.querySelector('#result').textContent = 'Profile loaded: ' + data.name;
      });
    </script>
  </body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); return; }
    if (request.url === '/pixel.png') { response.writeHead(200, { 'content-type': 'image/png' }); response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pN8AAAAASUVORK5CYII=', 'base64')); return; }
    response.writeHead(404, { 'content-type': 'text/plain' }); response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-real-browser-'));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const report = await runWebsiteJourney({
      filePath: {
        schemaVersion: 1,
        name: `Real ${engine} semantic regression`,
        mocks: [{ method: 'GET', path: '/api/profile', status: 200, body: { name: 'QA fixture' } }],
        steps: [
          { type: 'assertVisible', target: { role: 'heading', name: 'Profile' } },
          { type: 'click', target: { role: 'button', name: 'Load profile' } },
          { type: 'assertText', target: { testId: 'result' }, expectedText: 'Profile loaded: QA fixture' },
          { type: 'assertAccessible' },
          { type: 'assertKeyboard' },
          { type: 'screenshot', name: 'profile-loaded' }
        ]
      },
      url: baseUrl,
      projectRoot: process.cwd(),
      browserEngine: engine,
      confirm: true,
      playwrightModule: playwright.default || playwright,
      outputDir: path.join(temp, 'evidence')
    });
    assert.equal(report.runner, `playwright-${engine}`);
    assert.equal(report.executionKind, 'simulated-browser-semantic-journey');
    assert.equal(report.realDeviceTested, false);
    assert.equal(report.journeyPassClaim, true, JSON.stringify(report.results));
    assert.equal(report.summary.mockedResponses, 1);
    assert.equal(report.summary.failed, 0);
    assert.ok(report.finalScreenshot);
    assert.ok((await fs.stat(report.finalScreenshot)).size > 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
