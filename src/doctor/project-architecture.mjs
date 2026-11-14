import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'build', 'dist', 'coverage', '.dart_tool', '.gradle', 'target', '.next', '.expo', 'Pods', 'DerivedData']);
const SOURCE_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx|vue|svelte|css|scss|html|py|cpp|cc|cxx|hpp|hh|hxx|h|c|java|kt|dart|go|rs|php|cs|sol|swift)$/i;
const MAX_FILES = 1400;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_EDGES = 2500;

function normalize(value) { return value.split(path.sep).join('/').replace(/^\.\//, ''); }
function unique(values) { return [...new Set(values)]; }

async function collectFiles(root) {
  const files = [];
  let truncated = false;
  let totalBytes = 0;
  async function visit(dir, depth) {
    if (depth > 8 || files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) { truncated = true; return; }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) { truncated = true; break; }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await visit(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        const full = path.join(dir, entry.name);
        const stat = await fs.lstat(full).catch(() => null);
        if (stat?.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_FILE_BYTES) {
          if (totalBytes + stat.size > MAX_TOTAL_BYTES) { truncated = true; break; }
          files.push({ full, relative: normalize(path.relative(root, full)), size: stat.size });
          totalBytes += stat.size;
        }
      }
    }
  }
  await visit(root, 0);
  return { files, truncated, totalBytes };
}

