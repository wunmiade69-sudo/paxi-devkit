import { detect } from './commands/detect.mjs';
import { build, showBuildHistory } from './commands/build.mjs';
import { aiDoctor, aiSetup, aiConfigure, aiAsk, aiRecommendCommand, explain } from './commands/ai.mjs';
import { aiStudio, aiProvidersCommand, aiKeyCommand, aiModelsCommand, aiRouteCommand, aiProviderCommand, aiLocalCommand } from './ai/studio.mjs';
import { devMenu } from './commands/dev.mjs';
import { gitCommand } from './commands/git.mjs';
import { pluginCommand } from './commands/plugins.mjs';
import { updateCommand } from './commands/update.mjs';
import { taskCommand } from './commands/tasks.mjs';
import { getConfig, setConfigValue } from './lib/config.mjs';
import { configureTermuxAndroid } from './lib/termux.mjs';
import { verifyCommand } from './lib/artifacts.mjs';
import { VERSION } from './lib/version.mjs';
import { doctor as doctorCommand } from './commands/diagnostics.mjs';
import { preflight, setupGuide, environmentJson, createSupportBundle } from './commands/diagnostics.mjs';
import { cacheCommand } from './commands/cache.mjs';
import { doctorProfileCommand, doctorInspectCommand, doctorLabCommand, doctorCppCommand, doctorCodexCommand, doctorPatchCommand, doctorJourneyCommand, doctorVisionCommand, doctorExploreCommand, doctorDiagnoseCommand, doctorTestCommand, doctorVisualCommand, doctorRuntimeCommand, doctorSecurityCommand, doctorApiCommand, doctorDatabaseCommand, doctorCorrelateCommand, doctorTraceCommand, doctorRegressionCommand, doctorObserveCommand, doctorWebsiteCommand } from './commands/doctor-intelligence.mjs';
import { startMcpServer } from './doctor/mcp-server.mjs';
import { doctorAgentCommand } from './commands/doctor-agent.mjs';
import { aiBudgetCommand } from './commands/ai-budget.mjs';
import { doctorCertifyCommand, doctorBenchmarkCommand } from './commands/doctor-assurance.mjs';

