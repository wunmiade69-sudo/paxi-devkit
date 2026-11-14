import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PACKS = Object.freeze({
  'node-express': {
    title: 'Node.js / Express', language: 'JavaScript', files: {
      'README.md': `# PAXI OpenTelemetry pack — Node.js / Express\n\nThis is an opt-in example. It does not modify your application or install packages.\n\n## Install dependencies deliberately\n\n\`\`\`bash\nnpm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http\n\`\`\`\n\n## Integrate\n\n1. Review \`paxi-otel-bootstrap.mjs\` and adapt the exporter endpoint to your test collector.\n2. Import the bootstrap before importing Express or other instrumented modules (for example, \`node --import ./paxi-observability/node-express/paxi-otel-bootstrap.mjs src/server.mjs\`).\n3. Keep the collector endpoint on a trusted test network.\n4. Add structured logs with trace/span IDs using the helper below.\n5. Export OTLP JSON from your collector and inspect it with \`paxi doctor trace spans --spans ./traces.json\`.\n\nUse \`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT\` to specify the traces endpoint. The default is loopback only. Do not record request bodies, cookies, authorization headers or user-entered secrets in span attributes.\n`,
      'paxi-otel-bootstrap.mjs': `import { NodeSDK } from '@opentelemetry/sdk-node';\nimport { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';\nimport { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';\n\nconst endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://127.0.0.1:4318/v1/traces';\nconst parsed = new URL(endpoint);\nif (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {\n  throw new Error('Invalid OTLP traces endpoint; use a trusted HTTP(S) collector without embedded credentials.');\n}\n\nconst sdk = new NodeSDK({\n  traceExporter: new OTLPTraceExporter({ url: endpoint }),\n  instrumentations: [getNodeAutoInstrumentations({\n    '@opentelemetry/instrumentation-fs': { enabled: false },\n    '@opentelemetry/instrumentation-dns': { enabled: false }\n  })]\n});\nawait sdk.start();\nfor (const signal of ['SIGTERM', 'SIGINT']) {\n  process.once(signal, () => { void sdk.shutdown().finally(() => process.exit(0)); });\n}\n`,
      'paxi-trace-log.mjs': `import { trace } from '@opentelemetry/api';\n\nexport function traceLogFields() {\n  const span = trace.getActiveSpan();\n  const context = span?.spanContext();\n  return context ? { trace_id: context.traceId, span_id: context.spanId } : {};\n}\n\n// Merge traceLogFields() into structured log metadata. Never attach request bodies or secrets.\n`
    }
  },
  'python-fastapi': {
    title: 'Python / FastAPI', language: 'Python', files: {
      'README.md': `# PAXI OpenTelemetry pack — Python / FastAPI\n\nOpt-in sample only; no dependencies or application files are changed.\n\nInstall the reviewed packages for your environment:\n\n\`\`\`bash\npip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-sqlalchemy\n\`\`\`\n\nImport \`paxi_otel.py\` after creating the FastAPI app and call \`configure_telemetry(app)\`. Call it once during application startup. Use a trusted collector, set \`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT\`, and export OTLP JSON for PAXI Doctor.\n\nSQLAlchemy instrumentation requires the actual engine and should be configured with \`instrument_sqlalchemy(engine)\` after engine creation. Do not attach raw SQL parameters, request bodies or credentials as span attributes.\n`,
      'paxi_otel.py': `import os\nfrom fastapi import FastAPI\nfrom opentelemetry import trace\nfrom opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter\nfrom opentelemetry.instrumentation.fastapi import FastAPIInstrumentor\nfrom opentelemetry.sdk.resources import Resource\nfrom opentelemetry.sdk.trace import TracerProvider\nfrom opentelemetry.sdk.trace.export import BatchSpanProcessor\n\n\ndef configure_telemetry(app: FastAPI) -> None:\n    endpoint = os.getenv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'http://127.0.0.1:4318/v1/traces')\n    provider = TracerProvider(resource=Resource.create({'service.name': os.getenv('OTEL_SERVICE_NAME', 'paxi-fastapi-service')}))\n    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))\n    trace.set_tracer_provider(provider)\n    FastAPIInstrumentor.instrument_app(app)\n\n\ndef instrument_sqlalchemy(engine) -> None:\n    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor\n    SQLAlchemyInstrumentor().instrument(engine=engine)\n`,
      '.env.otel.example': `OTEL_SERVICE_NAME=paxi-fastapi-service\nOTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces\nOTEL_PROPAGATORS=tracecontext,baggage\n`
    }
  },
  'go-http': {
    title: 'Go / net/http', language: 'Go', files: {
      'README.md': `# PAXI OpenTelemetry pack — Go / net/http\n\nThis pack adds example middleware only; it does not edit your go.mod or source files.\n\nInstall dependencies deliberately:\n\n\`\`\`bash\ngo get go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp\n\`\`\`\n\nCopy/adapt \`otel.go.example\` into your app, initialize the provider once at process startup, wrap the router with \`otelhttp.NewHandler\`, and shut down the provider on termination. Add database instrumentation for your exact driver separately.\n`,
      'otel.go.example': `package observability\n\nimport (\n  "context"\n  "os"\n\n  "go.opentelemetry.io/otel"\n  "go.opentelemetry.io/otel/attribute"\n  "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"\n  "go.opentelemetry.io/otel/propagation"\n  sdkresource "go.opentelemetry.io/otel/sdk/resource"\n  sdktrace "go.opentelemetry.io/otel/sdk/trace"\n)\n\nfunc Init(ctx context.Context) (func(context.Context) error, error) {\n  endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")\n  if endpoint == "" { endpoint = "http://127.0.0.1:4318" }\n  exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint))\n  if err != nil { return nil, err }\n  resource, err := sdkresource.New(ctx, sdkresource.WithAttributes(attribute.String("service.name", "paxi-go-service")))\n  if err != nil { return nil, err }\n  provider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(resource))\n  otel.SetTracerProvider(provider)\n  otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))\n  return provider.Shutdown, nil\n}\n`,
      '.env.otel.example': `OTEL_SERVICE_NAME=paxi-go-service\nOTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318\n`
    }
  },
  'java-spring': {
    title: 'Java / Spring Boot', language: 'Java', files: {
      'README.md': `# PAXI OpenTelemetry pack — Java / Spring Boot\n\nRecommended low-code setup uses the official OpenTelemetry Java agent. This pack does not download binaries or alter Gradle/Maven files.\n\n1. Download a pinned OpenTelemetry Java agent from the official OpenTelemetry distribution, verify its published checksum, and keep it outside source control.\n2. Set \`OTEL_JAVAAGENT_PATH\` to the local agent JAR.\n3. Review \`otel-javaagent.env.example\` and pass those variables only to a staging/test process.\n4. Include the agent with \`JAVA_TOOL_OPTIONS=-javaagent:/absolute/path/opentelemetry-javaagent.jar\`.\n5. Confirm HTTP and JDBC instrumentation in a test trace export.\n\nDo not capture SQL bind values, request bodies, cookies or authorization headers.\n`,
      'otel-javaagent.env.example': `OTEL_SERVICE_NAME=paxi-spring-service\nOTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318\nOTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf\nOTEL_PROPAGATORS=tracecontext,baggage\nOTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED=true\n# Set JAVA_TOOL_OPTIONS separately after verifying the local agent JAR:\n# JAVA_TOOL_OPTIONS=-javaagent:/absolute/path/opentelemetry-javaagent.jar\n`
    }
  },
  'dotnet-aspnet': {
    title: '.NET / ASP.NET Core', language: 'C#', files: {
      'README.md': `# PAXI OpenTelemetry pack — .NET / ASP.NET Core\n\nThis pack provides a registration example. It does not edit your project or install NuGet packages.\n\nAdd the reviewed packages compatible with your target framework: \`OpenTelemetry.Extensions.Hosting\`, \`OpenTelemetry.Instrumentation.AspNetCore\`, \`OpenTelemetry.Instrumentation.Http\`, and a matching OTLP exporter. Add database-specific instrumentation only for the driver you use.\n\nCall \`AddPaxiOpenTelemetry\` from your service registration. Keep collector endpoints and credentials out of committed source.\n`,
      'PaxiOpenTelemetry.cs': `using Microsoft.Extensions.Configuration;\nusing Microsoft.Extensions.DependencyInjection;\nusing OpenTelemetry.Resources;\nusing OpenTelemetry.Trace;\n\npublic static class PaxiOpenTelemetry\n{\n    public static IServiceCollection AddPaxiOpenTelemetry(this IServiceCollection services, IConfiguration configuration)\n    {\n        var endpoint = configuration["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://127.0.0.1:4318";\n        services.AddOpenTelemetry()\n            .ConfigureResource(resource => resource.AddService(configuration["OTEL_SERVICE_NAME"] ?? "paxi-aspnet-service"))\n            .WithTracing(tracing => tracing\n                .AddAspNetCoreInstrumentation(options => options.RecordException = true)\n                .AddHttpClientInstrumentation()\n                .AddOtlpExporter(options => options.Endpoint = new Uri(endpoint)));\n        return services;\n    }\n}\n`,
      'appsettings.otel.example.json': JSON.stringify({ OTEL_SERVICE_NAME: 'paxi-aspnet-service', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' }, null, 2) + '\n'
    }
  }
});

export function listObservabilityPacks() {
  return Object.entries(PACKS).map(([id, pack]) => ({ id, title: pack.title, language: pack.language, files: Object.keys(pack.files) }));
}

export function getObservabilityPack(id) {
  const pack = PACKS[id];
  if (!pack) throw new Error(`Unknown observability pack. Available: ${Object.keys(PACKS).join(', ')}.`);
  return { id, title: pack.title, language: pack.language, files: Object.keys(pack.files), note: 'Templates only. No application file, dependency manifest or runtime configuration is modified automatically.' };
}

async function ensureSafeDirectory(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await fs.lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error('Observability output cannot traverse symbolic links.');
    if (info && !info.isDirectory()) throw new Error('Observability output path contains a non-directory component.');
  }
  await fs.mkdir(absolute, { recursive: true, mode: 0o700 });
  const verified = await fs.lstat(absolute);
  if (!verified.isDirectory() || verified.isSymbolicLink()) throw new Error('Observability output must be a real directory.');
  return absolute;
}

export async function writeObservabilityPack({ id, projectPath = process.cwd(), outputPath = null, confirm = false } = {}) {
  if (!confirm) throw new Error('Writing observability templates requires explicit --confirm.');
  const pack = PACKS[id];
  if (!pack) throw new Error(`Unknown observability pack. Available: ${Object.keys(PACKS).join(', ')}.`);
  const root = path.resolve(projectPath);
  const rootInfo = await fs.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Project root must be an existing regular directory, not a symlink.');
  const output = outputPath ? path.resolve(root, outputPath) : path.join(root, 'paxi-observability', id);
  if (output !== root && !output.startsWith(`${root}${path.sep}`)) throw new Error('Observability pack output must remain inside the selected project.');
  const directory = await ensureSafeDirectory(output);
  const written = [];
  const entries = Object.entries(pack.files);
  const targets = entries.map(([name]) => {
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Invalid pack filename.');
    return path.join(directory, name);
  });
  for (const target of targets) {
    const exists = await fs.lstat(target).catch(() => null);
    if (exists) throw new Error(`Refusing to overwrite existing observability file: ${target}`);
  }
  try {
    for (let index = 0; index < entries.length; index += 1) {
      const [, content] = entries[index];
      const target = targets[index];
      await fs.writeFile(target, content, { flag: 'wx', mode: 0o600 });
      written.push(target);
    }
  } catch (error) {
    await Promise.all(written.map((target) => fs.unlink(target).catch(() => {})));
    throw error;
  }
  return { pack: getObservabilityPack(id), directory, files: written, confirmation: 'written-with-explicit-confirmation', changedApplicationFiles: false, dependenciesInstalled: false, runId: randomUUID(), note: 'Review templates and integrate manually. No application source, manifest, lockfile, runtime or collector was changed.' };
}