function importSpecifiers(source, file) {
  const specs = [];
  const ext = path.extname(file).toLowerCase();
  if (/\.(?:js|jsx|mjs|cjs|ts|tsx|vue|svelte)$/.test(ext)) {
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g)) specs.push(match[1]);
    for (const match of source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(match[1]);
  } else if (ext === '.py') {
    for (const match of source.matchAll(/^\s*from\s+([.\w]+)\s+import\s+/gm)) specs.push(`py:${match[1]}`);
    for (const match of source.matchAll(/^\s*import\s+([\w.]+)/gm)) specs.push(`py:${match[1]}`);
  } else if (['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'].includes(ext)) {
    for (const match of source.matchAll(/^\s*#\s*include\s*["<]([^">]+)[">]/gm)) if (match[0].includes('"')) specs.push(`native:${match[1]}`);
  } else if (ext === '.rs') {
    for (const match of source.matchAll(/^\s*mod\s+([A-Za-z_][\w]*)\s*;/gm)) specs.push(`rs:${match[1]}`);
  } else if (ext === '.css' || ext === '.scss') {
    for (const match of source.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) specs.push(match[1]);
  } else if (ext === '.dart') {
    for (const match of source.matchAll(/\b(?:import|export|part)\s+['"]([^'"]+)['"]/g)) if (match[1].startsWith('.')) specs.push(match[1]);
  }
  return unique(specs).slice(0, 80);
}

function resolveRelative(from, spec, known) {
  if (spec.startsWith('py:')) {
    const module = spec.slice(3).replace(/^\.+/, '').replaceAll('.', '/');
    const candidates = [`${module}.py`, `${module}/__init__.py`];
    return candidates.find((item) => known.has(item)) || null;
  }
  if (spec.startsWith('rs:')) {
    const base = path.posix.dirname(from);
    const name = spec.slice(3);
    return [`${base}/${name}.rs`, `${base}/${name}/mod.rs`, `${name}.rs`, `src/${name}.rs`].map(normalize).find((item) => known.has(item)) || null;
  }
  if (spec.startsWith('native:')) {
    const candidate = normalize(path.posix.join(path.posix.dirname(from), spec.slice(7)));
    return known.has(candidate) ? candidate : null;
  }
  if (!spec.startsWith('.')) return null;
  const base = normalize(path.posix.join(path.posix.dirname(from), spec));
  const candidates = [base, ...['.js','.jsx','.mjs','.cjs','.ts','.tsx','.vue','.svelte','.css','.scss','.html','.py','.dart','.h','.hpp','.cpp'].map((ext) => `${base}${ext}`), ...['index.js','index.jsx','index.ts','index.tsx','index.mjs','index.ts','__init__.py'].map((name) => `${base}/${name}`)];
  return candidates.find((item) => known.has(item)) || null;
}

function hasAny(source, patterns) { return patterns.some((pattern) => pattern.test(source)); }

function detectMarkers(sources) {
  const combined = sources.map((item) => item.source).join('\n');
  const apiMarkers = [];
  const stateMarkers = [];
  const apiRules = [
    ['fetch', /\bfetch\s*\(/g], ['axios', /\baxios\s*\./g], ['express-route', /\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/g],
    ['fastapi-route', /@app\.(?:get|post|put|patch|delete)\s*\(/g], ['spring-mapping', /@(?:Get|Post|Put|Delete|Request)Mapping\b/g],
    ['graphql', /\b(?:gql|GraphQLSchema|ApolloServer)\b/g], ['websocket', /\bWebSocket\s*\(/g], ['rpc', /\b(?:grpc|trpc|createTRPC)\b/g]
  ];
  const stateRules = [
    ['react-state', /\b(?:useState|useReducer|useSyncExternalStore)\s*\(/g], ['redux', /\b(?:createSlice|configureStore|useSelector|useDispatch)\s*\(/g],
    ['zustand', /\b(?:create\s*\(|useStore)\s*\(/g], ['flutter-state', /\b(?:Bloc|Cubit|ChangeNotifier|ValueNotifier|StatefulWidget)\b/g],
    ['vue-state', /\b(?:ref|reactive|computed)\s*\(/g], ['context-provider', /\b(?:createContext|Provider)\b/g], ['state-machine', /\b(?:createMachine|useMachine|XState)\b/g]
  ];
  for (const [name, rule] of apiRules) { const count = [...combined.matchAll(rule)].length; if (count) apiMarkers.push({ name, count }); }
  for (const [name, rule] of stateRules) { const count = [...combined.matchAll(rule)].length; if (count) stateMarkers.push({ name, count }); }
  return { apiMarkers, stateMarkers };
}

function detectEntrypoints(files, known) {
  const preferred = /^(?:src\/)?(?:main|index|app|server|cli|program|bootstrap)\.(?:js|jsx|mjs|cjs|ts|tsx|py|cpp|cc|c|dart|go|rs|java|kt|swift)$/i;
  const exact = new Set(['index.html', 'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js', 'src/main.dart', 'lib/main.dart', 'src/main.rs', 'src/main.py', 'cmd/main.go', 'src/main.cpp']);
  return files.filter((file) => exact.has(file) || preferred.test(file) || /(^|\/)(?:main|index|server|app)\.(?:py|go|rs)$/i.test(file) || /(^|\/)Program\.cs$/i.test(file)).slice(0, 100);
}

function findCycles(adjacency, maxCycles = 40) {
  const visiting = new Set(); const visited = new Set(); const stack = []; const cycles = [];
  function visit(node) {
    if (cycles.length >= maxCycles || visited.has(node)) return;
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) cycles.push([...stack.slice(start), node]);
      return;
    }
    visiting.add(node); stack.push(node);
    for (const next of adjacency.get(node) || []) visit(next);
    stack.pop(); visiting.delete(node); visited.add(node);
  }
  for (const node of adjacency.keys()) { visit(node); if (cycles.length >= maxCycles) break; }
  return cycles;
}

export async function analyzeProjectArchitecture(projectPath = process.cwd()) {
  const root = path.resolve(projectPath);
  const rootInfo = await fs.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Architecture analysis requires a real, non-symlink project directory.');
  const { files, truncated, totalBytes } = await collectFiles(root);
  const known = new Set(files.map((item) => item.relative));
  const sources = [];
  for (const file of files) {
    const source = await fs.readFile(file.full, 'utf8').catch(() => null);
    if (source !== null) sources.push({ path: file.relative, source, bytes: file.size });
  }
  const nodes = sources.map((item) => ({ path: item.path, bytes: item.bytes, imports: [] }));
  const adjacency = new Map(nodes.map((node) => [node.path, []]));
  const edges = []; const unresolvedRelative = [];
  for (const item of sources) {
    for (const spec of importSpecifiers(item.source, item.path)) {
      const target = resolveRelative(item.path, spec, known);
      if (target) {
        adjacency.get(item.path)?.push(target);
        if (edges.length < MAX_EDGES) edges.push({ from: item.path, to: target, kind: spec.startsWith('native:') ? 'include' : 'import' });
      } else if (spec.startsWith('.') || spec.startsWith('py:') || spec.startsWith('rs:') || spec.startsWith('native:')) {
        if (unresolvedRelative.length < 100) unresolvedRelative.push({ from: item.path, reference: spec });
      }
    }
  }
  for (const node of nodes) node.imports = unique(adjacency.get(node.path) || []).slice(0, 80);
  const fanIn = new Map(nodes.map((node) => [node.path, 0]));
  for (const targets of adjacency.values()) for (const target of targets) fanIn.set(target, (fanIn.get(target) || 0) + 1);
  const highFanIn = [...fanIn.entries()].filter(([, count]) => count >= 4).sort((a,b) => b[1]-a[1]).slice(0,20).map(([file, count]) => ({ file, count }));
  const highFanOut = nodes.filter((node) => node.imports.length >= 8).sort((a,b) => b.imports.length-a.imports.length).slice(0,20).map((node) => ({ file: node.path, count: node.imports.length }));
  const cycles = findCycles(adjacency);
  const markers = detectMarkers(sources);
  const manifestCandidates = ['package.json','pnpm-lock.yaml','yarn.lock','package-lock.json','bun.lock','bun.lockb','pyproject.toml','requirements.txt','Cargo.toml','go.mod','composer.json','pom.xml','build.gradle','build.gradle.kts','CMakeLists.txt','foundry.toml','hardhat.config.js','hardhat.config.ts','Gemfile','mix.exs'];
  const manifests = [];
  for (const name of manifestCandidates) {
    const info = await fs.lstat(path.join(root, name)).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink()) manifests.push(name);
  }
  const packageFile = path.join(root, 'package.json');
  const packageInfo = await fs.lstat(packageFile).catch(() => null);
  const packageJsonSource = packageInfo?.isFile() && !packageInfo.isSymbolicLink() && packageInfo.size <= MAX_FILE_BYTES ? await fs.readFile(packageFile, 'utf8').catch(() => null) : null;
  let dependencyInventory = {};
  try {
    const parsed = packageJsonSource ? JSON.parse(packageJsonSource) : {};
    dependencyInventory = { direct: Object.keys({ ...parsed.dependencies, ...parsed.devDependencies }).slice(0, 250), scripts: Object.keys(parsed.scripts || {}).slice(0, 80) };
  } catch { dependencyInventory = { direct: [], scripts: [], parseError: true }; }
  const fingerprint = createHash('sha256').update(nodes.map((node) => `${node.path}:${node.bytes}`).join('\n')).digest('hex').slice(0, 20);
  const findings = [];
  if (cycles.length) findings.push({ code: 'possible-import-cycles', severity: 'warning', count: cycles.length, recommendation: 'Review circular internal imports; confirm whether they create initialization or coupling problems.' });
  if (highFanOut.length) findings.push({ code: 'high-fan-out-modules', severity: 'info', count: highFanOut.length, recommendation: 'Review high-dependency modules for responsibilities that could be separated without unnecessary refactoring.' });
  if (unresolvedRelative.length) findings.push({ code: 'unresolved-relative-imports', severity: 'info', count: unresolvedRelative.length, recommendation: 'Check unresolved local references; some may use aliases or dynamic resolution that this static mapper does not understand.' });
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), project: { name: path.basename(root), fingerprint },
    inventory: { filesAnalyzed: nodes.length, totalBytesAnalyzed: totalBytes, truncated, manifests, dependencyCount: dependencyInventory.direct.length, scripts: dependencyInventory.scripts },
    entrypoints: detectEntrypoints(nodes.map((node) => node.path), known),
    graph: { nodeCount: nodes.length, edgeCount: edges.length, edges, highFanIn, highFanOut, cycles, unresolvedRelative },
    architectureSignals: markers,
    dependencyInventory,
    findings,
    privacy: 'No source contents, absolute paths, environment files or credentials are included in this report. The module graph contains relative project paths only.',
    limitations: [
      'This is heuristic static analysis, not compiler-grade semantic analysis. Dynamic imports, generated code, package aliases, reflection and dependency injection may be missed.',
      'Cycles and coupling hotspots are review signals, not automatic defects.',
      'No project code was executed and no dependency was installed.'
    ]
  };
}
