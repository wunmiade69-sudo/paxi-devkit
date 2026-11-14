# PAXI Doctor V2.3.0 — Local certification and diagnosis quality

## Design goal

V2.3.0 adds two evidence-oriented capabilities so developers can understand the host's readiness and measure the deterministic diagnosis layer without confusing static presence checks with successful runtime verification.

## Local capability certification

```bash
paxi doctor certify --project .
paxi doctor certify --project . --json
```

The certification command:

- Resolves a real, non-symlink project root.
- Reuses the existing conventional test-plan detector but never runs the plan.
- Checks local executable availability across core tools, Android, web, C/C++, language ecosystems, security scanners and database clients.
- Checks whether Playwright, `@playwright/test` and axe-core resolve from the target project's dependency tree.
- Lists local GitHub Actions workflow files but does not infer that hosted CI passed.
- Returns `ready-for-test`, `partial` or `blocked`; `ready-for-test` means a conventional test command and its mapped key toolchain are available, not that tests passed.

Statuses have deliberately narrow meanings:

| Status | Meaning |
|---|---|
| `available` | An executable was found on PATH or a package resolves from the project. |
| `missing` | The executable/package was not found. |
| `detected-not-run` | A conventional test command was identified and its tool is present; it has not been executed. |
| `tool-missing` | A conventional test command exists but its required executable is unavailable. |
| `not-detected` | No supported conventional test command was identified. |

The command does not invoke external `--version` commands. It does not inspect or execute project scripts beyond reading a bounded project manifest through the existing detector.

## Diagnosis benchmark

```bash
paxi doctor benchmark diagnosis
paxi doctor benchmark diagnosis --json
```

The benchmark uses an embedded, versioned corpus of synthetic log messages. It computes:

- Exact-case accuracy.
- Micro true positives, false positives and false negatives.
- Micro precision, recall and F1.
- Per-finding-code metrics.

The benchmark returns `passed` only when precision, recall and exact-case accuracy are each at least 0.95. Fixture text is not included in the report; only case IDs and expected/actual label deltas are emitted.

This is a narrow deterministic classifier benchmark. It does not claim to evaluate an AI model, an engineer's root-cause diagnosis, security review quality or patch success. Real-world quality evaluation requires a reviewed, privacy-sanitized and labeled corpus with documented class balance and ground truth.

## Evidence completeness changes

### Project tests

A project test command can exit with code zero while PAXI's bounded output capture is truncated. The report now includes:

- `passed`: whether the process exited successfully and was not timed out/cancelled.
- `evidenceComplete`: false when the captured output was truncated or the run timed out/cancelled.
- `status`: `passed-output-truncated` for a successful process whose captured output was truncated, or `failed-output-truncated` for a failed process with truncation.
- `outputBytes` and `outputTruncated`.

A truncated output does not reverse the process exit code, but it makes the evidence limitation explicit.

### Native vulnerability scans

If scanner output is truncated, the report becomes `incomplete-output`, `complete: false`, `clean: false`, and `summary.coverageComplete: false`. Partial JSON may still supply preliminary advisory evidence, but it cannot establish complete coverage or a clean scan.

## Privacy and execution boundaries

- Certification is read-only and does not run project code.
- The offline benchmark uses synthetic strings and makes no network calls.
- No API keys or source files are sent to an AI provider by these new commands.
- No files are changed by these commands.
