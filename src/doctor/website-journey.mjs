import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { CONFIG_DIR } from '../lib/paths.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';
import { validateWebsiteUrl } from './website-lab.mjs';
import { createTraceparent, validateTraceId } from './trace-context.mjs';
import { recordLabRun } from './lab-history.mjs';

const MAX_BYTES = 128 * 1024;
const MAX_STEPS = 80;
const ENV_KEY = /^PAXI_TEST_[A-Z0-9_]{1,120}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/;
const ALLOWED_ROLES = new Set(['button', 'link', 'heading', 'textbox', 'checkbox', 'radio', 'combobox', 'option', 'tab', 'menuitem', 'navigation', 'main', 'dialog', 'alert', 'img', 'generic']);
const ALLOWED_KEYS = new Set(['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Control+A', 'Meta+A', 'Backspace', 'Delete', 'Space']);
const SAFE_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeText = (value, limit = 600) => redactSensitiveText(String(value ?? '').slice(0, limit)).text;

export function validateWebsiteJourney(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition) || definition.schemaVersion !== 1) throw new Error('Website journey must be a JSON object with schemaVersion: 1.');
  const name = typeof definition.name === 'string' ? definition.name.trim() : 'PAXI website journey';
  if (!name || name.length > 100 || /[\r\n\0]/.test(name)) throw new Error('Journey name must be 1–100 characters without control characters.');
  if (!Array.isArray(definition.steps) || !definition.steps.length || definition.steps.length > MAX_STEPS) throw new Error(`Website journey must contain between 1 and ${MAX_STEPS} steps.`);
  if (Object.keys(definition).some((key) => !['schemaVersion', 'name', 'description', 'steps', 'mocks'].includes(key))) throw new Error('Website journey contains unsupported top-level fields.');
  const mocks = validateJourneyMocks(definition.mocks || []);
  const normalized = definition.steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || typeof step.type !== 'string') throw new Error(`Step ${index + 1} is invalid.`);
    const type = step.type;
    const allowedFields = {
      goto: ['type', 'path'], click: ['type', 'target'], fill: ['type', 'target', 'valueEnv'], selectOption: ['type', 'target', 'valueEnv'],
      check: ['type', 'target'], uncheck: ['type', 'target'], press: ['type', 'target', 'key'], assertVisible: ['type', 'target'],
      assertHidden: ['type', 'target'], assertText: ['type', 'target', 'expectedText'], assertUrl: ['type', 'path'], screenshot: ['type', 'name'], wait: ['type', 'ms'], assertAccessible: ['type'], assertKeyboard: ['type']
    };
    if (!allowedFields[type]) throw new Error(`Step ${index + 1} uses unsupported action '${type}'.`);
    if (Object.keys(step).some((key) => !allowedFields[type].includes(key))) throw new Error(`Step ${index + 1} contains unsupported fields.`);
    const item = { type };
    if (type === 'goto' || type === 'assertUrl') {
      if (typeof step.path !== 'string' || !step.path.startsWith('/') || step.path.startsWith('//') || step.path.length > 512 || /[?#\\\u0000-\u001f]/.test(step.path)) throw new Error(`Step ${index + 1} requires a same-origin path beginning with one slash and no query, fragment or backslash.`);
      let decoded; try { decoded = decodeURIComponent(step.path); } catch { throw new Error(`Step ${index + 1} path has invalid percent encoding.`); }
      if (decoded.split('/').some((part) => part === '.' || part === '..')) throw new Error(`Step ${index + 1} path cannot contain dot segments.`);
      item.path = step.path;
    }
    if (['click', 'fill', 'selectOption', 'check', 'uncheck', 'press', 'assertVisible', 'assertHidden', 'assertText'].includes(type)) item.target = validateTarget(step.target, index + 1);
    if (type === 'fill' || type === 'selectOption') {
      if (typeof step.valueEnv !== 'string' || !ENV_KEY.test(step.valueEnv)) throw new Error(`Step ${index + 1} ${type} must read its value from a PAXI_TEST_ environment variable.`);
      item.valueEnv = step.valueEnv;
    }
    if (type === 'press') {
      if (!ALLOWED_KEYS.has(step.key)) throw new Error(`Step ${index + 1} key is not supported. Allowed: ${[...ALLOWED_KEYS].join(', ')}.`);
      item.key = step.key;
    }
    if (type === 'assertText') {
      if (typeof step.expectedText !== 'string' || !step.expectedText.trim() || step.expectedText.length > 500 || /[\u0000]/.test(step.expectedText)) throw new Error(`Step ${index + 1} assertText requires expectedText between 1 and 500 characters.`);
      item.expectedText = step.expectedText;
    }
    if (type === 'screenshot') {
      if (typeof step.name !== 'string' || !NAME.test(step.name)) throw new Error(`Step ${index + 1} screenshot name must use letters, digits, dot, underscore or hyphen (max 48 characters).`);
      item.name = step.name;
    }
    if (type === 'wait') {
      if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 10000) throw new Error(`Step ${index + 1} wait must be between 0 and 10000 ms.`);
      item.ms = step.ms;
    }
    return item;
  });
  return { schemaVersion: 1, name, description: safeText(definition.description || '', 500), steps: normalized, mocks };
}

