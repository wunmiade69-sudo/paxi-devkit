import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WEB_VIEWPORTS, validateWebsiteUrl } from './website-lab.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

const safe = (value, limit = 400) => redactSensitiveText(String(value ?? '').slice(0, limit)).text;

export function classifyAccessibilityEvidence({ violations = [], incomplete = [], blockedRequests = [], runtimeErrors = [], httpErrors = [] } = {}) {
  const reviewReasons = [];
  if (violations.length) reviewReasons.push('wcag-violations');
  if (incomplete.length) reviewReasons.push('axe-incomplete-needs-manual-review');
  if (blockedRequests.length) reviewReasons.push('blocked-requests-may-affect-rendering');
  if (runtimeErrors.length) reviewReasons.push('browser-runtime-errors');
  if (httpErrors.length) reviewReasons.push('http-response-errors');
  return { status: reviewReasons.length ? 'review' : 'passed', reviewReasons };
}

function resolvePackage(name, projectRoot) {
  const require = createRequire(path.join(path.resolve(projectRoot), 'package.json'));
  return require.resolve(name);
}

async function resolvePlaywright(projectRoot) {
  const require = createRequire(path.join(path.resolve(projectRoot), 'package.json'));
  for (const name of ['playwright', 'playwright-core']) {
    try {
      const resolved = require.resolve(name);
      const loaded = await import(pathToFileURL(resolved).href);
      return loaded.default || loaded;
    } catch {}
  }
  throw new Error('Playwright is not installed in the selected project. Install it with `npm install --save-dev playwright`, then install the chosen browser with `npx playwright install chromium` (or firefox/webkit).');
}

function resolveAxe(projectRoot) {
  let entry;
  try { entry = resolvePackage('axe-core/axe.min.js', projectRoot); }
  catch {
    try { entry = path.join(path.dirname(resolvePackage('axe-core', projectRoot)), 'axe.min.js'); }
    catch { throw new Error('axe-core is not installed in the selected project. Install it with `npm install --save-dev axe-core` before running the accessibility audit.'); }
  }
  return entry;
}

async function writeReport(filePath, report) {
  const absolute = path.resolve(filePath);
  const existing = await fs.lstat(absolute).catch(() => null);
  if (existing) throw new Error(`Refusing to overwrite existing accessibility report: ${absolute}`);
  await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  await fs.writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return absolute;
}

