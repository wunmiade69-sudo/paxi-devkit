import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR } from '../lib/paths.mjs';
import { recordLabRun, listLabRuns } from './lab-history.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';
import { createTraceparent, extractTraceContext, validateTraceId } from './trace-context.mjs';
import { comparePngFiles } from './visual-regression.mjs';

export const WEB_VIEWPORTS = Object.freeze({
  compact: { label: 'Compact phone', width: 360, height: 800 },
  standard: { label: 'Standard phone', width: 390, height: 844 },
  large: { label: 'Large phone', width: 430, height: 932 },
  foldable: { label: 'Foldable cover', width: 360, height: 800, variants: [{ label: 'cover', width: 360, height: 800 }, { label: 'unfolded', width: 720, height: 840 }] },
  tablet: { label: 'Tablet', width: 1024, height: 1366 }
});

const VALID_CONDITIONS = new Set(['font', 'landscape', 'dark', 'keyboard', 'zoom', 'offline']);
const safeSlug = (value) => String(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'website';
function reportUrl(value) {
  const safe = new URL(value);
  for (const key of [...safe.searchParams.keys()]) safe.searchParams.set(key, '[REDACTED]');
  safe.hash = '';
  return safe.href;
}
function safeText(value, limit = 500) { return redactSensitiveText(String(value || '').slice(0, limit)).text; }

async function prepareBaselineDirectory(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const existing = await fs.lstat(current).catch(() => null);
    if (existing?.isSymbolicLink()) throw new Error('Visual baseline path must not pass through symbolic links.');
    if (existing && current !== absolute && !existing.isDirectory()) throw new Error('Visual baseline parent path contains a non-directory component.');
  }
  const existing = await fs.lstat(absolute).catch(() => null);
  if (existing && !existing.isDirectory()) throw new Error('Visual baseline directory must be a real directory, not a file.');
  if (!existing) await fs.mkdir(absolute, { recursive: true, mode: 0o700 });
  const verified = await fs.lstat(absolute);
  if (!verified.isDirectory() || verified.isSymbolicLink()) throw new Error('Visual baseline directory is not safe to use.');
  return absolute;
}

async function replaceBaseline(sourcePath, destinationPath) {
  const existing = await fs.lstat(destinationPath).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`Refusing to replace a non-regular visual baseline: ${path.basename(destinationPath)}`);
  const temporary = `${destinationPath}.${randomUUID()}.tmp`;
  try {
    const bytes = await fs.readFile(sourcePath);
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, destinationPath);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

export function validateWebsiteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Website URL must be a valid absolute http:// or https:// URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Website URL must use http:// or https:// and must not contain embedded credentials.');
  }
  return url;
}

export function buildWebsiteLabMatrix({ profiles = ['standard'], conditions = [] } = {}) {
  const selectedProfiles = [...new Set(profiles)];
  const selectedConditions = [...new Set(conditions)];
  if (!selectedProfiles.length || selectedProfiles.some((id) => !Object.hasOwn(WEB_VIEWPORTS, id))) {
    throw new Error(`Choose at least one web profile: ${Object.keys(WEB_VIEWPORTS).join(', ')}.`);
  }
  const unknown = selectedConditions.filter((id) => !VALID_CONDITIONS.has(id));
  if (unknown.length) throw new Error(`Unknown Device Lab condition(s): ${unknown.join(', ')}.`);
  const cases = [];
  for (const profileId of selectedProfiles) {
    const profile = WEB_VIEWPORTS[profileId];
    const variants = profile.variants || [{ label: 'default', width: profile.width, height: profile.height }];
    for (const variant of variants) {
      const orientations = selectedConditions.includes('landscape') ? ['portrait', 'landscape'] : ['portrait'];
      const themes = selectedConditions.includes('dark') ? ['light', 'dark'] : ['light'];
      for (const orientation of orientations) {
        for (const theme of themes) {
          let { width, height } = variant;
          if (orientation === 'landscape' && height > width) [width, height] = [height, width];
          cases.push({
            id: `${profileId}-${variant.label}-${orientation}-${theme}`,
            profile: profileId,
            profileLabel: profile.label,
            variant: variant.label,
            viewport: { width, height },
            orientation,
            colorScheme: theme,
            conditions: {
              font: selectedConditions.includes('font'),
              keyboard: selectedConditions.includes('keyboard'),
              zoom: selectedConditions.includes('zoom'),
              offline: selectedConditions.includes('offline')
            }
          });
        }
      }
    }
  }
  return cases;
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
  throw new Error('Playwright is not installed. Install it in this project with `npm install --save-dev playwright` and install Chromium with `npx playwright install chromium`; PAXI will not install browser packages automatically.');
}

