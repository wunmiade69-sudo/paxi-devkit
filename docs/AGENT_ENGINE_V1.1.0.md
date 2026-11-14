# PAXI Agent Engine V1.1.0

V1.1.0 connects read-only project inspection, evidence-based diagnosis, project-specific local notes, model-route recommendations and optional screenshot review into one engineering plan.

## Agent status

```bash
paxi doctor agent status
```

Shows a host resource snapshot and the count of manually saved notes for the current project. The OS memory figures are host-level estimates; they may not represent Android process limits or model-specific VRAM/context needs.

## Plan a project QA workflow

```bash
paxi doctor agent plan --project .
paxi doctor agent plan --project . --log ./build.log
paxi doctor agent plan --project . --screenshot ./screenshots/home.png
paxi doctor agent plan --project . --log ./build.log --screenshot ./screenshots/home.png --ai
```

The plan combines project markers, known failure signatures, a preview of a conventional test command, detected project categories, explicitly saved notes and a role-specific model recommendation. The optional screenshot path adds AI visual review with a bounded diagnosis summary. This is a plan and review workflow; it does not execute the suggested tests, launch a browser, tap a device, build the project or edit source.

When a remote vision model is selected, the screenshot is sent unredacted only after interactive approval or explicit `--allow-remote`. The approval warns that the image may contain private information and that the bounded project diagnosis summary is included. The summary contains project metadata and sanitized finding excerpts, not source files.

The optional `--ai` review sends the plan and, by default, explicitly saved project notes to the selected model. For privacy, use `--no-memory` to omit saved notes and `--no-profile` to omit developer profile metadata. Remote approval identifies included project memory.

## Local project memory

Memory is separate from convention learning. Existing convention learning stores aggregate technology/tool/style observations. Agent memory stores short notes typed by the developer.

```bash
paxi doctor agent memory remember --note "Use the existing Zustand store; do not add a state dependency"
paxi doctor agent memory show
paxi doctor agent memory forget <note-id>
paxi doctor agent memory clear --confirm
```

Notes are local-only, bounded to 800 characters, scoped to a project fingerprint, stored in a protected config file and passed through common credential-pattern redaction. Redaction is best-effort; do not store passwords, private customer information, recovery phrases or other secrets. The memory store never copies source files.

## Model recommendation

```bash
paxi ai recommend --task "Debug this Android Gradle build failure"
paxi ai recommend --task "Review screenshots for responsive overflow" --json
```

The selector classifies intent into the configured general/coding/vision/journey routes, estimates task complexity from bounded text signals and reports CPU architecture, core count and currently free/total host memory. It warns about tight memory for local models. It does not infer exact model RAM/VRAM requirements, does not claim provider pricing, and does not silently change a configured provider. Cloud calls may incur charges; verify current pricing and your account settings with the provider.

## Safety boundaries

- The Agent Engine creates plans, not autonomous execution. Every test command, browser run, Android journey, build and code patch retains its separate explicit confirmation.
- AI diagnosis is advisory and distinguishes findings from hypotheses. It does not prove root cause.
- The screenshot is not redacted; inspect it before remote analysis.
- Project memory is entered explicitly by the developer and can be reviewed or deleted.
- A passing test command covers only that command; it is not a security audit or release certification.
