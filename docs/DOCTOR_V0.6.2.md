# PAXI Doctor — V0.6.2 adaptive intelligence update

V0.6.2 builds on the V0.6.1 Doctor foundations. It closes an important adaptive-intelligence loop: explicitly learned project conventions and developer preferences can now shape AI explanations.

## Adaptive context behavior

`paxi ai explain "..." --project <directory>` builds a compact metadata-only context from the local developer profile and the learned profile for that project. It includes preference fields such as guidance style, dependency policy, UI preference and testing style, plus bounded convention fields such as technology labels, package manager, formatter/test tooling, quote style, indentation and semicolon convention. The selected project name is deliberately omitted from the AI context; the project is already identified by the local command working directory or `--project` option.

The context does **not** include source code, environment variables, credentials, absolute filesystem paths, runtime keystrokes or command history. Project convention data is included only while profile learning mode is `explicit`. When learning is `off`, the AI still receives separately configured user preferences, but no learned project conventions.

To omit all preference and convention metadata for one AI explanation:

```bash
paxi ai explain "Explain this compiler error" --no-profile
```

Choose a project other than the current working directory:

```bash
paxi ai explain "Why does this React build fail?" --project ~/projects/example
```

In remote API mode, the approval prompt names the developer preference/project-convention summary as additional data being sent. `--allow-remote` is explicit authorization for the full redacted prompt. `--no-profile` excludes the metadata. Local mode continues to use the configured loopback endpoint.

## Existing Doctor capabilities retained

- Website and React viewport checks through an explicitly installed Playwright dependency.
- Android ADB metadata, screenshot and sanitized UI hierarchy evidence.
- C/C++ toolchain detection and confirmed CMake configure/build workflow.
- Local profile preferences and explicit project learning.
- Read-only Codex MCP tools.
- Reviewed Git patch workflow with clean-tree and confirmation requirements.
- Device Lab run archives, report history and issue-level comparison.

## Limitations

This release does not claim that all supported languages have dedicated build/test adapters. Playwright requires the user to install the Node package and browser. Android evidence requires a connected authorized ADB device or emulator. The MCP server has a protocol-level smoke test; a Codex CLI installation is required to perform the final host-side connection. Screenshot comparison is report/issue comparison, not pixel-level visual diffing. Native iOS runtime testing requires macOS/Xcode or a dedicated iOS testing host.

The AI context is advisory. It must never override correctness, security, accessibility, explicit project instructions or user approval boundaries. It cannot execute commands or modify code on its own.