function summarizeCase(issues) {
  if (issues.some((item) => item.severity === 'error')) return 'failed';
  if (issues.length) return 'review';
  return 'passed';
}

async function evaluatePage(page, testCase) {
  return page.evaluate(({ keyboard, zoom }) => {
    const root = document.documentElement;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const overflowing = [...document.querySelectorAll('body *')].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.position !== 'fixed' && rect.width > 0 && rect.right > width + 2 && style.visibility !== 'hidden' && style.display !== 'none';
    }).slice(0, 20).map((element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === 'string' ? element.className.slice(0, 100) : null,
      right: Math.round(element.getBoundingClientRect().right),
      width: Math.round(element.getBoundingClientRect().width)
    }));
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const missingAlt = [...document.querySelectorAll('img')].filter((item) => !item.hasAttribute('alt')).length;
    const missingButtonNames = [...document.querySelectorAll('button,[role="button"]')].filter((item) => {
      const label = item.getAttribute('aria-label') || item.getAttribute('aria-labelledby') || item.innerText || item.getAttribute('title');
      return !String(label || '').trim();
    }).length;
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]),textarea,select,[contenteditable="true"]')].filter(visible);
    let keyboardTarget = null;
    if (keyboard && inputs.length) {
      const rect = inputs[0].getBoundingClientRect();
      keyboardTarget = { tag: inputs[0].tagName.toLowerCase(), top: Math.round(rect.top), bottom: Math.round(rect.bottom), visibleInReducedViewport: rect.bottom <= height - 280 };
    }
    return {
      viewport: { innerWidth: width, innerHeight: height, documentWidth: root.scrollWidth, documentHeight: root.scrollHeight },
      horizontalOverflow: root.scrollWidth > width + 2,
      overflowingElements: overflowing,
      titlePresent: Boolean(document.title.trim()),
      viewportMetaPresent: Boolean(document.querySelector('meta[name="viewport"]')),
      imagesMissingAlt: missingAlt,
      buttonsMissingName: missingButtonNames,
      visibleInputCount: inputs.length,
      keyboardApproximation: keyboardTarget,
      zoomApplied: zoom ? 'CSS zoom 125% approximation' : null
    };
  }, { keyboard: testCase.conditions.keyboard, zoom: testCase.conditions.zoom });
}

