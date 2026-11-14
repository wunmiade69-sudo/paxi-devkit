# PAXI Doctor V1.3.0 — Visual Regression, Runtime Probes and Security Review

V1.3.0 completes the next stabilization increment on top of V1.2.0 while preserving the Agent Engine, AI Studio, build, test, Device Lab and patch-approval workflows.

## 1. Pixel-level visual regression

Compare two supported PNG files:

```bash
paxi doctor visual compare ./baseline.png ./current.png \
  --pixel-threshold 16 --max-changed-percent 0.5
```

The comparator reports image dimensions, number and percentage of changed pixels, mean absolute channel error, changed bounds and SHA-256 values. A pixel is treated as changed when any normalized RGBA channel differs by more than `--pixel-threshold`.

Supported input: standard 8-bit RGB/RGBA, non-interlaced PNG. Palette, grayscale, 16-bit and interlaced PNG images must be converted first. The implementation is bounded to 40 MiB per image and 20 million decoded pixels. It produces structured measurements, not a diff-overlay image. Dynamic content, anti-aliasing, animations and font rasterization can cause legitimate screenshot differences.

## 2. Website Device Lab baselines

Install Playwright and Chromium in the website project, start the site yourself, then run:

```bash
paxi doctor lab run --project . --url http://127.0.0.1:5173 \
  --profiles compact,standard,tablet --conditions dark,landscape
```

Create or replace expected screenshots only after inspecting the current run:

```bash
paxi doctor lab run --project . --url http://127.0.0.1:5173 \
  --baseline-dir ./visual-baselines --update-baseline --confirm
```

Subsequent runs compare every matching profile/condition screenshot against `./visual-baselines`. The comparison is included in each case's evidence and can make a case fail when changed pixels exceed the configured allowance. Missing baselines are reported as review items. Baseline directories and screenshot files are checked against symlink use; replacement requires both flags.

Browser runs remain viewport simulations. Font scaling, zoom, keyboard obstruction, offline network emulation and foldable layouts are browser-level approximations, not native OS/device changes.

## 3. Frontend/API runtime response evidence

The Playwright runner now records failed HTTP responses separately from transport failures. HTTP 4xx/5xx responses from `fetch` and XHR are reported as `api-http-error`; page errors, console errors and failed requests retain their separate categories. Query parameters are redacted from recorded response URLs.

## 4. Backend and database health probe

Probe a local health endpoint:

```bash
paxi doctor runtime probe --url http://127.0.0.1:8080/health
```

The probe:

- Supports only GET and HEAD.
- Allows HTTP only for loopback hosts by default.
- Requires HTTPS and `--allow-remote` for a non-loopback endpoint.
- Rejects embedded credentials, query parameters and fragments.
- Does not send authorization headers or follow redirects.
- Enforces a bounded timeout and a 64 KiB response limit.
- Retains status/timing and a small set of safe service/dependency health labels, not response bodies or arbitrary headers.

For database/cache status, the app's own health endpoint must explicitly expose safe dependency status values, for example a `dependencies` or `checks` object. This command is a health probe, not distributed tracing, query profiling or proof of database correctness.

## 5. Cross-language static security review

Run offline/read-only scanning:

```bash
paxi doctor security scan --project .
```

Initial pattern checks cover common credential literals, private-key blocks in text, disabled TLS verification, dynamic shell/eval/HTML sinks, unsafe deserialization, permissive credentialed CORS, possible SQL string construction, Solidity `tx.origin`/`delegatecall`/`selfdestruct`, unsafe C/C++ string functions, Android WebView JavaScript bridges and cleartext-traffic settings.

Secret/key-like files such as `.env`, `.pem`, `.p12`, `.pfx`, `.jks` and keystore files are inventoried by filename only; their contents are deliberately not opened. Source matches return relative file path, line number and generic explanation; the matched source line and secret value are not returned.

This is heuristic static analysis, not a penetration test, formal audit or guarantee that no vulnerability exists. It does not execute project scripts, compile or install dependencies, and does not contact a vulnerability database.

## 6. Explicit online npm advisory audit

For a project with regular `package.json` and `package-lock.json` files:

```bash
paxi doctor security npm-audit --project . --online --confirm
```

This contacts the npm registry. The two explicit flags are required. Review suggested fixes before changing dependencies or lockfiles. V1.3.0 does not automatically install upgrades or apply dependency fixes. Other ecosystems are inventoried and available audit tools are reported; their advisory commands are not launched automatically.

## 7. Android launcher behavior

`paxi doctor lab android --package <id> --launch` now resolves the app's `MAIN`/`LAUNCHER` activity and starts that component with `am start -W`. It does not invoke Monkey random-event launch. If a safe launcher activity cannot be resolved, start the test app manually and rerun without `--launch`.

## Verification boundaries

Automated regression tests exercise PNG parsing/differencing, baseline creation/replacement, browser API response capture, loopback/remote probe policy, response redaction, security pattern detection, explicit npm audit gating and fake-ADB launcher resolution. A real browser run still requires Playwright/Chromium installed in the target project; real Android evidence requires an authorized phone/emulator. Online npm audit requires network access. Live services and production database behavior must be checked in the developer's own test environment.