function validateJourneyMocks(mocks) {
  if (!Array.isArray(mocks) || mocks.length > 30) throw new Error('Website journey mocks must be an array with at most 30 entries.');
  return mocks.map((mock, index) => {
    if (!mock || typeof mock !== 'object' || Array.isArray(mock) || Object.keys(mock).some((key) => !['method','path','status','body'].includes(key))) throw new Error(`Mock ${index + 1} contains unsupported fields.`);
    const method = String(mock.method || 'GET').toUpperCase();
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error(`Mock ${index + 1} method is not supported.`);
    if (typeof mock.path !== 'string' || !mock.path.startsWith('/') || mock.path.startsWith('//') || mock.path.length > 512 || /[?#\\\u0000-\u001f]/.test(mock.path)) throw new Error(`Mock ${index + 1} requires a same-origin absolute path without query or fragment.`);
    let decoded; try { decoded = decodeURIComponent(mock.path); } catch { throw new Error(`Mock ${index + 1} path has invalid encoding.`); }
    if (decoded.split('/').some((part) => part === '.' || part === '..')) throw new Error(`Mock ${index + 1} path cannot contain dot segments.`);
    if (!Number.isInteger(mock.status) || mock.status < 200 || mock.status > 599) throw new Error(`Mock ${index + 1} status must be between 200 and 599.`);
    if (!mock.body || typeof mock.body !== 'object' || Array.isArray(mock.body)) throw new Error(`Mock ${index + 1} body must be a JSON object.`);
    const body = JSON.stringify(mock.body);
    if (Buffer.byteLength(body) > 16384) throw new Error(`Mock ${index + 1} body exceeds 16 KiB.`);
    return { method, path: mock.path, status: mock.status, body: JSON.parse(body) };
  });
}

function validateAllowedApiOrigins(values, base) {
  if (!Array.isArray(values) || values.length > 20) throw new Error('At most 20 --allow-api-origin values may be supplied.');
  const allowed = new Set([base.origin]);
  for (const value of values) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error(`Invalid API origin '${String(value).slice(0, 100)}'.`); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw new Error('Allowed API origins must be origin-only HTTP(S) URLs without credentials, paths, query strings or fragments.');
    const local = SAFE_ORIGIN_HOSTS.has(parsed.hostname);
    if (!local && parsed.protocol !== 'https:') throw new Error('Non-loopback API origins must use HTTPS.');
    allowed.add(parsed.origin);
  }
  return allowed;
}

async function loadStorageState(storageStatePath, projectRoot, base, allowedOrigins) {
  if (!storageStatePath) return null;
  const absolute = path.resolve(storageStatePath);
  const relative = path.relative(path.resolve(projectRoot), absolute);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Storage-state files must live outside the project tree so credentials are not committed with source code.');
  }
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const part = await fs.lstat(current).catch(() => null);
    if (part?.isSymbolicLink()) throw new Error('Storage-state path cannot traverse symbolic links.');
  }
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 5 * 1024 * 1024) throw new Error('Storage-state must be a regular non-symlink file no larger than 5 MiB.');
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('Storage-state file permissions must be private (0600 or stricter). Run chmod 600 on the file.');
  let state;
  try { state = JSON.parse(await fs.readFile(absolute, 'utf8')); } catch { throw new Error('Storage-state file must contain valid Playwright storage-state JSON.'); }
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error('Storage-state must contain cookies and origins arrays.');
  const hosts = new Set([...allowedOrigins].map((origin) => new URL(origin).hostname.toLowerCase()));
  for (const cookie of state.cookies) {
    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (!domain || !hosts.has(domain)) throw new Error('Storage-state contains a cookie for a host that is not the target or an explicitly allowed API origin.');
  }
  for (const origin of state.origins) {
    let parsedOrigin;
    try { parsedOrigin = new URL(origin.origin); } catch { throw new Error('Storage-state contains an invalid origin.'); }
    if (!allowedOrigins.has(parsedOrigin.origin)) throw new Error('Storage-state contains local storage for an origin that is not explicitly allowed.');
    if (!Array.isArray(origin.localStorage)) throw new Error('Storage-state localStorage entries are invalid.');
  }
  return state;
}

