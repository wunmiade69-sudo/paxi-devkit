import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_PLAN_BYTES = 128 * 1024;
const VALID_TARGETS = new Set(['api', 'website', 'android']);

async function readObject(filePath, maxBytes, label) {
  const absolute = path.resolve(filePath);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file.`);
  if (info.size > maxBytes) throw new Error(`${label} exceeds its ${maxBytes}-byte limit.`);
  const raw = await fs.readFile(absolute, 'utf8');
  if (raw.includes('\0')) throw new Error(`${label} must contain UTF-8 JSON.`);
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`${label} is not valid JSON.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return { absolute, value };
}

function normalizeRoute(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 512 || /[?#\\\u0000-\u001f]/.test(value)) return null;
  let decoded; try { decoded = decodeURIComponent(value); } catch { return null; }
  const parts = decoded.replace(/\/{2,}/g, '/').replace(/\/$/, '').split('/');
  if (parts.some((item) => item === '.' || item === '..' || item.includes('\\') || item.includes('/'))) return null;
  return parts.map((item) => /^\d{1,18}$/.test(item) ? ':id' : /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(item) ? ':uuid' : item).join('/') || '/';
}

function planRoute(baseUrl, route) {
  const base = new URL(baseUrl);
  const joined = `${base.pathname.replace(/\/$/, '')}/${route.replace(/^\//, '')}`;
  return { host: base.host.toLowerCase(), path: normalizeRoute(joined) };
}

function extractDefectEvents(report) {
  if (report.reportType !== 'paxi-cross-layer-evidence-correlation' || !Array.isArray(report.events)) {
    throw new Error('Regression drafting requires a PAXI cross-layer correlation report produced by `paxi doctor correlate`.');
  }
  return report.events.filter((event) => event && event.status === 'failed' && ['high', 'medium'].includes(event.severity));
}

function selectApiCases(plan, events) {
  if (!plan || plan.schemaVersion !== 1 || !Array.isArray(plan.cases) || plan.cases.length < 1 || plan.cases.length > 25 || typeof plan.baseUrl !== 'string') {
    throw new Error('API regression target requires a reviewed API plan using schemaVersion 1, a baseUrl and 1–25 cases.');
  }
  const base = new URL(plan.baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Reviewed API plan has an invalid baseUrl.');
  const candidates = [];
  for (const event of events.filter((item) => ['api', 'website'].includes(item.sourceType) && typeof item.path === 'string')) {
    const eventPath = normalizeRoute(event.path);
    if (!eventPath) continue;
    for (const item of plan.cases) {
      const method = String(item.method || 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method) || typeof item.path !== 'string') continue;
      const candidate = planRoute(plan.baseUrl, item.path);
      if (candidate.path !== eventPath) continue;
      if (event.host && candidate.host !== String(event.host).toLowerCase()) continue;
      if (event.method && method !== String(event.method).toUpperCase()) continue;
      candidates.push({ testCase: item, event: {
        eventId: String(event.eventId || '').slice(0, 40), sourceType: event.sourceType, sourceFile: String(event.sourceFile || '').slice(0, 120), sourceId: String(event.sourceId || '').slice(0, 80),
        code: String(event.code || 'observed-failure').slice(0, 100), severity: event.severity,
        traceId: /^[a-f0-9]{32}$/i.test(event.traceId || '') ? event.traceId.toLowerCase() : null,
        summary: String(event.summary || 'Observed failure').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 240)
      } });
    }
  }
  const selected = new Map();
  for (const candidate of candidates) {
    const id = candidate.testCase.id;
    if (!selected.has(id)) selected.set(id, { ...candidate.testCase, defectEvidence: [] });
    const target = selected.get(id);
    if (target.defectEvidence.length < 5) target.defectEvidence.push(candidate.event);
  }
  return [...selected.values()].map(({ defectEvidence, ...item }) => ({ ...item, defectEvidence }));
}

