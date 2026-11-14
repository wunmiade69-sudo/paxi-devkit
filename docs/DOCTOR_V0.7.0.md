# PAXI Doctor — V0.7.0 Android user-journey runner

V0.7.0 adds a real, ADB-backed scripted Android journey runner to the V0.6.x Doctor foundations. It moves beyond device snapshots and browser viewport simulation by executing a user-authored sequence of interactions against an installed Android application and collecting bounded evidence.

## Commands

```bash
# Print a starter journey JSON document
paxi doctor journey example

# Validate a journey file without connecting to or controlling a device
paxi doctor journey validate ./journey.json

# Run the journey on the only authorized ADB device
paxi doctor journey run --file ./journey.json --package com.example.app --launch

# Select a device and a private evidence directory
paxi doctor journey run --file ./journey.json --package com.example.app \
  --device emulator-5554 --output ./doctor-evidence --timeout 300 --json
```

`--launch` is explicit. Without it PAXI will run the journey against the installed application's current state. PAXI never force-stops or clears app data as part of a journey.

## Journey schema

A journey is a UTF-8 JSON file with `schemaVersion: 1`, a name, and between 1 and 100 steps. The supported actions are:

- `tap`: use integer `x`/`y` coordinates, or a selector.
- `swipe`: use `from`, `to`, and an optional 100–5000 ms duration.
- `type`: read the field value from an environment variable (`valueEnv`).
- `press`: use an allowlisted key such as `BACK`, `ENTER`, `TAB`, or a DPAD key.
- `wait`: wait between 0 and 30,000 ms. Total explicit waits cannot exceed 10 minutes.
- `screenshot`: capture an intermediate PNG evidence image.
- `assertVisible` / `assertNotVisible`: assert that an accessible UI node is present or absent.
- `assertForeground`: assert that the target app is the resumed foreground activity.

Selectors support exactly one of `resourceId`, `text`, `textContains`, or `contentDescription`. Prefer stable resource IDs. Custom canvas-rendered controls may not expose UIAutomator nodes. Text-based selector values are used transiently and are not retained in reports.

Example:

```json
{
  "schemaVersion": 1,
  "name": "Sign-in smoke journey",
  "steps": [
    { "type": "assertVisible", "selector": { "resourceId": "com.example.app:id/sign_in" } },
    { "type": "tap", "selector": { "resourceId": "com.example.app:id/email" } },
    { "type": "type", "valueEnv": "PAXI_TEST_EMAIL" },
    { "type": "tap", "selector": { "text": "Continue" } },
    { "type": "wait", "ms": 1000 },
    { "type": "assertForeground" },
    { "type": "screenshot", "name": "after-sign-in" }
  ]
}
```

Set test values in the current shell before running a journey. Environment variable names used for automated text entry must begin with `PAXI_TEST_` to reduce accidental use of unrelated credentials. Example in Termux:

```bash
export PAXI_TEST_EMAIL='qa@example.invalid'
export PAXI_TEST_PASSWORD='use-a-dedicated-test-account-password'
paxi doctor journey run --file ./journey.json --package com.example.app --launch
unset PAXI_TEST_EMAIL PAXI_TEST_PASSWORD
```

Text input values are not added to command output, journey reports or history archives. The report retains only the environment-variable name and character count. Do not use real customer accounts or production credentials for test journeys. Screenshots may still contain private on-screen information; review them before sharing.

## What the runner records

- Physical Android device vs emulator execution kind, model, Android release/API, display size and density.
- Start, end and explicitly requested step screenshots.
- Step-level action/assertion status and bounded duration.
- Foreground activity checks.
- A bounded before/after logcat comparison for likely Java crashes, ANRs, native crashes and process-death signals.
- A possible-stuck-UI warning when the accessibility hierarchy remains unchanged through three consecutive interactions. This is a heuristic, not proof of a frozen screen.
- A protected JSON report and the usual local Device Lab history archive.

The evidence output directory must be empty and must not itself be a symbolic link; this avoids overwriting unrelated files. The report never claims a general device pass. `journeyPassClaim` can only be true when the defined journey completed, at least one explicit assertion passed, the logcat baseline and final scan were available, and no issue or crash signal was recorded. It means only that this particular script passed on this particular execution environment.

## Safety and boundaries

- ADB is invoked with argument arrays and `shell: false`; input text is passed through remote-shell quoting.
- Journey files are regular non-symlink files, limited to 128 KiB; step count is limited to 100; execution timeout is limited to 600 seconds.
- Coordinate actions are checked against the connected display dimensions before the run begins.
- The runner does not install APKs, clear app data, change system settings, grant permissions, purchase, transfer funds, send production messages, sign releases, or deploy software.
- The app must already be installed. If launching is requested, PAXI resolves the package launcher activity and uses `am start -W` directly; it does not inject random Monkey events or force-stop the package.
- The crash scanner is best effort and depends on device log access and log retention. When a baseline cannot be read, the run is not marked crash-scan verified. It stores signal categories/counts, not raw logcat lines.
- UIAutomator selector matching requires the app to expose accessible nodes. Screenshots and accessibility hierarchy are not a replacement for a human accessibility review.

## Still not implemented by this increment

- AI-generated journeys from natural language or automatic exploration of arbitrary app flows.
- Appium/Maestro orchestration, iOS runtime journeys, or multi-device parallel execution.
- Pixel-level visual diffing, automatic visual repair, and autonomous patch generation from a failing journey.
- A full device-condition controller that changes font scale, orientation, theme, keyboard state or network radios. The existing Device Lab still observes those Android settings unless a user changes them manually.

The existing patch workflow remains separate: PAXI can review a Git patch and apply it only with explicit confirmation. A journey failure does not automatically modify source code.