async function validateStorageStateOutputPath(storageStateOutputPath, projectRoot) {
  if (!storageStateOutputPath) return null;
  const absolute = path.resolve(storageStateOutputPath);
  const relative = path.relative(path.resolve(projectRoot), absolute);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Saved storage-state files must be outside the project tree so credentials are not committed with source code.');
  }
  const parsed = path.parse(path.dirname(absolute));
  let current = parsed.root;
  for (const segment of path.dirname(absolute).slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await fs.lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error('Storage-state output directory cannot traverse symbolic links.');
  }
  await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const parent = await fs.lstat(path.dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Storage-state output parent must be a real directory.');
  const existing = await fs.lstat(absolute).catch(() => null);
  if (existing) throw new Error('Storage-state output already exists; refusing to overwrite session credentials.');
  return absolute;
}

async function writePrivateStorageState(outputPath, projectRoot, base, allowedOrigins, state) {
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error('Browser runtime returned invalid storage-state structure.');
  const hosts = new Set([...allowedOrigins].map((origin) => new URL(origin).hostname.toLowerCase()));
  for (const cookie of state.cookies) {
    if (!hosts.has(String(cookie.domain || '').replace(/^\./, '').toLowerCase())) throw new Error('Browser storage-state contains cookies outside the target/allowed API hosts; state was not saved.');
  }
  for (const origin of state.origins) {
    let parsed;
    try { parsed = new URL(origin.origin); } catch { throw new Error('Browser storage-state contains an invalid origin; state was not saved.'); }
    if (!allowedOrigins.has(parsed.origin)) throw new Error('Browser storage-state contains an origin not explicitly allowed; state was not saved.');
  }
  const target = await validateStorageStateOutputPath(outputPath, projectRoot);
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized) > 5 * 1024 * 1024) throw new Error('Browser storage-state exceeds the 5 MiB limit.');
  await fs.writeFile(target, `${serialized}\n`, { flag: 'wx', mode: 0o600 });
  if (process.platform !== 'win32') await fs.chmod(target, 0o600);
  return true;
}

async function basicAccessibilityAudit(page) {
  const issues = [];
  const missingAlt = await page.locator('img:not([alt])').count().catch(() => 0);
  if (missingAlt) issues.push({ code: 'image-missing-alt', count: Math.min(missingAlt, 500), severity: 'warning' });
  const controls = page.locator('button, [role="button"], input:not([type="hidden"]), select, textarea');
  const total = Math.min(await controls.count().catch(() => 0), 500);
  let unnamed = 0;
  for (let index = 0; index < total; index += 1) {
    const item = controls.nth(index);
    const [aria, labelledBy, title, placeholder, text, id] = await Promise.all([
      item.getAttribute('aria-label').catch(() => null), item.getAttribute('aria-labelledby').catch(() => null),
      item.getAttribute('title').catch(() => null), item.getAttribute('placeholder').catch(() => null),
      item.innerText().catch(() => ''), item.getAttribute('id').catch(() => null)
    ]);
    let associated = false;
    if (id) associated = await page.locator('label[for]').evaluateAll((labels, wanted) => labels.some((label) => label.getAttribute('for') === wanted), id).catch(() => false);
    if (!(aria || labelledBy || title || placeholder || String(text).trim() || associated)) unnamed += 1;
  }
  if (unnamed) issues.push({ code: 'control-missing-accessible-name', count: unnamed, severity: 'warning' });
  return { scannedControls: total, truncated: (await controls.count().catch(() => 0)) > 500, issues,
    note: 'Heuristic accessibility checks only; this is not a WCAG conformance audit and does not calculate color contrast.' };
}