function help() {
  console.log(`\nPAXI DevKit ${VERSION} — local-first developer terminal\n
Usage:
  paxi <command> [options]

Core commands:
  dev                              Open the interactive terminal dashboard
  doctor [--json] [--offline]      Check local toolchains and offline caches
  doctor inspect [--project <dir>] Inspect web, React, C/C++, and other project technologies (read-only)
  doctor diagnose [--log <file>] [--ai] Combine project markers and sanitized failures into a diagnosis
  doctor certify [--project <dir>] [--json] [--run-tests --confirm] Inventory capabilities; optionally run the detected test command with explicit consent
  doctor benchmark diagnosis [--json] Measure deterministic diagnosis signatures against synthetic fixtures
  doctor agent status|plan|memory|architecture|feedback  Run the Agent Engine with optional cross-layer reports
  doctor agent memory verified|learn-verified|clear-verified  Inspect or save passing regression knowledge
  doctor test [--confirm] Run the detected project test command only after explicit confirmation
  doctor profile show|set        View or customize local developer preferences
  doctor lab profiles|conditions|plan|run|android|history|compare  Plan or execute and compare website/device checks; run accepts --route
  doctor journey example|draft|validate|run|selectors|from-hierarchy  Build Android journeys and propose privacy-safe UI selectors
  doctor website journey example|validate|run|matrix  Run semantic journeys, private session state, API mocks and browser matrices
  doctor website accessibility --url <url> --confirm  Run axe-core WCAG-related checks across browser viewports
  doctor observe packs|pack show|pack install|validate  Generate setup packs or validate an OTLP collector with a synthetic span
  doctor vision analyze <image>       AI-assisted screenshot review (local-first)
  doctor visual compare <before.png> <after.png>  Pixel-level PNG visual regression comparison
  doctor runtime probe --url <health-url>  Bounded API/backend health probe (loopback by default)
  doctor security scan|tools|audit|sbom|sbom-validate|sbom-schema|licenses|secrets|sast|trivy|contracts|apk|web|api-authz  Security testing and supply-chain review
  doctor api spec|generate-tests|test  Inspect contracts, generate safe plans, or run confirmed GET/HEAD tests
  doctor correlate --report <file>      Build timelines, evidence coverage and investigation cases from API, website, backend, Android and scan reports
  doctor trace create|inspect|spans    Create trace IDs, inspect logs or import local OpenTelemetry spans
  doctor regression draft               Draft reviewed API, website-route and Android journey regression material
  doctor database scan|lab         Review SQL or replay in SQLite, PostgreSQL, MySQL, MariaDB or SQL Server disposable labs
  doctor security npm-audit --online --confirm  Query npm advisories with explicit network consent
  doctor explore --package <id>       Safely explore allowlisted Android navigation
  doctor cpp [--build --confirm]   Check C/C++ tools; compile CMake only with confirmation
  doctor codex [setup|status]      Connect the read-only PAXI Doctor MCP tools to Codex
  doctor patch draft|review|apply  Generate a reviewed AI patch draft, inspect it, and apply only after confirmation
  doctor --json                    Emit structured diagnostics (CI/editor friendly)
  setup                            First-run setup guide; no silent SDK installations
  preflight [--offline] [--json]    Check a project before building
  preflight --offline               Verify local cached dependencies before disconnecting
  env --json                       Print a machine-readable environment report
  cache status|clean               Inspect or explicitly clean local caches
  cache clean --gradle --confirm    Explicitly clear Gradle dependency caches (wrapper preserved)
  support-bundle                   Create a sanitized diagnostics ZIP (review before sharing)
  detect [directory] [--json]      Detect project and explain matching markers
  configure android [options]      Configure an Android project for Termux ARM64
  build [options]                  Build locally for Android, iOS or Windows
  builds [--json|--failed|--diagnose id|--clean]  Inspect or clear local build history
  verify <artifact> [--strict]      Validate package structure and platform checks
  devices                          List adb-connected Android devices
  test [--project <dir>] [--timeout seconds] [--offline]  Run local tests
  plugin disable-all|enable-all     Disable or enable all trusted plugins
  install [app.apk] [--device id] [--strict]  Install an APK (strict mode requires signature + package verification)
  git <action>                     Run safe Git workflows
  ai studio|setup                         Open the AI provider and model hub
  ai providers                            List supported US, China and local providers
  ai key add|remove|status                 Manage encrypted API keys
  ai models catalog|discover|download|pull|installed  Browse and install models
  ai route show|set                       Assign separate models to coding, vision, etc.
  ai ask --role auto                     Select a configured model route from the task intent
  ai recommend --task <text>             Recommend a task route with host resource and budget guidance
  ai budget show|limit|tokens|price|history  Set and enforce local AI token/spend budgets
  ai provider endpoint|use                Configure provider endpoint/model
  ai local status                         Inspect local model runtimes
  ai configure|doctor|explain|ask        Use optional AI assistance
  config show|set <key> <value>     Configure PAXI
  plugin list|trust|revoke|run       Manage local extension modules
  mcp                              Start the read-only PAXI Doctor MCP server over stdio
  update [--check]                  Check for or install a published update
  version                           Print version
  help                              Show this help

Build options:
  --platform android|ios|windows    Target platform (default: android)
  --format apk|aab|ipa|zip          Android: APK/AAB; iOS: IPA; Windows: ZIP app bundle
  --debug|--release                 Build variant (iOS IPA requires --release)
  --project <path>                  Project directory (default: current directory)
  --framework flutter|gradle|xcode  Override project detection
  --scheme <name>                   Native Xcode scheme
  --export-options <path>           Xcode ExportOptions.plist for native iOS IPA
  --install                         Install the APK after a successful build
  --timeout <seconds>               Stop a stuck build (1–86400; default 2700)
  --offline                         Use cached Pub/Gradle dependencies only
  --allow-unverified-release        Explicitly bypass missing release verification tools

Examples:
  paxi build --platform android --format apk --debug
  paxi build --platform android --format aab --release
  paxi build --platform android --format apk --debug --install
  paxi build --platform android --format apk --debug --timeout 3600
  paxi build --platform android --format apk --debug --offline
  paxi test --offline
  paxi preflight --offline
  paxi doctor --json --offline
  paxi doctor inspect --project .
  paxi doctor diagnose --project . --log ./build.log --ai
  paxi doctor certify --project . --json
  paxi doctor certify --project . --run-tests --confirm
  paxi doctor benchmark diagnosis
  paxi doctor agent plan --project . --log ./build.log
  paxi doctor agent memory remember --note "Use existing Zustand store; no new state dependency"
  paxi doctor agent memory learn-verified --evidence ./api-report.json --summary "Endpoint correction verified" --file src/api/route.ts --confirm
  paxi doctor agent architecture --project .
  paxi doctor agent feedback record --decision modified --area testing --note "Require device evidence before calling this verified"
  paxi ai budget limit monthly 5
  paxi ai budget price openai gpt-6.1-sol 2.00 8.00
  paxi doctor test --project .
  paxi doctor test --project . --confirm
  paxi doctor patch draft --description "Fix the null route check" --files src/router.mjs
  paxi doctor cpp --project .
  paxi doctor profile show
  paxi doctor profile learn --project .
  paxi doctor lab run --url http://127.0.0.1:4173 --profiles compact,standard,tablet --conditions font,landscape,dark,keyboard,zoom,offline
  paxi doctor lab run --url http://127.0.0.1:4173 --baseline-dir ./visual-baselines
  paxi doctor lab run --url http://127.0.0.1:4173 --baseline-dir ./visual-baselines --update-baseline --confirm
  paxi doctor visual compare ./visual-baselines/standard-default-portrait-light.png ./current.png
  paxi doctor runtime probe --url http://127.0.0.1:8080/health
  paxi doctor api spec --file ./openapi.json
  paxi doctor api generate-tests --file ./openapi.json --output ./api-smoke.generated.json
  paxi doctor api test --file ./docs/examples/api-smoke-plan.json --confirm
  paxi doctor correlate --report ./api-report.json --report ./website-report.json --output ./investigation.json --json
  paxi doctor trace create
  paxi doctor trace spans --spans ./evidence/otel.json --output ./evidence/spans.json
  paxi doctor api test --file ./api-smoke.generated.json --confirm --trace-id <trace-id> --save-report ./api-report.json
  paxi doctor lab run --url http://127.0.0.1:4173 --trace-id <trace-id>
  paxi doctor regression draft --targets all --plan ./api-smoke.generated.json --evidence ./correlation.json --output ./regression-draft.json
  paxi doctor agent memory learn-verified --evidence ./api-report.json --summary "Verified user endpoint fix" --file src/api/users.ts --confirm
  paxi doctor database scan --project .
  paxi doctor database lab --project . --engine sqlite --migrations migrations --confirm
  paxi doctor database lab --project . --engine postgres --migrations migrations --confirm
  paxi doctor database lab --project . --engine sqlserver --migrations migrations --confirm
  paxi doctor security sbom-validate --file ./paxi-sbom.cdx.json
  paxi doctor security licenses --sbom ./paxi-sbom.cdx.json --policy ./license-policy.json
  paxi doctor security tools
  paxi doctor security audit --scanner osv-scanner --project . --online --confirm
  paxi doctor security sbom --project . --output ./paxi-sbom.cdx.json --confirm
  paxi doctor security scan --project .
  paxi doctor security secrets --project . --confirm
  paxi doctor security sast --project . --rules ./semgrep.yml --confirm
  paxi doctor security trivy --project . --online --confirm
  paxi doctor security contracts --file ./contracts/Token.sol --confirm
  paxi doctor security apk --file ./app-release.apk --confirm
  paxi doctor security web --url http://127.0.0.1:8080 --confirm
  paxi doctor security api-authz --plan ./api-authz-plan.json --confirm
  paxi doctor codex setup
  paxi doctor lab android --package com.example.app --launch --conditions font,dark
  paxi doctor journey example
  paxi doctor website journey example --output ./website-journey.json
  paxi doctor website journey validate --file ./website-journey.json
  paxi doctor observe packs
  paxi doctor observe validate --endpoint http://127.0.0.1:4318/v1/traces --confirm
  paxi doctor observe pack install node-express --project . --confirm
  paxi doctor journey selectors --hierarchy ./ui-hierarchy.xml
  paxi doctor journey draft --goal "tap Settings, then verify About is visible" --output ./journey.json
  paxi doctor journey run --file ./journey.json --package com.example.app --launch
  paxi doctor vision analyze ./screenshots/home.png
  paxi doctor explore --package com.example.app --launch --confirm --max-actions 5
  paxi doctor patch review ./doctor-fix.patch
  paxi doctor profile set guidance step-by-step
  paxi doctor lab plan --profiles compact,standard,tablet --conditions font,dark,keyboard --save responsive-review
  paxi cache status
  paxi support-bundle
  paxi verify ./build/app/outputs/flutter-apk/app-debug.apk --strict
  paxi builds --json
  paxi detect . --json
  paxi ai configure --mode off
  paxi ai configure --mode local --url http://127.0.0.1:8080
  paxi devices
  paxi test
  paxi configure android
  paxi install
  paxi build --platform ios --format ipa --release
  paxi build --platform ios --format ipa --release --scheme MyApp --export-options ExportOptions.plist
  paxi preflight --platform windows --format zip --release
  paxi build --platform windows --format zip --release
  paxi git clone https://github.com/owner/project.git
  paxi git status
  paxi ai explain "build failed" --project . --no-profile
  paxi ai ask --role general "How should I structure my React app?"
  paxi ai recommend --task "Diagnose a Gradle build failure and prepare tests"
  paxi ai configure --mode off
  paxi ai studio
  paxi ai key add deepseek
  paxi ai models catalog
  paxi ai models download qwen35-08b-q4km --confirm
  paxi ai route set coding openai gpt-6.1-sol
  paxi ai route set vision google gemini-3.8-flash

AI privacy:
  AI can be off, local, or API-based. API mode never stores your key in PAXI config.
  Before remote prompts are sent, PAXI asks for approval; --allow-remote is explicit consent.
  AI suggestions never execute commands or edit files automatically.
  Doctor learning runs only on explicit request and stores convention summaries, not source code.
  Vision screenshot analysis requires a configured multimodal model; remote screenshot analysis sends the unredacted image only after explicit approval.
  Android safe exploration taps only an allowlist of navigation labels and requires --confirm; reports never claim full coverage.
  Website Lab runs require Playwright and an already-running site; viewport simulations are not device tests.
  Service database labs require explicit loopback-only admin URLs in PAXI_TEST_POSTGRES_ADMIN_URL, PAXI_TEST_MYSQL_ADMIN_URL or PAXI_TEST_MARIADB_ADMIN_URL; a generated database/user is created and cleanup is attempted.
  SBOM structural validation is not official JSON Schema validation; licence policies are conservative screening, not legal advice.
  CMake builds require --build --confirm because project build files execute project-controlled commands.
  PAXI MCP exposes read-only inspection, profile and plan tools to Codex; it does not apply patches or run builds.

Build privacy:
  Builds run on the current host. iOS requires macOS + Xcode; Windows desktop builds require
  Windows + Visual Studio C++ tools. PAXI does not silently upload projects or switch to a
  cloud builder. Android ARM64 / Flutter support depends on the local toolchain.
`);
}

