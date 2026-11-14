# Security model

- Process invocations use argument arrays and `shell: false`; user-supplied strings are not concatenated into shell commands. Windows batch launchers are invoked through a single-quoted, UTF-16LE PowerShell command encoded as Base64; timeout/cancellation uses `taskkill.exe /T /F` to terminate the complete process tree.
- GitHub authentication is delegated to Git's credential helper, SSH agent or the user's installed `gh` tool. PAXI does not ask users to paste GitHub passwords or tokens.
- AI mode defaults to `off`. Local mode only accepts loopback endpoints. API mode requires HTTPS except loopback development endpoints.
- API keys can be stored in a separate scrypt-derived AES-256-GCM encrypted vault or supplied with provider-specific environment variables. Keys are not persisted in the general PAXI config. Provider API keys and the optional vault-passphrase environment variable are stripped from build/Git/npm child-process environments. The vault passphrase is never stored by PAXI and is required to unlock encrypted keys.
- Remote AI error transfer requires interactive approval or explicit `--allow-remote`. Common credential patterns are redacted first, but this is best-effort and cannot guarantee detection of every secret. Users should inspect and sanitize diagnostic text.
- PAXI sends only the supplied error text to the AI endpoint; it does not automatically upload source files, full projects, build logs, signing material or app artifacts.
- AI responses are advice only. PAXI does not auto-run suggested commands or write AI-generated patches.
- Plugins require explicit trust bound to a SHA-256 digest. Changes invalidate trust. Trusted plugins are arbitrary JavaScript and can access files and processes available to the current user; review code carefully.
- Local JSON reads reject symbolic links; writes use owner-only file permissions and atomic replacement where supported by the host filesystem.
- Release signing material remains inside the user's project/toolchain and should never be committed to Git or pasted into AI prompts. Windows app ZIPs are not Authenticode-signed or strictly signature-verified by PAXI; sign the executable with Microsoft SignTool before public distribution.
- PAXI does not silently upload source code, build logs, signing material or app artifacts.
