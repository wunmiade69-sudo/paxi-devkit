# PAXI Doctor V1.2.0 — Architecture Intelligence, Feedback and AI Budgets

V1.2.0 extends the V1.1.0 Agent Engine with three local-first capabilities: static project architecture mapping, explicit feedback adaptation, and a configurable AI usage budget guard.

## 1. Project architecture map

```bash
paxi doctor agent architecture --project .
paxi doctor agent architecture --project . --json
```

The analyzer produces a bounded static map of source modules, relative internal import/include edges, common entrypoint candidates, dependency manifests, API integration markers, state-management markers, possible cycles and coupling hotspots.

Safety and accuracy boundaries:

- It does not execute source files, install dependencies or call remote services.
- It skips symlinks, common generated/vendor directories, hidden directories, files above 256 KiB, more than 1,400 source files, and more than 24 MiB of source content.
- It emits relative file paths and metadata, not source contents, absolute paths, environment values or credentials.
- Import resolution is heuristic. Aliases, dynamic imports, reflection, code generation and runtime dependency injection may be missed.
- Cycles and high fan-in/fan-out are review signals, not proof of defects.

The Agent Engine includes the architecture summary in its plan and may add API-contract, state-transition, import-cycle and dependency-manifest review steps. Tests, builds, browsers and Android actions remain approval-gated.

## 2. Explicit feedback adaptation

```bash
paxi doctor agent feedback record \
  --decision modified \
  --area testing \
  --note "Require physical-device evidence before calling Android verified."

paxi doctor agent feedback show
paxi doctor agent feedback clear --confirm
```

Supported decisions are `accepted`, `rejected`, and `modified`. Areas are `plan`, `diagnosis`, `model`, `patch`, `visual`, `testing`, and `general`.

Feedback records are stored locally per project. Sensitive credential patterns in notes are redacted. After at least three signals in an area, repeated rejection/modification raises the future plan's human-review emphasis; repeated acceptance may be recorded as a confidence-building signal. Feedback never approves a patch, disables safety rules, or authorizes a command. Clear feedback per project using `clear --confirm`.

## 3. AI token and spending limits

```bash
paxi ai budget show
paxi ai budget tokens 24000 2000
paxi ai budget limit request 0.10
paxi ai budget limit monthly 5
paxi ai budget price openai your-model-id 2.00 8.00
paxi ai budget history
```

The price command stores developer-entered USD rates per one million input and output tokens for an exact provider/model ID. PAXI never guesses or downloads prices. When a monetary cap is active, a cloud request is blocked if no matching rate exists, because the configured cap cannot otherwise be checked.

Before every model request, the transport layer estimates input tokens, checks configured input/output token caps, estimates cost using the manually entered rate, and checks per-request and monthly limits. After a successful response, it records provider-reported usage if available; otherwise it records an estimate. Local models are not charged against cloud-spend totals, but token caps still apply.

Important limitations:

- Token estimates are approximate (roughly one token per four bytes plus a conservative image allowance).
- Model prices entered by the developer may not match their actual account pricing, discounts, taxes, or regional rates.
- The monthly ledger uses UTC calendar months.
- Providers may bill failed/aborted requests, and not every error response includes usage. PAXI cannot guarantee invoice-level reconciliation.
- Budget settings are local and have no account-wide visibility across devices.
- A per-request/monthly cap requires a price entry for every cloud provider/model used while that cap is enabled.

Use `paxi ai budget clear --confirm` to clear the local usage history while retaining limits and rates.

## 4. Agent plan additions

```bash
paxi doctor agent plan --project . --json
```

The report now includes:

- architecture inventory and relative module graph summary;
- possible cycles, high fan-in/fan-out and unresolved relative references;
- API and state-management markers;
- feedback adaptation by plan area;
- new approval-aware API-contract, state-transition, architecture and dependency-review steps.

The plan remains `plan-only`: no tests, builds, browser/device sessions, patches or other project scripts are run while planning.

## 5. Privacy

Architecture reports contain relative paths and structural metadata but not code text or absolute project paths. Feedback and AI budget data are written to PAXI's local protected configuration directory. Cloud AI requests are still subject to the existing remote-consent, redaction and AI Studio route settings. If an Agent plan is explicitly sent to a remote model, the included architecture summary and feedback aggregates form part of the prompt context and are disclosed by the existing remote approval flow.