function validateTarget(target, stepIndex) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error(`Step ${stepIndex} requires a semantic locator target.`);
  const keys = ['role', 'label', 'text', 'testId', 'placeholder'];
  const selected = keys.filter((key) => typeof target[key] === 'string' && target[key].trim());
  if (selected.length !== 1 || Object.keys(target).some((key) => ![...keys, 'name', 'exact'].includes(key))) throw new Error(`Step ${stepIndex} target must use exactly one of role, label, text, testId or placeholder; arbitrary CSS/XPath is not supported.`);
  const key = selected[0];
  const value = target[key].trim();
  if (value.length > 200 || /[\r\n\0]/.test(value)) throw new Error(`Step ${stepIndex} locator value must be at most 200 characters without control characters.`);
  if (key === 'role') {
    if (!ALLOWED_ROLES.has(value)) throw new Error(`Step ${stepIndex} locator role is not supported.`);
    if (typeof target.name !== 'string' || !target.name.trim() || target.name.length > 200) throw new Error(`Step ${stepIndex} role locator requires a name.`);
  } else if (target.name !== undefined) throw new Error(`Step ${stepIndex} name is valid only with role locators.`);
  if (target.exact !== undefined && typeof target.exact !== 'boolean') throw new Error(`Step ${stepIndex} exact must be a boolean.`);
  return { [key]: value, ...(key === 'role' ? { name: target.name.trim() } : {}), ...(target.exact === undefined ? {} : { exact: target.exact }) };
}

export async function loadWebsiteJourney(filePath) {
  const absolute = path.resolve(filePath);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_BYTES) throw new Error(`Website journey must be a regular non-symlink JSON file between 2 bytes and ${MAX_BYTES} bytes.`);
  const raw = await fs.readFile(absolute);
  if (raw.includes(0)) throw new Error('Website journey must be UTF-8 JSON.');
  try { return validateWebsiteJourney(JSON.parse(raw.toString('utf8'))); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('Website journey is not valid JSON.'); throw error; }
}

function resolveLocator(page, target) {
  if (target.role) return page.getByRole(target.role, { name: target.name, exact: target.exact ?? true });
  if (target.label) return page.getByLabel(target.label, { exact: target.exact ?? true });
  if (target.text) return page.getByText(target.text, { exact: target.exact ?? true });
  if (target.testId) return page.getByTestId(target.testId);
  return page.getByPlaceholder(target.placeholder, { exact: target.exact ?? true });
}

function locatorDescription(target) {
  if (target.role) return `role=${target.role}`;
  if (target.label) return 'label locator';
  if (target.text) return 'text locator';
  if (target.testId) return 'test-id locator';
  return 'placeholder locator';
}

async function resolvePlaywright(projectRoot) {
  const require = createRequire(path.join(path.resolve(projectRoot), 'package.json'));
  for (const name of ['playwright', 'playwright-core']) {
    try { const resolved = require.resolve(name); const loaded = await import(pathToFileURL(resolved).href); return loaded.default || loaded; } catch {}
  }
  throw new Error('Playwright is not installed. Install it in this project deliberately with `npm install --save-dev playwright`, then install the selected browser. PAXI will not install browser packages automatically.');
}

async function makeReportDirectory(directory) {
  const resolved = path.resolve(directory || path.join(CONFIG_DIR, 'doctor-reports', 'website-journeys', randomUUID()));
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await fs.lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error('Website journey evidence path cannot traverse symbolic links.');
    if (info && current !== resolved && !info.isDirectory()) throw new Error('Website journey evidence path contains a non-directory component.');
  }
  await fs.mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || (await fs.readdir(resolved)).length) throw new Error('Website journey evidence directory must be a new, empty, non-symlink directory.');
  return resolved;
}

function browserEnvironment() {
  // Do not leak arbitrary shell credentials or PAXI_TEST_* values into the browser process.
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'LC_CTYPE', 'DISPLAY', 'XDG_RUNTIME_DIR', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH'];
  return Object.fromEntries(allowed.filter((name) => typeof process.env[name] === 'string').map((name) => [name, process.env[name]]));
}

