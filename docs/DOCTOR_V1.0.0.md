# PAXI Doctor V1.0.0 — Adaptive diagnosis and approved repair

V1.0.0 connects PAXI Doctor's project inspection, AI Studio model routing, evidence handling and reviewed patch workflow.

## Adaptive model selection

`paxi ai ask --auto "..."` classifies the task into one of the configured roles:

- `coding`: errors, compiler/build failures, debugging and code changes.
- `vision`: screenshots, visual hierarchy, layout and visual regression questions.
- `journey`: test journeys, navigation plans and UI exploration instructions.
- `general`: explanations and other development questions.

The selector uses the matching role route when configured and falls back to the general route or the legacy configured provider. It does not change saved routes or silently switch providers. The selected provider, model, role and routing reason are printed with the answer.

## Evidence-based diagnosis

```bash
paxi doctor diagnose --project .
paxi doctor diagnose --project . --log ./build.log
paxi doctor diagnose --project . --log ./build.log --ai
```

Diagnosis combines static project findings, a bounded text log and known failure signatures. Common patterns include missing dependencies, package conflicts, TypeScript diagnostics, Android SDK/Gradle failures, Flutter package resolution, CMake toolchain errors, network and permission failures, memory exhaustion, test assertions and Solidity compiler/test failures.

- Logs must be regular non-symlink text files no larger than 256 KiB.
- Known secrets are redacted before excerpts are retained or sent to AI.
- Findings include evidence snippets, confidence and a conservative recommendation.
- AI diagnosis is optional and follows the selected coding/general task route. Remote text requires interactive approval or `--allow-remote`.
- Diagnosis is read-only: it does not run builds/tests or edit files.

Failure signatures are heuristics. They are evidence for investigation, not proof of root cause.

## Test command preview and execution

```bash
paxi doctor test --project .
paxi doctor test --project . --confirm
```

The preview detects conventional test runners for Node package scripts, Flutter, Python, Rust, Go, PHP Composer, .NET, Maven, Gradle wrappers, Foundry and configured CTest builds. It does not execute them. `--confirm` is required because project-defined test/build scripts can run arbitrary code. The runner uses argument arrays without a shell, strips PAXI/provider API keys from the child environment, redacts captured output and enforces a bounded timeout.

The detected command is a convention-based guess. Inspect it before confirming; PAXI does not guarantee that an arbitrary project's test script is safe.

## AI-generated patch drafts

```bash
paxi doctor patch draft \
  --project . \
  --description "Fix the null state in the settings screen" \
  --files src/settings.tsx,src/state.ts
```

Patch drafting requires 1–8 explicit existing source files. It refuses path traversal, symlinks, hidden secret/credential paths, binary files, oversized files and changes outside the selected paths. Each file is bounded to 32 KiB and the combined source context to 96 KiB. Common secrets are redacted. Only selected excerpts and diagnostic metadata are sent to the selected AI model; no whole-project upload occurs.

For remote providers, PAXI requires interactive consent or explicit `--allow-remote`; the prompt identifies the selected source paths. Local routes send the selected content only to the configured local endpoint.

The model must return a unified Git diff. PAXI stores it in the local private config directory, validates file scope, and runs `git apply --check`. The source tree remains unchanged. Draft generation does not grant approval.

## Review, approve and retest

```bash
paxi doctor patch review /path/to/generated.patch --project .
paxi doctor patch apply /path/to/generated.patch --project . --confirm --run-tests
```

PAXI requires a clean Git working tree before patch application. Review success means the patch is syntactically applicable, not approved. `--confirm` is a separate authorization to modify project source. `--run-tests` separately requests the detected test command after application. Results remain ordinary uncommitted Git changes; PAXI does not silently revert a patch when tests fail. Review `git diff` and test output and revert manually when needed.

## Safety boundaries

- No autonomous source edits or patch application.
- No automatic dependency installation, secret rotation, signing, publishing, deployment, financial actions or production account changes.
- Remote source sharing is limited to exact user-selected files and requires consent.
- AI output is untrusted. A passing `git apply --check` only confirms patch applicability; it does not prove correctness or security.
- A green test run covers only the detected test command. It is not a security audit, device certification or release approval.
