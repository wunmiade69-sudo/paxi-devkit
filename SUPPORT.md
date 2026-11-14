# Support

Start with the versioned documentation in `README.md` and `docs/`, especially `docs/TERMUX_ANDROID.md`, `docs/RELEASE_RUNBOOK.md`, and the relevant platform guide. Run `paxi doctor --json` and, when appropriate, `paxi preflight --offline` before opening a support request.

Use GitHub Issues for reproducible bugs and feature requests. Remove API keys, tokens, passwords, keystores, private paths, customer data, and other sensitive information from commands and logs. Use the private process in `SECURITY.md` for vulnerabilities; do not disclose security issues in a public issue.

PAXI coordinates local tools but does not ship Flutter, Android SDKs, Xcode, Visual Studio, signing credentials, or a remote build service. Platform-specific failures may therefore require the upstream toolchain's documentation as well as PAXI diagnostics. Android/Termux support is currently focused on ARM64, and Windows Flutter integration requires a real Windows host.

When sharing diagnostics, generate a support bundle only if the command is available, inspect the archive manually, and redact anything private before uploading it. Support is provided on a best-effort basis; no uptime or build-success guarantee is made for third-party projects and toolchains.