export async function runWebsiteJourney({ filePath, url, projectRoot = process.cwd(), browserEngine = 'chromium', outputDir = null, timeoutMs = 10000, traceId = null, storageStatePath = null, saveStorageStatePath = null, allowedApiOrigins = [], confirm = false, allowRemote = false, playwrightModule = null, now = () => new Date() } = {}) {
  if (!confirm) throw new Error('Website journeys can click controls and enter test data. Review the journey and pass --confirm before execution.');
  const definition = typeof filePath === 'string' ? await loadWebsiteJourney(filePath) : validateWebsiteJourney(filePath);
  const base = validateWebsiteUrl(url);
  if (base.search || base.hash) throw new Error('Website journey base URL must not contain query strings or fragments. Supply test inputs through PAXI_TEST_ environment variables.');
  const local = SAFE_ORIGIN_HOSTS.has(base.hostname);
  if (!local && (!allowRemote || base.protocol !== 'https:')) throw new Error('Remote website journey execution requires an HTTPS target and explicit --allow-remote. Prefer a local or staging test environment.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('Website journey timeout must be between 1000 and 60000 milliseconds.');
  if (!['chromium', 'firefox', 'webkit'].includes(browserEngine)) throw new Error('Browser engine must be chromium, firefox or webkit.');
  const trace = traceId ? validateTraceId(traceId) : null;
  for (const step of definition.steps) if (['fill', 'selectOption'].includes(step.type)) {
    const value = process.env[step.valueEnv];
    if (typeof value !== 'string') throw new Error(`Required test variable ${step.valueEnv} is not set.`);
    if (Buffer.byteLength(value, 'utf8') > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${step.valueEnv} must be at most 4096 bytes and contain no control characters.`);
  }
  const allowedOrigins = validateAllowedApiOrigins(allowedApiOrigins, base);
  const storageState = await loadStorageState(storageStatePath, projectRoot, base, allowedOrigins);
  const storageStateOutput = await validateStorageStateOutputPath(saveStorageStatePath, projectRoot);
  const playwright = playwrightModule || await resolvePlaywright(projectRoot);
  const engine = playwright[browserEngine];
  if (!engine?.launch) throw new Error(`Installed Playwright package does not expose browser engine '${browserEngine}'.`);
  const reportDir = await makeReportDirectory(outputDir);
  const runId = randomUUID();
  const startedAt = now().toISOString();
  const browser = await engine.launch({ headless: true, env: browserEnvironment() });
  const results = [];
  const runtimeIssues = [];
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const httpErrors = [];
  const blockedNavigations = [];
  const blockedExternalRequests = [];
  const mockHits = [];
  let sessionStateSaved = false;
  let sessionStateSaveStatus = storageStateOutput ? 'not-saved' : 'not-requested';
  let context;
  let page;
  try {
    context = await browser.newContext({ ignoreHTTPSErrors: false, serviceWorkers: 'block', ...(storageState ? { storageState } : {}) });
    await context.route('**/*', async (route) => {
      const request = route.request();
      let requestUrl;
      try { requestUrl = new URL(request.url()); } catch { return route.abort('blockedbyclient'); }
      if (requestUrl.origin !== base.origin) {
        if (request.isNavigationRequest?.()) {
          blockedNavigations.push({ url: safeUrl(request.url()), type: request.resourceType() });
          return route.abort('blockedbyclient');
        }
        if (['fetch', 'xhr'].includes(request.resourceType()) && !allowedOrigins.has(requestUrl.origin)) {
          blockedExternalRequests.push({ url: safeUrl(request.url()), type: request.resourceType(), method: request.method() });
          return route.abort('blockedbyclient');
        }
        if (['websocket', 'script'].includes(request.resourceType())) {
          blockedExternalRequests.push({ url: safeUrl(request.url()), type: request.resourceType(), method: request.method() });
          return route.abort('blockedbyclient');
        }
      }
      const matchingMock = requestUrl.origin === base.origin && ['fetch', 'xhr'].includes(request.resourceType())
        ? definition.mocks.find((item) => item.method === request.method().toUpperCase() && item.path === requestUrl.pathname)
        : null;
      if (matchingMock) {
        mockHits.push({ method: matchingMock.method, path: matchingMock.path, status: matchingMock.status });
        return route.fulfill({ status: matchingMock.status, contentType: 'application/json', body: JSON.stringify(matchingMock.body) });
      }
      if (trace && ['fetch', 'xhr'].includes(request.resourceType())) return route.continue({ headers: { ...request.headers(), traceparent: createTraceparent(trace) } });
      return route.continue();
    });
    page = await context.newPage();
    context.on('page', (popup) => {
      runtimeIssues.push({ code: 'unexpected-popup', severity: 'warning', message: 'The journey opened a popup window; it was closed to keep the test within its original tab.' });
      void popup.close().catch(() => {});
    });
    page.setDefaultTimeout(timeoutMs);
    page.on('pageerror', (error) => pageErrors.push(safeText(error.message || error)));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(safeText(message.text())); });
    page.on('requestfailed', (request) => failedRequests.push({ url: safeUrl(request.url()), error: safeText(request.failure()?.errorText || 'request failed') }));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        const request = response.request();
        httpErrors.push({ url: safeUrl(response.url()), method: request.method(), status: response.status(), resourceType: request.resourceType() });
      }
    });
    const initial = await page.goto(base.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (new URL(page.url()).origin !== base.origin) throw new Error('Initial website navigation left the specified target origin.');
    const initialStatus = initial?.status?.() ?? null;
    if (initialStatus >= 500) runtimeIssues.push({ code: 'initial-http-server-error', severity: 'error', message: `Initial page returned HTTP ${initialStatus}.` });

    for (const [index, step] of definition.steps.entries()) {
      const started = Date.now();
      const record = { id: `step-${index + 1}-${step.type}`, index: index + 1, type: step.type, status: 'passed' };
      try {
        if (step.type === 'goto') {
          const target = new URL(step.path, base);
          if (target.origin !== base.origin) throw new Error('Navigation path resolved outside the original target origin.');
          const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
          record.statusCode = response?.status?.() ?? null;
          record.path = target.pathname;
          if (record.statusCode >= 500) throw new Error(`Navigation returned HTTP ${record.statusCode}.`);
        } else if (step.type === 'wait') await delay(step.ms);
        else if (step.type === 'screenshot') {
          const screenshotPath = path.join(reportDir, `${String(index + 1).padStart(3, '0')}-${step.name}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
          const info = await fs.stat(screenshotPath);
          if (info.size > 25 * 1024 * 1024) { await fs.unlink(screenshotPath); throw new Error('Screenshot exceeded 25 MiB and was removed.'); }
          record.screenshot = screenshotPath;
        } else if (step.type === 'assertUrl') {
          const current = new URL(page.url());
          record.path = current.pathname;
          if (current.origin !== base.origin || current.pathname !== step.path) throw new Error(`Expected path ${step.path}; observed ${current.pathname}.`);
          record.assertion = 'url-equals';
        } else if (step.type === 'assertAccessible') {
          const audit = await basicAccessibilityAudit(page);
          record.accessibility = audit;
          record.assertion = 'basic-accessibility-heuristics';
          if (audit.issues.length) throw new Error(`Accessibility heuristic found ${audit.issues.reduce((sum, item) => sum + item.count, 0)} issue(s). Review the attached audit details.`);
        } else if (step.type === 'assertKeyboard') {
          await page.keyboard.press('Tab');
          const focused = await page.locator(':focus').count().catch(() => 0);
          if (focused !== 1) throw new Error('Tab key did not produce a single focused element.');
          record.assertion = 'tab-focus-received';
        } else {
          const locator = resolveLocator(page, step.target);
          record.target = locatorDescription(step.target);
          if (step.type === 'click') await locator.click();
          else if (step.type === 'fill') { await locator.fill(process.env[step.valueEnv]); record.input = { variable: step.valueEnv, characters: [...process.env[step.valueEnv]].length, valueRecorded: false }; }
          else if (step.type === 'selectOption') { await locator.selectOption(process.env[step.valueEnv]); record.input = { variable: step.valueEnv, valueRecorded: false }; }
          else if (step.type === 'check') await locator.check();
          else if (step.type === 'uncheck') await locator.uncheck();
          else if (step.type === 'press') await locator.press(step.key);
          else if (step.type === 'assertVisible') { await locator.waitFor({ state: 'visible', timeout: timeoutMs }); record.assertion = 'visible'; }
          else if (step.type === 'assertHidden') { await locator.waitFor({ state: 'hidden', timeout: timeoutMs }); record.assertion = 'hidden'; }
          else if (step.type === 'assertText') {
            await locator.waitFor({ state: 'visible', timeout: timeoutMs });
            const assertionDeadline = Date.now() + timeoutMs;
            let matches = false;
            while (Date.now() <= assertionDeadline) {
              const text = await locator.innerText();
              if (String(text).includes(step.expectedText)) { matches = true; break; }
              await delay(Math.min(100, Math.max(1, assertionDeadline - Date.now())));
            }
            if (!matches) throw new Error('Visible text did not contain the expected assertion text.');
            record.assertion = 'text-contains';
          }
          if (['click', 'press', 'check', 'uncheck'].includes(step.type)) await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeoutMs, 2000) }).catch(() => {});
        }
        const after = new URL(page.url());
        if (after.origin !== base.origin) throw new Error('The interaction navigated outside the original target origin. The journey stopped.');
        if (blockedNavigations.length) throw new Error('A cross-origin top-level navigation was blocked. Review the link and keep the journey same-origin.');
      } catch (error) {
        record.status = 'failed';
        record.error = safeText(error instanceof Error ? error.message : String(error));
      }
      record.durationMs = Date.now() - started;
      results.push(record);
      if (record.status === 'failed') break;
    }
    if (pageErrors.length) runtimeIssues.push({ code: 'browser-runtime-error', severity: 'error', count: pageErrors.length, messages: pageErrors.slice(0, 10) });
    if (consoleErrors.length) runtimeIssues.push({ code: 'browser-console-errors', severity: 'warning', count: consoleErrors.length, messages: consoleErrors.slice(0, 10) });
    if (failedRequests.length) runtimeIssues.push({ code: 'network-request-failed', severity: 'warning', count: failedRequests.length, requests: failedRequests.slice(0, 20) });
    if (blockedExternalRequests.length) runtimeIssues.push({ code: 'cross-origin-request-blocked', severity: 'warning', count: blockedExternalRequests.length, requests: blockedExternalRequests.slice(0, 20), note: 'Add an explicit --allow-api-origin only for trusted staging API origins.' });
    if (httpErrors.length) runtimeIssues.push({ code: 'http-errors', severity: httpErrors.some((item) => item.status >= 500) ? 'error' : 'warning', count: httpErrors.length, responses: httpErrors.slice(0, 30) });
    const endingScreenshot = path.join(reportDir, 'final.png');
    await page.screenshot({ path: endingScreenshot, fullPage: true, animations: 'disabled' }).catch(() => {});
    if (storageStateOutput) {
      const hasFailedSteps = results.some((item) => item.status === 'failed') || results.length !== definition.steps.length;
      if (hasFailedSteps) sessionStateSaveStatus = 'skipped-failed-journey';
      else {
        try {
          if (typeof context.storageState !== 'function') throw new Error('Installed Playwright runtime does not expose storageState().');
          const state = await context.storageState();
          await writePrivateStorageState(storageStateOutput, projectRoot, base, allowedOrigins, state);
          sessionStateSaved = true;
          sessionStateSaveStatus = 'saved-private-file';
        } catch (error) {
          sessionStateSaveStatus = 'save-failed';
          runtimeIssues.push({ code: 'storage-state-save-failed', severity: 'warning', message: safeText(error?.message || error, 240) });
        }
      }
    }
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  const totalAssertions = definition.steps.filter((step) => step.type.startsWith('assert')).length;
  const failed = results.filter((item) => item.status === 'failed').length;
  const report = {
    schemaVersion: 1, reportType: 'paxi-semantic-website-journey', runId, name: definition.name,
    startedAt, completedAt: now().toISOString(), targetUrl: safeUrl(base.href), origin: base.origin,
    runner: `playwright-${browserEngine}`, executionKind: 'simulated-browser-semantic-journey', realDeviceTested: false,
    traceContext: { enabled: Boolean(trace), traceId: trace, header: trace ? 'traceparent' : null, note: trace ? 'Injected only into browser XHR/fetch requests. Configure CORS and server propagation.' : 'Disabled.' },
    summary: { total: definition.steps.length, executed: results.length, passed: results.filter((item) => item.status === 'passed').length, failed, assertions: results.filter((item) => item.assertion).length, expectedAssertions: totalAssertions, issues: runtimeIssues.length, mockedResponses: mockHits.length },
    status: failed || runtimeIssues.some((item) => item.severity === 'error') ? 'failed' : blockedExternalRequests.length ? 'incomplete' : results.length === definition.steps.length ? 'completed' : 'incomplete',
    journeyPassClaim: totalAssertions > 0 && failed === 0 && results.length === definition.steps.length && results.filter((item) => item.assertion).length >= totalAssertions && !blockedExternalRequests.length && !runtimeIssues.some((item) => item.severity === 'error'),
    results, issues: runtimeIssues, mockHits, allowedApiOrigins: [...allowedOrigins].filter((origin) => origin !== base.origin), blockedExternalRequests: blockedExternalRequests.slice(0, 30), sessionStateUsed: Boolean(storageState), sessionStateExported: sessionStateSaved, sessionStateExportStatus: sessionStateSaveStatus, httpErrors: httpErrors.slice(0, 30), failedRequests: failedRequests.slice(0, 20), blockedNavigations: blockedNavigations.slice(0, 10),
    reportDirectory: reportDir,
    finalScreenshot: await fs.stat(path.join(reportDir, 'final.png')).then(() => path.join(reportDir, 'final.png')).catch(() => null),
    limitations: ['Browser execution is a simulation, not physical Android/iOS testing.', 'Only semantic Playwright locators are supported for user interactions; arbitrary CSS/XPath actions are not accepted. Built-in heuristic accessibility checks use fixed selectors.',
      'Storage-state is loaded only from a private file outside the project tree, restricted to the exact target host/origin, and never included in evidence. Exported session data is written only after every journey step passes to a new private file outside the project tree.',
      'Network mocks are fixed JSON responses for exact same-origin fetch/XHR method/path pairs; they do not execute user code.',
      'Cross-origin navigation is always blocked. Cross-origin fetch/XHR is blocked unless its origin is explicitly allowlisted; external scripts and websockets remain blocked. Static cross-origin images, styles and fonts may still load.',
      'Basic accessibility checks are heuristics, not WCAG conformance or color-contrast certification.', 'Form values come from PAXI_TEST_ environment variables and are never written to the report.', 'Only same-origin navigation is allowed; external links and popups are blocked from the journey.', 'A passing journey proves only the assertions listed in that journey, not complete application correctness.']
  };
  report.reportPath = path.join(reportDir, 'report.json');
  await fs.writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  report.archivePath = await recordLabRun(report, { reportKind: 'semantic-website-journey' });
  return report;
}

