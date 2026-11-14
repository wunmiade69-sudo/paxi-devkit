# PAXI AI Studio — V0.9.0

PAXI AI Studio is the provider, credentials and model management layer for PAXI DevKit. It replaces the previous single-model, environment-variable-only setup with a role-based AI configuration while preserving the legacy `paxi ai configure` command.

## What it represents

PAXI can route different tasks to different models. The user remains in control of provider, model, endpoint, credentials, privacy approval and local downloads.

Task roles:

- `general`: general questions and developer guidance.
- `coding`: compiler/build diagnosis and code reasoning.
- `vision`: screenshot review; selected model must support image input.
- `journey`: planning and interpreting automated test journeys.

A role uses its explicit route first, then the general route, then the legacy single-model configuration. `paxi ai configure --mode off` disables all routes.

## Provider catalogue

| Provider ID | Service | Category / region label | Protocol |
|---|---|---|---|
| `openai` | OpenAI | Cloud / US-oriented | OpenAI Chat Completions |
| `anthropic` | Claude | Cloud / US-oriented | Anthropic Messages |
| `google` | Gemini | Cloud / US-oriented | Gemini generateContent |
| `deepseek` | DeepSeek | Cloud / China-based | OpenAI-compatible |
| `qwen` | Alibaba Model Studio / Qwen | Cloud / China and regional endpoints | OpenAI-compatible |
| `kimi` | Moonshot / Kimi | Cloud / China and international endpoints | OpenAI-compatible |
| `zhipu` | Zhipu / GLM | Cloud / China-based | OpenAI-compatible |
| `ollama` | Ollama | Local runtime | OpenAI-compatible local endpoint |
| `llamacpp` | llama.cpp server | Local runtime | OpenAI-compatible local endpoint |
| `custom` | Custom service | User-defined | OpenAI-compatible |

Region labels identify provider origin or default routing only. They do not promise data residency, storage location or legal jurisdiction. The selected account, endpoint, workspace and provider policy determine where processing occurs. Users must verify their own provider region and terms. Alibaba Model Studio API keys are region-specific and must match their endpoint; use `paxi ai provider endpoint qwen <https-url>` to select the account’s regional or workspace-specific endpoint. Singapore, China (Beijing), US (Virginia), and other region offerings may use different endpoint/key pairs.

Cloud defaults and model suggestions are initial values, not a guarantee that a model is enabled for every account. Use live discovery. Provider model IDs change over time; the listed starters are examples and discovery is authoritative. The `custom` provider supports HTTPS OpenAI-compatible gateways and requires an explicit endpoint.

## Provider and model commands

```bash
paxi ai studio
paxi ai providers
paxi ai provider endpoint custom https://your-provider.example/v1
paxi ai models discover openai
paxi ai models discover qwen
paxi ai route set coding openai gpt-6.1-sol
paxi ai route set coding deepseek deepseek-flash
paxi ai route set vision google gemini-3.8-flash
paxi ai route show
paxi ai ask --role coding "Review this error"
```

Use `paxi ai ask --role general|coding|vision|journey "..."` for a model prompt using the selected task route. The `journey` role prepares review-only plans; it does not trigger Android taps or execute the draft. The current `paxi doctor journey draft` command remains deterministic and does not automatically invoke the journey AI route. AI Studio remains open until the user selects Exit; its route test option sends a short prompt through the selected task role and still requires remote-transfer approval for cloud providers.

The API integration includes:

- OpenAI-compatible JSON request/response support for OpenAI, DeepSeek, Qwen, Kimi, Zhipu, Ollama, llama.cpp and custom gateways.
- Anthropic `POST /v1/messages` with `x-api-key` and the `anthropic-version` header.
- Gemini `models/{model}:generateContent` with the `x-goog-api-key` header.
- Provider-native model discovery for OpenAI-compatible `/models`, Anthropic `/v1/models`, Gemini `/v1beta/models` and Ollama `/api/tags`.

Responses are bounded before JSON parsing. Cloud providers require HTTPS. HTTP endpoints are permitted only for explicitly local loopback runtimes.

## Encrypted key vault

Add a key using hidden input:

```bash
paxi ai key add openai
paxi ai key add deepseek
paxi ai key status
paxi ai key remove deepseek
```

Vault design:

- API keys are never stored in `config.json` or printed by the CLI.
- A separate `ai-vault.json` stores only AES-256-GCM encrypted key data and non-secret provider IDs.
- A 256-bit encryption key is derived from the user's passphrase using scrypt; every vault record has a random salt and 96-bit IV and authenticated tag.
- Vault and configuration files use owner-only permissions where supported.
- The passphrase is prompted with hidden terminal input and is not saved. For deliberate non-interactive use, `PAXI_AI_VAULT_PASSPHRASE` can unlock the vault for that process; PAXI removes it from child-process environments. Avoid exporting it globally.
- Environment variables override encrypted vault entries.
- Provider keys and vault passphrases are stripped from child-process environments.

Passphrases must be at least 10 characters. A lost passphrase cannot be recovered. Keep your own secure recovery record; do not put the passphrase in a project or repository. The vault is protected at rest, not hardware-backed. A compromised, unlocked device or malicious local process can still access a key while it is in use.

Supported environment variables:

| Provider | Environment variable |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Gemini | `GEMINI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| Qwen / Model Studio | `BAILIAN_API_KEY` (also accepts legacy `DASHSCOPE_API_KEY`) |
| Kimi / Moonshot | `MOONSHOT_API_KEY` |
| Zhipu / GLM | `ZHIPUAI_API_KEY` |
| Legacy/custom | `PAXI_AI_API_KEY` |

## Local model library

`paxi ai models catalog` shows the starter catalogue.

### GGUF model download

```bash
paxi ai models download qwen35-08b-q4km --confirm
```

PAXI downloads a single curated GGUF file from the listed Hugging Face repository. It does not download a whole repository. Before transferring weights it obtains file metadata and requires a SHA-256 object ID. It verifies:

1. HTTPS metadata and download responses.
2. File size and configured maximum size.
3. Available disk space.
4. GGUF magic header.
5. Exact byte count.
6. SHA-256 digest against repository metadata.

Incomplete or mismatched files are removed and never installed. Model downloads require `--confirm`, and existing files are not overwritten.

The Qwen 3.5 0.8B Q4_K_M starter file is a community GGUF quantization by `bartowski`, not a file served by Alibaba. The catalogue records the model card and licence note. Read the upstream model card and licence before use. The DeepSeek R1 1.5B GGUF option is also a community quantization; it is not represented as an official DeepSeek-published GGUF file.

### Ollama pulls

```bash
paxi ai models pull qwen3.5:0.8b --confirm
paxi ai models pull qwen3.5:2b --confirm
paxi ai models pull deepseek-r1:1.5b --confirm
paxi ai models installed
```

The AI Studio menu stays open until you choose Exit. It supports an optional route test that sends a short prompt through the selected task role. Cloud route tests still require approval or the explicit `--allow-remote` option on the CLI.

Ollama must already be installed and running. PAXI does not install the runtime or silently start downloads. Pulls can be large and use network data. The CLI only permits the reviewed starter IDs in this release.

### Run downloaded GGUF with llama.cpp

Install a compatible llama.cpp build for your operating system and architecture, then run:

```bash
llama-server -m "$HOME/.local/share/paxi/models/Qwen3.5-0.8B-Q4_K_M.gguf" --host 127.0.0.1 --port 8080
paxi ai route set general llamacpp local-model
paxi ai local status
paxi ai ask --role general "Reply with a short connection test"
```

The local runtime is not bundled. Android/Termux users may need to compile a compatible llama.cpp version themselves. Ollama support is host-dependent and is not promised on every Android device. Small parameter-count models have lower capability; runtime RAM needs can be higher than the GGUF file size and grow with context length.

For Ollama:

```bash
ollama serve
paxi ai route set general ollama qwen3.5:0.8b
```

## Privacy and safety

- Cloud prompts leave the device only after an interactive approval or `--allow-remote`.
- Diagnostic text is redacted before remote explanation; automated redaction is best-effort.
- `--no-profile` excludes adaptive developer/project preference metadata.
- Cloud vision transfers unredacted screenshot images and requires separate explicit approval. Screenshots may contain account or personal information.
- API keys are sent only to the selected provider endpoint over HTTPS and are not included in model URLs or request text.
- PAXI never claims cloud provider data residency from its country label.
- AI responses are suggestions, not verified test results. Review generated recommendations before applying.

## CLI reference

```text
paxi ai studio
paxi ai providers
paxi ai key add <provider>
paxi ai key remove <provider>
paxi ai key status
paxi ai models catalog
paxi ai models discover <provider>
paxi ai models download <catalog-id> --confirm
paxi ai models pull <ollama-model> --confirm
paxi ai models installed
paxi ai route show
paxi ai route set <role> <provider> <model>
paxi ai provider endpoint <provider> <https-url>
paxi ai provider use <provider> <model>
paxi ai local status
paxi ai doctor
paxi ai explain <diagnostics> [--allow-remote] [--no-profile]
paxi ai ask --role <general|coding|vision|journey> <prompt> [--allow-remote] [--no-profile]
```

## Upstream references

- OpenAI API models and Chat Completions parameters: https://developers.openai.com/api/docs/models and https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Anthropic API overview: https://platform.claude.com/docs/en/api/overview
- Gemini API models: https://ai.google.dev/gemini-api/docs/models
- DeepSeek API: https://api-docs.deepseek.com/api/create-chat-completion/
- Alibaba Model Studio / Qwen models and regional base URLs: https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen and https://www.alibabacloud.com/help/en/model-studio/base-url
- Kimi API overview: https://www.kimi.ai/help/kimi-api/api-overview
- Ollama Qwen 3.5 model library: https://ollama.com/library/qwen3.5
- GGUF starter model card: https://huggingface.co/bartowski/Qwen_Qwen3.5-0.8B-GGUF

## Upstream model references

The catalogue's starter IDs are refreshed against the upstream providers and are examples only. Run `paxi ai models discover <provider>` to query the models enabled for your own account. Check the upstream documentation before production deployment:

- [OpenAI model catalogue](https://developers.openai.com/api/docs/models)
- [Anthropic Claude model IDs](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)
- [Google Gemini model catalogue](https://ai.google.dev/gemini-api/docs/models)
- [DeepSeek model-list API](https://api-docs.deepseek.com/api/list-models/)
- [Alibaba Cloud Model Studio / Qwen](https://www.alibabacloud.com/help/en/model-studio/qwen-code.md)
- [Moonshot Kimi model selection](https://www.kimi.ai/help/kimi-api/api-model-selection)
- [Ollama Qwen 3.5 model tags](https://ollama.com/library/qwen3.5/tags)
- [Ollama DeepSeek R1 model tags](https://ollama.com/library/deepseek-r1/tags)

Provider APIs, model IDs, regional endpoints, availability, pricing and terms can change independently of PAXI releases. Live model discovery and the provider's own documentation take precedence over bundled starter suggestions.