async function configCommand(args) {
  const [action, key, ...valueParts] = args;
  if (action === 'show') {
    const config = await getConfig();
    console.log({
      aiMode: config.aiMode,
      aiLocalUrl: config.aiLocalUrl,
      aiApiUrl: config.aiMode === 'api' ? config.aiApiUrl : '(hidden while not in API mode)',
      aiProvider: config.aiProvider,
      aiModel: config.aiModel,
      apiKey: process.env.PAXI_AI_API_KEY ? '(available from environment; not stored)' : '(not set)'
    });
    return;
  }
  if (action !== 'set' || !key || !valueParts.length) throw new Error('Usage: paxi config set <ai-mode|ai-local-url|ai-api-url|ai-provider|ai-model> <value>');
  const aliases = { 'ai-mode': 'aiMode', 'ai-local-url': 'aiLocalUrl', 'ai-api-url': 'aiApiUrl', 'ai-provider': 'aiProvider', 'ai-model': 'aiModel' };
  const normalized = aliases[key];
  if (!normalized) throw new Error(`Unknown config key: ${key}`);
  const value = valueParts.join(' ');
  if (normalized === 'aiMode' && !['off', 'local', 'api'].includes(value)) throw new Error('ai-mode must be off, local, or api.');
  if (normalized === 'aiProvider' && value !== 'openai-compatible') throw new Error('The current API adapter supports only openai-compatible. Additional provider adapters are planned.');
  if (normalized === 'aiModel' && (!value.trim() || value.length > 128 || /[\r\n\0]/.test(value))) throw new Error('ai-model must be 1–128 characters without control characters.');
  if (normalized === 'aiLocalUrl') {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) throw new Error('Do not embed credentials, query strings or fragments in the local AI endpoint URL.');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error('Local AI URL must use localhost.');
  }
  if (normalized === 'aiApiUrl') {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) throw new Error('Do not embed credentials, query strings or fragments in the API endpoint URL.');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new Error('Remote API URLs must use HTTPS. HTTP is allowed only for localhost.');
  }
  await setConfigValue(normalized, value);
  console.log(`✓ Saved ${key}.`);
}

