# PAXI Doctor — V0.8.0 adaptive testing and visual review

V0.8.0 adds three connected capabilities to the V0.7 Android journey engine: simple plain-language journey drafting, AI-assisted screenshot review, and deliberately bounded navigation exploration. All are additive; the existing CLI, local build, test, Termux, browser Device Lab, C/C++ and patch approval workflows remain intact.

## 1. Draft a journey from a goal

```bash
paxi doctor journey draft \
  --goal "tap Settings, then verify About is visible, then take screenshot" \
  --output ./journey.json

paxi doctor journey validate ./journey.json
```

The current draft generator is a deterministic command/label parser. Supported language is intentionally narrow: `tap`, `click`, `open`, `select`, `choose`, `navigate to`, `go to`, `verify`, `assert`, `check`, `ensure`, `confirm`, `wait N seconds`, and `take screenshot`. Labels become exact UI text selectors. Draft output is written with exclusive creation and mode `0600`; an existing file is never overwritten.

Every generated journey is marked for human review. Inspect each selector and edit it to prefer stable Android resource IDs where available. This generator does not use AI to infer arbitrary flows and does not generate credentials, text entry or transactions. Goals containing authentication, submission, payment, wallet-transfer or destructive intents are refused rather than guessed.

## 2. AI-assisted screenshot analysis

```bash
# Configure a local multimodal endpoint
paxi ai configure --mode local --url http://127.0.0.1:8080

# Analyse a screenshot using the configured multimodal model
paxi doctor vision analyze ./doctor-evidence/home.png

# Optional: include local preference metadata
paxi doctor vision analyze ./doctor-evidence/home.png --with-profile --project .
```

The endpoint must implement an OpenAI-compatible `/chat/completions` route and accept image input via `image_url` data URLs. The screenshot must be a regular, non-symlink PNG/JPEG/WebP image no larger than 8 MiB and no larger than 80 megapixels when dimensions are available. Responses are bounded to 2 MiB. The vision command returns its analysis to the terminal/JSON output and does not create a persistent report or retain the image.

Local AI mode connects only to localhost. API mode requires `PAXI_AI_API_KEY` and an interactive approval or explicit `--allow-remote`. The screenshot itself is not redacted before remote transfer; it can contain emails, account balances, wallet addresses, messages or other private content. Review it first. Do not use remote analysis for confidential screenshots unless you expressly approve that transfer. The `--with-profile` option adds local preference metadata, not source files; when used in API mode, the approval prompt explicitly notes that this metadata will also be sent.

A screenshot can help identify visible clipping, hierarchy, spacing, text size, contrast and likely touch-target concerns. It cannot verify button behavior, screen-reader access, keyboard navigation, network handling, state transitions or runtime correctness. Treat findings as AI-assisted review points, not certification.

## 3. Bounded Android navigation exploration

```bash
# Inspect and test safe navigation labels on a selected/only connected device
paxi doctor explore --package com.example.app --launch --confirm --max-actions 5

# Choose a specific device and evidence directory
paxi doctor explore --package com.example.app --device emulator-5554 \
  --confirm --max-actions 8 --output ./doctor-exploration
```

An authorized ADB device/emulator and an installed application are required. `--launch` is optional and explicit. `--confirm` is mandatory because the runner will tap navigation controls. The default action budget is five; the allowed range is 1–8.

The exploration engine captures the starting UI hierarchy in memory, selects only exact visible clickable navigation labels from this allowlist:

- Home, Dashboard, Settings, Profile, About, Help
- Discover, Activity, Assets, Me, Menu

It taps the center of each selected node, captures a screenshot when the screen signature changes, sends Android Back, and checks whether the original screen signature is restored before continuing. If it cannot verify a return, it stops. It does not type text, tap unknown controls, install or clear app data, grant permissions, submit forms, authenticate, purchase, pay, transfer, delete, sign, deploy or change system settings.

The UI labels are used only in memory. The report stores hashes of navigation labels/state, never the raw UI text. Screenshots are saved locally with restricted file permissions; the total evidence budget is limited to 50 MiB. Screenshots can contain private information and must be reviewed before sharing. The report explicitly sets `exploratoryPassClaim: false`; a shallow navigation sample is not app-wide QA or a security audit.

## 4. Verification and evidence quality

V0.8.0 tests cover:

- plain-language action conversion and exact-selector generation;
- refusal of risky action goals and non-overwriting draft files;
- allowlist-only hierarchy parsing and mandatory confirmation;
- fake-ADB end-to-end navigation, screenshots and state restoration;
- multimodal request formation, screenshot limits and no image retention in the returned report;
- remote-image transfer blocked without explicit user approval.

Real handset/emulator behavior and local multimodal model compatibility still need to be tested in the user's Termux environment. The automated fake-ADB integration test validates protocol handling, not the behavior of a specific Android OEM or app.

## 5. Known limits and next adapters

- Plain-language parsing is intentionally limited; complex workflows need a manually authored journey or a future model-assisted planner.
- Automatic exploration is one-level from the starting screen, not a full graph crawl. It only follows the navigation label allowlist.
- Vision uses the model supplied by the user; not all local models support image input.
- Pixel-level screenshot diffs, visual regression overlays, deeper screen-reader automation, Appium/Maestro, iOS runtime journeys and broader native app exploration remain future work.
- PAXI does not automatically modify application source after any finding. Existing Git patch review/application still requires a separately reviewed patch and explicit approval.