export async function runWebsiteJourneyMatrix({ filePath, url, browsers = ['chromium', 'firefox', 'webkit'], projectRoot = process.cwd(), outputDir = null, traceId = null, storageStatePath = null, allowedApiOrigins = [], confirm = false, allowRemote = false, playwrightModule = null } = {}) {
  if (!confirm) throw new Error('Multi-engine website journeys execute browser actions. Pass --confirm after reviewing the journey.');
  const engines = [...new Set(browsers)];
  if (!engines.length || engines.some((item) => !['chromium','firefox','webkit'].includes(item))) throw new Error('Browser matrix accepts chromium, firefox and webkit.');
  const root = await makeReportDirectory(outputDir || path.join(CONFIG_DIR, 'doctor-reports', 'website-matrix', randomUUID()));
  const results = [];
  for (const engine of engines) {
    try {
      const report = await runWebsiteJourney({ filePath, url, projectRoot, browserEngine: engine, outputDir: path.join(root, engine), traceId, storageStatePath, allowedApiOrigins, confirm, allowRemote, playwrightModule });
      results.push({ engine, status: report.journeyPassClaim ? 'passed' : report.status, executionKind: report.executionKind, reportPath: report.reportPath, runId: report.runId, summary: report.summary });
    } catch (error) {
      results.push({ engine, status: /browser|executable|launch/i.test(String(error?.message)) ? 'engine-unavailable' : 'failed-to-start', error: safeText(error?.message || error) });
    }
  }
  const complete = results.every((item) => ['passed','failed','completed','incomplete'].includes(item.status));
  const report = {
    schemaVersion: 1, reportType: 'paxi-website-browser-matrix', executionKind: 'multi-engine-simulated-browser-matrix',
    generatedAt: new Date().toISOString(), targetUrl: safeUrl(url), browsers: engines,
    summary: { requested: engines.length, ran: results.filter((item) => item.runId).length, passed: results.filter((item) => item.status === 'passed').length, failed: results.filter((item) => ['failed','failed-to-start'].includes(item.status)).length, unavailable: results.filter((item) => item.status === 'engine-unavailable').length },
    status: complete && results.every((item) => item.status === 'passed') ? 'passed' : complete ? 'failed-or-incomplete' : 'partial', results,
    reportDirectory: root,
    limitations: ['Each engine is reported independently. Missing browser binaries are unavailable, not passed.', 'All runs are desktop/headless browser simulations, not physical Android/iOS certification.', 'Storage-state, if used, is read from an external private file and is not copied into the report.']
  };
  report.reportPath = path.join(root, 'matrix.json');
  await fs.writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

function safeUrl(value) {
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return '[invalid-url]'; }
}

export function websiteJourneyExample() {
  return {
    schemaVersion: 1,
    name: 'Sign-in form smoke journey',
    description: 'Example only. Use a dedicated test account and a local/staging site.',
    steps: [
      { type: 'assertVisible', target: { role: 'heading', name: 'Sign in' } },
      { type: 'fill', target: { label: 'Email address' }, valueEnv: 'PAXI_TEST_EMAIL' },
      { type: 'fill', target: { label: 'Password' }, valueEnv: 'PAXI_TEST_PASSWORD' },
      { type: 'click', target: { role: 'button', name: 'Continue' } },
      { type: 'assertVisible', target: { role: 'heading', name: 'Dashboard' } },
      { type: 'assertUrl', path: '/dashboard' },
      { type: 'assertAccessible' },
      { type: 'assertKeyboard' },
      { type: 'screenshot', name: 'dashboard' }
    ],
    mocks: [
      { method: 'GET', path: '/api/profile', status: 200, body: { id: 'paxi-test-user', displayName: 'Test User' } }
    ]
  };
}