export async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help' || command === '-h') return help();
  if (command === 'version' || command === '--version' || command === '-v') return console.log(VERSION);
  if (command === 'dev') return devMenu();
  if (command === 'doctor') {
    if (rest[0] === 'profile') return doctorProfileCommand(rest.slice(1));
    if (rest[0] === 'agent') return doctorAgentCommand(rest.slice(1));
    if (rest[0] === 'inspect') return doctorInspectCommand(rest.slice(1));
    if (rest[0] === 'diagnose') return doctorDiagnoseCommand(rest.slice(1));
    if (rest[0] === 'certify') return doctorCertifyCommand(rest.slice(1));
    if (rest[0] === 'benchmark') return doctorBenchmarkCommand(rest.slice(1));
    if (rest[0] === 'visual') return doctorVisualCommand(rest.slice(1));
    if (rest[0] === 'runtime') return doctorRuntimeCommand(rest.slice(1));
    if (rest[0] === 'security') return doctorSecurityCommand(rest.slice(1));
    if (rest[0] === 'api') return doctorApiCommand(rest.slice(1));
    if (rest[0] === 'database') return doctorDatabaseCommand(rest.slice(1));
    if (rest[0] === 'correlate') return doctorCorrelateCommand(rest.slice(1));
    if (rest[0] === 'trace') return doctorTraceCommand(rest.slice(1));
    if (rest[0] === 'regression') return doctorRegressionCommand(rest.slice(1));
    if (rest[0] === 'observe') return doctorObserveCommand(rest.slice(1));
    if (rest[0] === 'website') return doctorWebsiteCommand(rest.slice(1));
    if (rest[0] === 'test') return doctorTestCommand(rest.slice(1));
    if (rest[0] === 'lab') return doctorLabCommand(rest.slice(1));
    if (rest[0] === 'journey') return doctorJourneyCommand(rest.slice(1));
    if (rest[0] === 'vision') return doctorVisionCommand(rest.slice(1));
    if (rest[0] === 'explore') return doctorExploreCommand(rest.slice(1));
    if (rest[0] === 'cpp') return doctorCppCommand(rest.slice(1));
    if (rest[0] === 'codex') return doctorCodexCommand(rest.slice(1));
    if (rest[0] === 'patch') return doctorPatchCommand(rest.slice(1));
    const json = rest.includes('--json');
    const offline = rest.includes('--offline');
    const fix = rest.includes('--fix');
    let projectPath = null;
    for (let i = 0; i < rest.length; i += 1) {
      if (['--json', '--offline', '--fix'].includes(rest[i])) continue;
      if (rest[i] === '--project' && rest[i + 1] && !rest[i + 1].startsWith('--')) projectPath = rest[++i];
      else throw new Error('Usage: paxi doctor [--json] [--offline] [--project <dir>] [--fix]');
    }
    if (fix) return setupGuide();
    const report = await doctorCommand({ json, offline, projectPath });
    if (offline && !report.offlineReady) process.exitCode = report.offlineExitCode || 12;
    else if (!report.ready) process.exitCode = report.host.supported ? 11 : 10;
    return report;
  }
  if (command === 'mcp') {
    if (rest.length) throw new Error('Usage: paxi mcp');
    return startMcpServer();
  }
  if (command === 'setup') return setupGuide();
  if (command === 'env') {
    if (rest.length !== 1 || rest[0] !== '--json') throw new Error('Usage: paxi env --json');
    return environmentJson();
  }
  if (command === 'preflight') {
    let offline = false; let json = false; let projectPath = process.cwd(); let variant = 'debug'; let format = null; let platform = 'android';
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '--offline') offline = true;
      else if (rest[i] === '--json') json = true;
      else if (rest[i] === '--release') variant = 'release';
      else if (rest[i] === '--debug') variant = 'debug';
      else if (rest[i] === '--format' && rest[i + 1] && !rest[i + 1].startsWith('--')) format = rest[++i];
      else if (rest[i] === '--platform' && rest[i + 1] && !rest[i + 1].startsWith('--')) platform = rest[++i];
      else if (rest[i] === '--project' && rest[i + 1] && !rest[i + 1].startsWith('--')) projectPath = rest[++i];
      else throw new Error('Usage: paxi preflight [--platform android|ios|windows] [--format apk|aab|ipa|zip] [--offline] [--json] [--project <dir>] [--debug|--release]');
    }
    format ||= platform === 'windows' ? 'zip' : platform === 'ios' ? 'ipa' : 'apk';
    if (!['android', 'ios', 'windows'].includes(platform)) throw new Error('--platform must be android, ios or windows.');
    const validFormats = { android: ['apk', 'aab'], ios: ['ipa'], windows: ['zip'] };
    if (!validFormats[platform].includes(format)) throw new Error(`--format ${format} is invalid for ${platform} preflight.`);
    const result = await preflight({ offline, json, projectPath, variant, format, platform });
    if (!result.ready) process.exitCode = result.exitCode;
    return result;
  }
  if (command === 'cache') return cacheCommand(rest);
  if (command === 'support-bundle') {
    let projectPath = process.cwd(); let outputPath = null;
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '--project' && rest[i + 1]) projectPath = rest[++i];
      else if (rest[i] === '--output' && rest[i + 1]) outputPath = rest[++i];
      else throw new Error('Usage: paxi support-bundle [--project <dir>] [--output <file.zip>]');
    }
    return createSupportBundle({ projectPath, outputPath });
  }
  if (command === 'detect') {
    const json = rest.includes('--json');
    const paths = rest.filter((part) => part !== '--json');
    if (paths.length > 1) throw new Error('Usage: paxi detect [directory] [--json]');
    return detect(paths[0], { json });
  }
  if (command === 'configure') {
    const [target, ...options] = rest;
    if (target !== 'android') throw new Error('Usage: paxi configure android [--project <directory>]');
    let projectPath = process.cwd();
    for (let i = 0; i < options.length; i += 1) {
      if (options[i] === '--project' && options[i + 1] && !options[i + 1].startsWith('--')) projectPath = options[++i];
      else throw new Error('Usage: paxi configure android [--project <directory>]');
    }
    return configureTermuxAndroid({ projectPath });
  }
  if (command === 'build') {
    let projectPath = process.cwd();
    let variant = 'debug';
    let frameworkOverride = null;
    let format = 'apk';
    let platform = 'android';
    let exportOptions = null;
    let scheme = null;
    let installAfterBuild = false;
    let timeoutMs = 45 * 60 * 1000;
    let offline = false;
    let allowUnverifiedRelease = false;
    const valueOptions = new Set(['--project', '--framework', '--format', '--platform', '--scheme', '--export-options', '--timeout']);
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === '--release') variant = 'release';
      else if (arg === '--offline') offline = true;
      else if (arg === '--allow-unverified-release') allowUnverifiedRelease = true;
      else if (arg === '--debug') variant = 'debug';
      else if (arg === '--install') installAfterBuild = true;
      else if (arg === '--aab') format = 'aab';
      else if (valueOptions.has(arg)) {
        const value = rest[i + 1];
        if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
        i += 1;
        if (arg === '--project') projectPath = value;
        else if (arg === '--framework') frameworkOverride = value;
        else if (arg === '--format') format = value;
        else if (arg === '--platform') platform = value;
        else if (arg === '--scheme') scheme = value;
        else if (arg === '--export-options') exportOptions = value;
        else if (arg === '--timeout') {
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 86400) throw new Error('--timeout must be an integer between 1 and 86400 seconds.');
          timeoutMs = Number(value) * 1000;
        }
      } else throw new Error(`Unknown build option: ${arg}`);
    }
    if (frameworkOverride && !['flutter', 'gradle', 'xcode'].includes(frameworkOverride)) throw new Error('--framework must be flutter, gradle, or xcode.')
    if (installAfterBuild && (platform !== 'android' || format !== 'apk')) throw new Error('--install can only be used with an Android APK build.');
    const result = await build({ projectPath, variant, format, frameworkOverride, platform, exportOptions, scheme, timeoutMs, offline, allowUnverifiedRelease });
    if (installAfterBuild) await taskCommand('install', [result.artifact]);
    return result;
  }
  if (command === 'builds') return showBuildHistory(rest);
  if (command === 'verify') return verifyCommand(rest);
  if (command === 'devices') return taskCommand('devices');
  if (command === 'test' || command === 'install') return taskCommand(command, rest);
  if (command === 'git') return gitCommand(rest);
  if (command === 'plugin') return pluginCommand(rest);
  if (command === 'update') return updateCommand(rest);
  if (command === 'ai') {
    const [subcommand, ...content] = rest;
    if (subcommand === 'setup' || subcommand === 'studio') return aiStudio();
    if (subcommand === 'providers') return aiProvidersCommand();
    if (subcommand === 'key') return aiKeyCommand(content);
    if (subcommand === 'models') return aiModelsCommand(content);
    if (subcommand === 'route') return aiRouteCommand(content);
    if (subcommand === 'provider') return aiProviderCommand(content);
    if (subcommand === 'local') return aiLocalCommand(content);
    if (subcommand === 'recommend') return aiRecommendCommand(content);
    if (subcommand === 'budget') return aiBudgetCommand(content);
    if (subcommand === 'configure') return aiConfigure(content);
    if (subcommand === 'doctor') return aiDoctor();
    if (subcommand === 'explain' || subcommand === 'ask') {
      const allowRemote = content.includes('--allow-remote');
      const includeProfile = !content.includes('--no-profile');
      const autoRole = content.includes('--auto');
      let projectPath = process.cwd();
      let role = autoRole ? 'auto' : 'general';
      const promptParts = [];
      for (let index = 0; index < content.length; index += 1) {
        if (['--allow-remote', '--no-profile', '--auto'].includes(content[index])) continue;
        if (content[index] === '--role' && content[index + 1] && !content[index + 1].startsWith('--')) { role = content[++index]; continue; }
        if (content[index] === '--project' && content[index + 1] && !content[index + 1].startsWith('--')) {
          projectPath = content[++index];
          continue;
        }
        promptParts.push(content[index]);
      }
      if (subcommand === 'explain') return explain(promptParts.join(' '), { allowRemote, includeProfile, projectPath });
      return aiAsk(promptParts.join(' '), { role, allowRemote, includeProfile, projectPath });
    }
    throw new Error('Usage: paxi ai <studio|providers|key|models|route|provider|local|budget|configure|doctor|explain|ask> [options]');
  }
  if (command === 'config') return configCommand(rest);
  throw new Error(`Unknown command: ${command}. Run paxi help.`);
}
