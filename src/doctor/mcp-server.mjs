import readline from 'node:readline';
import { inspectProject } from './project-inspect.mjs';
import { getDoctorProfile } from './profile.mjs';
import { buildLabPlan, DEVICE_PROFILES, DEVICE_CONDITIONS } from './device-lab.mjs';
import { cppToolchainReport } from './cpp-toolchain.mjs';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const MCP_STATELESS_PROTOCOL_VERSION = '2026-07-28';
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([MCP_STATELESS_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION]);
const SERVER_INFO = Object.freeze({ name: 'paxi-devkit-doctor', version: '0.7.0' });
const SERVER_INSTRUCTIONS = 'PAXI Doctor MCP tools are read-only. Ask before running commands outside these tools. Never describe a plan or simulated viewport as a device test.';
const SERVER_META = Object.freeze({ 'io.modelcontextprotocol/serverInfo': SERVER_INFO });

export const MCP_TOOLS = Object.freeze([
  {
    name: 'paxi_doctor_inspect_project',
    description: 'Read-only bounded inspection of a local project. Does not execute project scripts, install dependencies, modify files or send source to a remote service.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Local project directory. Defaults to the current working directory.' } }, additionalProperties: false }
  },
  {
    name: 'paxi_doctor_profile_read',
    description: 'Read the local developer preferences and explicitly learned project conventions. Does not change profile data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'paxi_doctor_device_lab_plan',
    description: 'Create a non-executing responsive Device Lab plan using the available profile and condition IDs. It does not claim that tests ran.',
    inputSchema: { type: 'object', properties: { profiles: { type: 'array', items: { type: 'string', enum: Object.keys(DEVICE_PROFILES) }, minItems: 1 }, conditions: { type: 'array', items: { type: 'string', enum: Object.keys(DEVICE_CONDITIONS) } } }, required: ['profiles', 'conditions'], additionalProperties: false }
  },
  {
    name: 'paxi_doctor_cpp_preflight',
    description: 'Check local C/C++ compiler and build-tool availability and inspect root build markers. Does not compile or run project build scripts.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Local C/C++ project directory. Defaults to the current working directory.' } }, additionalProperties: false }
  }
]);

function response(id, result, { stateless = false } = {}) {
  const payload = stateless ? { ...result, _meta: { ...(result?._meta || {}), ...SERVER_META } } : result;
  return { jsonrpc: '2.0', id, result: payload };
}
function protocolError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

export async function handleMcpMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return protocolError(message?.id ?? null, -32600, 'Invalid JSON-RPC request.');
  }
  const hasId = Object.hasOwn(message, 'id');
  const id = message.id;
  const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params) ? message.params : {};
  const meta = params._meta && typeof params._meta === 'object' && !Array.isArray(params._meta) ? params._meta : {};
  const requestedVersion = meta['io.modelcontextprotocol/protocolVersion'];
  const stateless = requestedVersion === MCP_STATELESS_PROTOCOL_VERSION;

  // 2026-07-28 stateless protocol: every request declares its version and client capabilities.
  if (requestedVersion && !SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)) {
    return { ...protocolError(id, -32022, `Unsupported MCP protocol version: ${requestedVersion}.`), error: { code: -32022, message: `Unsupported MCP protocol version: ${requestedVersion}.`, data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested: requestedVersion } } };
  }
  if (requestedVersion === MCP_STATELESS_PROTOCOL_VERSION && (!meta['io.modelcontextprotocol/clientCapabilities'] || typeof meta['io.modelcontextprotocol/clientCapabilities'] !== 'object' || Array.isArray(meta['io.modelcontextprotocol/clientCapabilities']))) {
    return protocolError(id, -32602, 'Stateless MCP requests must include io.modelcontextprotocol/clientCapabilities in params._meta.');
  }

  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return null;
  if (message.method === 'ping') return hasId ? response(id, {}, { stateless }) : null;
  if (message.method === 'server/discover') {
    return response(id, {
      resultType: 'complete',
      supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      capabilities: { tools: { listChanged: false } },
      instructions: SERVER_INSTRUCTIONS,
      ttlMs: 3600000,
      cacheScope: 'public'
    }, { stateless: true });
  }
  if (message.method === 'initialize') {
    const legacyRequested = params.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(legacyRequested) && legacyRequested !== MCP_STATELESS_PROTOCOL_VERSION ? legacyRequested : MCP_PROTOCOL_VERSION;
    return response(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: SERVER_INSTRUCTIONS
    });
  }
  if (message.method === 'tools/list') return response(id, { tools: MCP_TOOLS }, { stateless });
  if (message.method === 'tools/call') {
    const name = params.name;
    const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
    try {
      let value;
      if (name === 'paxi_doctor_inspect_project') value = await inspectProject(typeof args.project === 'string' ? args.project : process.cwd());
      else if (name === 'paxi_doctor_profile_read') value = await getDoctorProfile();
      else if (name === 'paxi_doctor_device_lab_plan') value = buildLabPlan({ profiles: args.profiles, conditions: args.conditions });
      else if (name === 'paxi_doctor_cpp_preflight') value = await cppToolchainReport(typeof args.project === 'string' ? args.project : process.cwd());
      else return protocolError(id, -32602, `Unknown PAXI Doctor tool: ${String(name)}`);
      return response(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false }, { stateless });
    } catch (error) {
      return response(id, { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }, { stateless });
    }
  }
  if (!hasId) return null;
  return protocolError(id, -32601, `Method not found: ${message.method}`);
}

export async function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > 1024 * 1024) {
      output.write(`${JSON.stringify(protocolError(null, -32700, 'MCP message exceeds the 1 MiB limit.'))}\n`);
      continue;
    }
    let message;
    try { message = JSON.parse(line); }
    catch { output.write(`${JSON.stringify(protocolError(null, -32700, 'Parse error: invalid JSON.'))}\n`); continue; }
    const result = await handleMcpMessage(message);
    if (result) output.write(`${JSON.stringify(result)}\n`);
  }
}