function draftWebsiteRoutes(events) {
  const selected = new Map();
  for (const event of events) {
    if (event.sourceType !== 'website' || !event.host || !event.origin || typeof event.path !== 'string') continue;
    const normalized = normalizeRoute(event.path);
    if (!normalized) continue;
    let origin;
    try { origin = new URL(event.origin); } catch { continue; }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host.toLowerCase() !== String(event.host).toLowerCase() || origin.username || origin.password) continue;
    const key = `${origin.origin}${event.path}`;
    if (!selected.has(key)) selected.set(key, { id: `web-${selected.size + 1}`, path: event.path, origin: origin.origin, profile: event.profile || null, viewport: event.viewport || null, method: 'GET', observedIssueCodes: [], suggestedChecks: [], manualAssertionsRequired: true, evidence: [] });
    const item = selected.get(key);
    if (item.observedIssueCodes.length < 8 && !item.observedIssueCodes.includes(event.code)) item.observedIssueCodes.push(String(event.code || 'observed-website-failure').slice(0, 100));
    const checksByIssue = {
      'horizontal-overflow': 'assertNoHorizontalOverflow',
      'browser-runtime-error': 'assertNoBrowserRuntimeErrors',
      'network-request-failed': 'assertNoFailedSameOriginRequests',
      'website-navigation-failed': 'assertRouteNavigationCompletes',
      'visual-regression': 'requiresApprovedVisualBaseline'
    };
    const suggested = checksByIssue[String(event.code || '')];
    if (suggested && !item.suggestedChecks.includes(suggested)) item.suggestedChecks.push(suggested);
    if (item.evidence.length < 5) item.evidence.push({ eventId: String(event.eventId || '').slice(0, 40), sourceFile: String(event.sourceFile || '').slice(0, 120), sourceId: String(event.sourceId || '').slice(0, 80), code: String(event.code || '').slice(0, 100), summary: String(event.summary || '').slice(0, 240) });
  }
  return [...selected.values()].slice(0, 30);
}

function draftAndroidJourney(events) {
  const androidEvents = events.filter((item) => item.sourceType === 'android-journey' && item.deviceType && item.packageId);
  if (!androidEvents.length) return null;
  const packages = [...new Set(androidEvents.map((item) => item.packageId))].slice(0, 5);
  if (packages.length !== 1) return { readyToRun: false, packages, note: 'Evidence spans multiple Android packages. Create separate journeys per package; PAXI will not combine them into one app session.' };
  const issueCodes = [...new Set(androidEvents.map((item) => item.code))].slice(0, 20);
  return {
    readyToRun: true,
    packageId: packages[0],
    journey: {
      schemaVersion: 1,
      name: 'PAXI-generated Android regression smoke',
      description: 'Starter journey drafted from Android defect evidence. It verifies the app remains foreground and captures a screenshot; add the feature-specific UI assertion before treating this as a reproduction test.',
      steps: [{ type: 'assertForeground' }, { type: 'screenshot', name: 'regression-state' }]
    },
    observedIssueCodes: issueCodes,
    sourceEvidence: androidEvents.slice(0, 10).map((item) => ({ eventId: String(item.eventId || '').slice(0, 40), sourceFile: String(item.sourceFile || '').slice(0, 120), sourceId: String(item.sourceId || '').slice(0, 80), code: String(item.code || '').slice(0, 100) })),
    requiresManualAssertion: true,
    manualReview: ['Inspect the original failed journey and screenshots.', 'Add an assertVisible/assertNotVisible selector that checks the original defect.', 'Use a dedicated test account and confirm the target package before running.', 'A starter foreground assertion does not reproduce or prove correction of the original defect.']
  };
}

async function writeNewJson(outputPath, value, label) {
  if (!outputPath) return null;
  const absolute = path.resolve(outputPath);
  const parent = await fs.lstat(path.dirname(absolute)).catch(() => null);
  if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error(`${label} output directory must already exist and must not be a symlink.`);
  const existing = await fs.lstat(absolute).catch(() => null);
  if (existing) throw new Error(`${label} output already exists. Choose a new path; PAXI never overwrites generated drafts.`);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(absolute, payload, { flag: 'wx', mode: 0o600 });
  return { path: absolute, bytes: Buffer.byteLength(payload, 'utf8') };
}