export async function runWebsiteAccessibilityAudit({
  url,
  projectRoot = process.cwd(),
  profiles = ['standard'],
  browserEngine = 'chromium',
  allowRemote = false,
  confirm = false,
  timeoutMs = 15000,
  outputPath = null,
  playwrightModule = null,
  axePath = null
} = {}) {
  const target = validateWebsiteUrl(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (!confirm) throw new Error('Website accessibility testing launches a browser against the selected site. Pass --confirm after reviewing the target.');
  if (!local && !(allowRemote && target.protocol === 'https:')) throw new Error('Remote website checks require an HTTPS URL and explicit --allow-remote.');
  if (!['chromium', 'firefox', 'webkit'].includes(browserEngine)) throw new Error('Browser must be chromium, firefox or webkit.');
  if (!Array.isArray(profiles) || !profiles.length || profiles.length > 10 || profiles.some((id) => !Object.hasOwn(WEB_VIEWPORTS, id))) throw new Error(`Select one or more supported profiles: ${Object.keys(WEB_VIEWPORTS).join(', ')}.`);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('Timeout must be between 1000 and 120000 milliseconds.');

  const playwright = playwrightModule || await resolvePlaywright(projectRoot);
  const axe = axePath || resolveAxe(projectRoot);
  const type = playwright[browserEngine];
  if (!type?.launch) throw new Error(`Installed Playwright does not expose ${browserEngine}.`);
  const browser = await type.launch({ headless: true });
  const cases = profiles.flatMap((profileId) => {
    const profile = WEB_VIEWPORTS[profileId];
    return (profile.variants || [{ label: 'default', width: profile.width, height: profile.height }]).map((variant) => ({ profile: profileId, variant: variant.label, viewport: { width: variant.width, height: variant.height } }));
  });
  const results = [];
  const startedAt = new Date().toISOString();
  try {
    for (const testCase of cases) {
      const context = await browser.newContext({ viewport: testCase.viewport, colorScheme: 'light', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      const blockedRequests = [];
      const runtimeErrors = [];
      const httpErrors = [];
      page.on('pageerror', (error) => runtimeErrors.push(safe(error.message)));
      page.on('response', (response) => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: safe(response.url(), 300) }); });
      await page.route('**/*', async (route) => {
        const request = route.request();
        let requestUrl;
        try { requestUrl = new URL(request.url()); } catch { blockedRequests.push({ reason: 'invalid-url' }); return route.abort('blockedbyclient'); }
        if (requestUrl.origin !== target.origin) {
          blockedRequests.push({ reason: 'cross-origin', origin: requestUrl.origin, resourceType: request.resourceType() });
          return route.abort('blockedbyclient');
        }
        if (!['GET', 'HEAD'].includes(request.method().toUpperCase())) {
          blockedRequests.push({ reason: 'non-read-method', method: request.method(), resourceType: request.resourceType() });
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      const result = { profile: testCase.profile, variant: testCase.variant, viewport: testCase.viewport, status: 'failed', violations: [], incomplete: [], passes: 0, blockedRequests, runtimeErrors, httpErrors };
      try {
        const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        result.statusCode = response?.status?.() ?? null;
        if (!response || response.status() >= 400) throw new Error(`Initial document returned HTTP ${response?.status?.() ?? 'no response'}.`);
        if (new URL(page.url()).origin !== target.origin) throw new Error('Website redirected outside the approved origin.');
        await page.addScriptTag({ path: axe });
        const axeResult = await page.evaluate(async () => {
          const result = await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }
          });
          const nodes = (items) => items.slice(0, 25).map((node) => ({
            target: Array.isArray(node.target) ? node.target.slice(0, 5) : [],
            html: String(node.html || '').slice(0, 160),
            summary: String(node.failureSummary || '').slice(0, 500)
          }));
          return {
            violations: result.violations.map((item) => ({ id: item.id, impact: item.impact, help: item.help, helpUrl: item.helpUrl, description: item.description, nodeCount: item.nodes.length, nodes: nodes(item.nodes) })),
            incomplete: result.incomplete.slice(0, 50).map((item) => ({ id: item.id, impact: item.impact, help: item.help, nodeCount: item.nodes.length, nodes: nodes(item.nodes) })),
            passes: result.passes.length,
            inapplicable: result.inapplicable.length
          };
        });
        result.violations = axeResult.violations;
        result.incomplete = axeResult.incomplete;
        result.passes = axeResult.passes;
        result.inapplicable = axeResult.inapplicable;
        result.title = safe(await page.title(), 160);
        Object.assign(result, classifyAccessibilityEvidence(result));
      } catch (error) {
        result.error = safe(error instanceof Error ? error.message : String(error), 500);
        result.status = 'failed';
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
      results.push(result);
    }
  } finally {
    await browser.close();
  }
  const summary = {
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    review: results.filter((item) => item.status === 'review').length,
    failed: results.filter((item) => item.status === 'failed').length,
    violations: results.reduce((sum, item) => sum + item.violations.length, 0),
    incomplete: results.reduce((sum, item) => sum + item.incomplete.length, 0),
    blockedRequests: results.reduce((sum, item) => sum + item.blockedRequests.length, 0),
    runtimeErrors: results.reduce((sum, item) => sum + item.runtimeErrors.length, 0),
    httpErrors: results.reduce((sum, item) => sum + item.httpErrors.length, 0),
    needsReview: results.filter((item) => item.status === 'review').length
  };
  const report = {
    schemaVersion: 1,
    reportType: 'paxi-website-accessibility-audit',
    executionKind: local ? 'local-browser' : 'remote-https-browser',
    browser: browserEngine,
    target: `${target.origin}${target.pathname}`,
    startedAt,
    completedAt: new Date().toISOString(),
    cases: results,
    summary,
    status: summary.failed ? 'failed' : summary.review ? 'review' : 'passed',
    reviewPolicy: 'A case is only passed when axe-core reports no violations or incomplete checks and no blocked requests, browser runtime errors or HTTP response errors were observed. Review cases are not accessibility certification.',
    limitations: [
      'axe-core automates a subset of WCAG-related checks; it is not a complete WCAG conformance certification.',
      'Screen-reader usability, speech input, physical touch behaviour and platform-native accessibility APIs require manual/device testing.',
      'Only same-origin GET/HEAD requests are allowed; cross-origin resources and mutating requests are blocked and may affect the rendered page.',
      'Viewport profiles are browser simulations, not physical device certification.'
    ]
  };
  if (outputPath) report.output = await writeReport(outputPath, report);
  return report;
}
