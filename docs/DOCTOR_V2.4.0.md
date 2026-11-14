# PAXI Doctor V2.4.0 — user-approved project test certification

## Goal

V2.4.0 connects the existing read-only environment inventory with the existing explicit-consent project test runner. Certification remains read-only unless the developer asks PAXI to execute the detected project test command and supplies explicit confirmation.

## Commands

Read-only inventory (default):

```bash
paxi doctor certify --project .
paxi doctor certify --project . --json
```

Run the detected conventional test command:

```bash
paxi doctor certify --project . --run-tests --confirm
paxi doctor certify --project . --run-tests --confirm --timeout 1800 --json
```

`--run-tests` without `--confirm` is rejected before project code is executed. `--confirm` without `--run-tests` is also rejected. The timeout must be between 1 and 3600 seconds.

## Result semantics

The report preserves the capability inventory and adds `testExecution` only when execution was explicitly requested.

| `testExecution.status` | Meaning |
|---|---|
| `passed` | The selected test process exited zero, was not cancelled or timed out, and output stayed within capture limits. |
| `passed-output-truncated` | Process exit was zero but captured output exceeded the evidence limit. |
| `failed` | Test process exited non-zero and evidence was not truncated. |
| `failed-output-truncated` | Test process exited non-zero and output was truncated. |
| `timed-out` / `cancelled` | The runner ended due to timeout or user interruption. |
| `tool-missing` | Detected test tool is unavailable; no command was executed. |
| `not-available` | No supported conventional test command was detected. |

A process pass and evidence completeness are separate fields. `passed` may be true for `passed-output-truncated`, while `evidenceComplete` is false. The command returns a non-zero process exit for failed, unavailable, timed-out, cancelled or incomplete-evidence execution.

## Safety

- Certification is read-only by default.
- Project tests are project-controlled code. Explicit confirmation is required because scripts can perform actions allowed to the current OS user.
- PAXI invokes the detected command using the existing process runner with `shell: false` and a bounded output capture.
- Standard PAXI AI credentials are removed from the child environment.
- Captured stdout, stderr and process errors are passed through PAXI's sensitive-value redactor before being included in the report.
- The project root must be a real, non-symlink directory.
- A test pass is not a production-readiness, security, browser, database, mobile-device or release certification.

## Tool-planning consistency

The executor now passes the same injected tool-availability detector to both command planning and execution checks. This avoids test fixtures or callers producing a plan with one availability source and executing it against a different source.

## Remaining gates

This feature executes only the conventional test command selected by the detector. It does not install project dependencies, build applications, execute database migrations, run scanners or launch browser/device tests. Those remain separate explicit workflows with their own safety contracts. Physical Android, iOS/Xcode, remote database and hosted CI results require corresponding real-environment execution.