export async function draftRegressionSuite({ planPath = null, evidencePath, outputPath = null, androidOutputPath = null, targets = ['api'] } = {}) {
  if (!evidencePath) throw new Error('Regression drafting requires --evidence <correlation-report.json>.');
  if (!Array.isArray(targets) || !targets.length || targets.includes('all') && targets.length > 1) throw new Error('Choose targets from api,website,android or all.');
  const selectedTargets = targets.includes('all') ? ['api', 'website', 'android'] : [...new Set(targets)];
  if (selectedTargets.some((target) => !VALID_TARGETS.has(target))) throw new Error('Unknown regression target. Supported: api, website, android, all.');
  const { absolute: evidenceFile, value: evidence } = await readObject(evidencePath, MAX_REPORT_BYTES, 'Cross-layer evidence report');
  const events = extractDefectEvents(evidence);
  let apiCases = [];
  if (selectedTargets.includes('api')) {
    if (!planPath) throw new Error('API regression target requires --plan <reviewed-api-plan.json>.');
    const { value: plan } = await readObject(planPath, MAX_PLAN_BYTES, 'Reviewed API plan');
    apiCases = selectApiCases(plan, events);
  }
  const websiteRoutes = selectedTargets.includes('website') ? draftWebsiteRoutes(events) : [];
  const android = selectedTargets.includes('android') ? draftAndroidJourney(events) : null;
  const selectedCount = apiCases.length + websiteRoutes.length + (android?.readyToRun ? 1 : 0);
  if (!selectedCount) throw new Error('No supported API, website or Android regression drafts matched the supplied evidence. Dynamic routes and selector-specific mobile defects require a reviewed manual test.');
  const suite = {
    schemaVersion: 2,
    reportType: 'paxi-multiplatform-regression-draft',
    name: `Regression checks from ${path.basename(evidenceFile)}`.slice(0, 120),
    targets: selectedTargets,
    cases: apiCases,
    api: selectedTargets.includes('api') ? { cases: apiCases, count: apiCases.length, reviewRequired: true } : null,
    website: selectedTargets.includes('website') ? { routes: websiteRoutes, count: websiteRoutes.length, execution: 'Run `paxi doctor lab run --url <origin> --route <path>` for each same-origin route; route and viewport checks remain browser simulations.', reviewRequired: true } : null,
    android,
    generatedFromDefects: {
      draftId: randomUUID(), evidence: path.basename(evidenceFile), createdAt: new Date().toISOString(),
      counts: { api: apiCases.length, website: websiteRoutes.length, android: android?.readyToRun ? 1 : 0 },
      reviewRequired: true,
      note: 'Generated regression material reuses observed routes/issue codes. It never invents expected business outcomes, selectors, credentials or mutations. Android output is a starter journey and requires a feature-specific assertion before it can reproduce the original defect.'
    }
  };
  const output = await writeNewJson(outputPath, suite, 'Regression');
  const androidOutput = android?.readyToRun ? await writeNewJson(androidOutputPath, android.journey, 'Android journey') : null;
  return { ...suite, output, androidOutput, limitations: [
    'Drafting is local and does not send requests or modify application source code.',
    'API tests reuse only previously reviewed read-only GET/HEAD cases and preserve their existing expected assertions.',
    'Website routes are same-origin GET navigation checks. Browser viewport results are simulations, not Android/iOS device results.',
    'Android journey output is a starter smoke journey with a foreground assertion and screenshot. Add a selector-specific assertion to test the original defect.',
    'Website route drafts include heuristic suggested check names only; they are not executable test assertions until reviewed and implemented in a journey.',
    'Never run generated tests against production or with real customer data. Review the target and generated assertions first.'
  ] };
}