export async function runWebsiteDeviceLab({
  url,
  projectRoot = process.cwd(),
  profiles = ['standard'],
  conditions = [],
  outputDir = null,
  timeoutMs = 15000,
  baselineDir = null,
  updateBaseline = false,
  confirmBaselineUpdate = false,
  visualPixelThreshold = 16,
  visualMaxChangedPercent = 0.5,
  traceId: requestedTraceId = null,
  routes = [],
  playwrightModule = null,
  now = () => new Date()
} = {}) {
  const target = validateWebsiteUrl(url);
  const traceId = requestedTraceId === null ? null : validateTraceId(requestedTraceId);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('Website test timeout must be between 1000 and 120000 milliseconds.');
  const baseMatrix = buildWebsiteLabMatrix({ profiles, conditions });
  if (!Array.isArray(routes) || routes.length > 30) throw new Error('Website route regression accepts at most 30 route paths.');
  const normalizedRoutes = [...new Set(routes.map((value) => {
    if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/') || value.startsWith('//') || /[?#\\\u0000-\u001f]/.test(value)) throw new Error('Each --route must be a same-origin absolute path beginning with one / and contain no query, fragment or backslash.');
    let decoded; try { decoded = decodeURIComponent(value); } catch { throw new Error('Each --route must contain valid percent-encoding.'); }
    if (decoded.split('/').some((part) => part === '.' || part === '..')) throw new Error('Website routes cannot contain dot segments.');
    return value.replace(/\/+/g, '/');
  }))];
  const matrix = normalizedRoutes.length ? baseMatrix.flatMap((item) => normalizedRoutes.map((route) => ({ ...item, id: `${item.id}-${safeSlug(route)}`, route }))) : baseMatrix;
  if (updateBaseline && (!baselineDir || !confirmBaselineUpdate)) throw new Error('Updating visual baselines overwrites expected screenshots. Provide --baseline-dir and explicit --update-baseline --confirm.');
  if (baselineDir && (!Number.isFinite(visualPixelThreshold) || visualPixelThreshold < 0 || visualPixelThreshold > 255 || !Number.isFinite(visualMaxChangedPercent) || visualMaxChangedPercent < 0 || visualMaxChangedPercent > 100)) throw new Error('Visual comparison thresholds are outside their supported range.');
  const resolvedBaselineDir = baselineDir ? await prepareBaselineDirectory(baselineDir) : null;
  const playwright = playwrightModule || await resolvePlaywright(projectRoot);
  const browserType = playwright.chromium;
  if (!browserType?.launch) throw new Error('The installed Playwright package does not expose Chromium. Install the full `playwright` package and Chromium browser.');

  const id = randomUUID();
  const startedAt = now().toISOString();
  const reportDir = outputDir ? path.resolve(outputDir) : path.join(CONFIG_DIR, 'doctor-reports', 'device-lab', id);
  await fs.mkdir(reportDir, { recursive: true, mode: 0o700 });
  const browser = await browserType.launch({ headless: true });
  const results = [];
  try {
    for (let index = 0; index < matrix.length; index += 1) {
      const testCase = matrix[index];
      const issues = [];
      const evidence = {};
      const context = await browser.newContext({
        viewport: testCase.viewport,
        colorScheme: testCase.colorScheme,
        isMobile: testCase.profile !== 'tablet',
        hasTouch: testCase.profile !== 'tablet',
        serviceWorkers: 'allow'
      });
      if (traceId) {
        await context.route('**/*', async (route) => {
          const request = route.request();
          const resourceType = request.resourceType();
          if (!['fetch', 'xhr'].includes(resourceType)) return route.continue();
          const headers = { ...request.headers(), traceparent: createTraceparent(traceId) };
          return route.continue({ headers });
        });
      }
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      const failedRequests = [];
      const httpErrors = [];
      page.on('response', (response) => {
        const status = response.status();
        if (status >= 400) {
          let resourceType = 'other';
          try { resourceType = response.request().resourceType(); } catch {}
          let requestTrace = { traceId: null, requestId: null };
          let responseTrace = { traceId: null, requestId: null };
          let method = null;
          try {
            const request = response.request();
            method = typeof request?.method === 'function' ? request.method() : null;
            requestTrace = extractTraceContext(typeof request?.headers === 'function' ? request.headers() : null);
          } catch {}
          try { responseTrace = extractTraceContext(typeof response.headers === 'function' ? response.headers() : null); } catch {}
          httpErrors.push({ url: reportUrl(response.url()), method, status, resourceType, traceId: responseTrace.traceId || requestTrace.traceId, requestId: responseTrace.requestId });
        }
      });
      page.on('pageerror', (error) => pageErrors.push(safeText(error.message || error)));
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(safeText(message.text())); });
      page.on('requestfailed', (request) => failedRequests.push({ url: reportUrl(request.url()), error: safeText(request.failure()?.errorText || 'request failed') }));
      let navigationError = null;
      try {
        const visitUrl = testCase.route ? new URL(testCase.route, target.origin) : target;
        if (visitUrl.origin !== target.origin) throw new Error('Website regression route resolved outside the original target origin.');
        await page.goto(visitUrl.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        evidence.visitedUrl = reportUrl(visitUrl.href);
      } catch (error) {
        navigationError = safeText(error.message || error, 1000);
        issues.push({ severity: 'error', code: 'website-navigation-failed', message: navigationError });
      }

      if (!navigationError) {
        if (testCase.conditions.font) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' }).catch(() => {});
        if (testCase.conditions.zoom) await page.evaluate(() => { document.documentElement.style.zoom = '125%'; });
        const metrics = await evaluatePage(page, testCase).catch((error) => ({ evaluationError: String(error.message || error) }));
        evidence.metrics = metrics;
        if (metrics.horizontalOverflow) issues.push({ severity: 'error', code: 'horizontal-overflow', message: `Document width ${metrics.viewport.documentWidth}px exceeds viewport ${metrics.viewport.innerWidth}px.` , elements: metrics.overflowingElements });
        if (!metrics.titlePresent) issues.push({ severity: 'warning', code: 'missing-document-title', message: 'The page has no document title.' });
        if (!metrics.viewportMetaPresent && testCase.profile !== 'tablet') issues.push({ severity: 'warning', code: 'missing-viewport-meta', message: 'Mobile viewport metadata was not found.' });
        if (metrics.imagesMissingAlt) issues.push({ severity: 'warning', code: 'images-missing-alt', message: `${metrics.imagesMissingAlt} image(s) have no alt attribute.` });
        if (metrics.buttonsMissingName) issues.push({ severity: 'warning', code: 'buttons-missing-name', message: `${metrics.buttonsMissingName} button(s) appear to have no accessible name.` });
        if (failedRequests.length) issues.push({ severity: 'warning', code: 'network-request-failed', message: `${failedRequests.length} browser request(s) failed during initial page load.`, evidence: failedRequests.slice(0, 10) });
        const apiErrors = httpErrors.filter((item) => ['xhr','fetch'].includes(item.resourceType));
        if (apiErrors.length) issues.push({ severity: 'error', code: 'api-http-error', message: `${apiErrors.length} API/fetch response(s) returned HTTP 4xx/5xx.`, evidence: apiErrors.slice(0, 20) });

        if (testCase.conditions.keyboard) {
          const targetInput = page.locator('input:not([type="hidden"]),textarea,select,[contenteditable="true"]').first();
          if (await targetInput.count().catch(() => 0)) {
            await targetInput.scrollIntoViewIfNeeded().catch(() => {});
            await targetInput.focus().catch(() => {});
            evidence.keyboardFocus = await targetInput.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { focused: document.activeElement === element, top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewportHeight: window.innerHeight };
            }).catch(() => ({ focused: false }));
          } else evidence.keyboardFocus = { available: false, note: 'No visible text-entry control was detected.' };
        }
        if (testCase.conditions.offline) {
          await context.setOffline(true);
          try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 6000) });
            evidence.offlineReload = { loaded: true, interpretation: 'The page reloaded while browser context was offline; service worker or cached content may have served it.' };
          } catch (error) {
            evidence.offlineReload = { loaded: false, message: safeText(error.message || error), interpretation: 'Offline reload did not complete. This is evidence of unavailable offline navigation, not a failure of the online page.' };
          }
          await context.setOffline(false);
        }
      }
      if (pageErrors.length) issues.push({ severity: 'error', code: 'browser-runtime-error', message: `${pageErrors.length} uncaught browser error(s).`, evidence: pageErrors.slice(0, 10) });
      if (consoleErrors.length) issues.push({ severity: 'warning', code: 'browser-console-errors', message: `${consoleErrors.length} console error(s).`, evidence: consoleErrors.slice(0, 10) });
      const screenshotName = `${String(index + 1).padStart(2, '0')}-${safeSlug(testCase.id)}.png`;
      const screenshotPath = path.join(reportDir, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' }).catch((error) => {
        evidence.screenshotError = String(error.message || error).slice(0, 500);
      });
      evidence.screenshot = await fs.stat(screenshotPath).then(async (info) => {
        if (info.size > 40 * 1024 * 1024) {
          await fs.unlink(screenshotPath).catch(() => {});
          evidence.screenshotError = 'Screenshot exceeded the 40 MiB evidence limit and was removed.';
          return null;
        }
        return screenshotPath;
      }).catch(() => null);
      if (resolvedBaselineDir) {
        const baselinePath = path.join(resolvedBaselineDir, `${safeSlug(testCase.id)}.png`);
        if (updateBaseline && evidence.screenshot) {
          await replaceBaseline(screenshotPath, baselinePath);
          evidence.visualBaseline = { status: 'updated', path: baselinePath, note: 'Baseline replaced only after explicit --update-baseline --confirm.' };
        } else if (evidence.screenshot) {
          const baselineInfo = await fs.lstat(baselinePath).catch(() => null);
          if (!baselineInfo) {
            evidence.visualBaseline = { status: 'missing', path: baselinePath };
            issues.push({ severity: 'warning', code: 'visual-baseline-missing', message: `No visual baseline exists for ${testCase.id}. Create one with --update-baseline --confirm.` });
          } else {
            const comparison = await comparePngFiles(baselinePath, screenshotPath, { pixelThreshold: visualPixelThreshold, maxChangedPercent: visualMaxChangedPercent });
            evidence.visualComparison = comparison;
            evidence.visualBaseline = { status: comparison.comparable ? comparison.passed ? 'matched' : 'regressed' : 'incomparable', path: baselinePath };
            if (!comparison.comparable) issues.push({ severity: 'warning', code: 'visual-baseline-incomparable', message: comparison.reason || 'Screenshot could not be compared to the saved baseline.' });
            else if (!comparison.passed) issues.push({ severity: 'error', code: 'visual-regression', message: `${comparison.changedPercent}% of pixels changed (allowed ${visualMaxChangedPercent}%).`, evidence: { changedPixels: comparison.changedPixels, bounds: comparison.changedBounds } });
          }
        } else evidence.visualBaseline = { status: 'screenshot-unavailable' };
      }
      evidence.pageErrors = pageErrors.slice(0, 20);
      evidence.consoleErrors = consoleErrors.slice(0, 20);
      evidence.failedRequests = failedRequests.slice(0, 20);
      evidence.httpErrors = httpErrors.slice(0, 20);
      evidence.executionKind = 'browser-viewport-simulation';
      evidence.nativeSystemKeyboard = false;
      evidence.foldablePostureTested = false;
      results.push({ ...testCase, status: summarizeCase(issues), issues, evidence });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const report = {
    schemaVersion: 1,
    runId: id,
    startedAt,
    completedAt: now().toISOString(),
    targetUrl: reportUrl(target.href),
    projectName: path.basename(path.resolve(projectRoot)),
    runner: 'playwright-chromium',
    executionKind: 'simulated-browser-viewport',
    devicePassClaim: false,
    realDeviceTested: false,
    traceContext: { enabled: Boolean(traceId), standard: traceId ? 'W3C Trace Context 1.0' : null, traceId, header: traceId ? 'traceparent' : null, scope: traceId ? 'XHR/fetch requests only' : 'disabled', note: traceId ? 'Trace headers may trigger CORS preflight. Use only with a test environment configured to accept traceparent.' : 'No trace headers were injected.' },
    reportDirectory: reportDir,
    visualBaseline: resolvedBaselineDir ? { directory: resolvedBaselineDir, updated: Boolean(updateBaseline), pixelThreshold: visualPixelThreshold, maxChangedPercent: visualMaxChangedPercent } : null,
    summary: {
      total: results.length,
      passed: results.filter((item) => item.status === 'passed').length,
      review: results.filter((item) => item.status === 'review').length,
      failed: results.filter((item) => item.status === 'failed').length
    },
    results,
    routePlan: normalizedRoutes.length ? { routes: normalizedRoutes, sameOriginOnly: true, manualReviewRequired: true } : null,
    limitations: [
      'These are browser viewport simulations, not physical-device or emulator test results.',
      'The keyboard condition focuses web form controls; it does not open a native Android/iOS keyboard.',
      'Font scaling and display zoom use CSS approximations, not operating-system accessibility settings.',
      'Foldable cover/unfolded checks change viewport dimensions only; hinge posture and native fold state are not tested.',
      'Offline checks use Playwright browser context network emulation; device radios and operating-system connectivity are not changed.'
    ]
  };
  const reportPath = path.join(reportDir, 'report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  report.reportPath = reportPath;
  report.archivePath = await recordLabRun(report);
  return report;
}

export async function listWebsiteLabHistory() {
  return listLabRuns();
}
