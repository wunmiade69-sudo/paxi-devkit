import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseExplorationHierarchy } from './android-explore.mjs';

const MAX_XML_BYTES = 2 * 1024 * 1024;
const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const safeLabel = (value) => String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const shortHash = (value) => sha256(value).slice(0, 12);

export async function proposeAndroidSelectors({ hierarchyPath } = {}) {
  if (!hierarchyPath) throw new Error('Android selector proposal requires --hierarchy <uiautomator.xml>.');
  const absolute = path.resolve(hierarchyPath);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 8 || info.size > MAX_XML_BYTES) throw new Error(`UI hierarchy must be a regular non-symlink file between 8 bytes and ${MAX_XML_BYTES} bytes.`);
  const xml = await fs.readFile(absolute, 'utf8');
  if (!xml.includes('<hierarchy')) throw new Error('Input does not look like an Android UIAutomator hierarchy XML file.');
  const nodes = parseExplorationHierarchy(xml);
  const usable = nodes.filter((node) => node['visible-to-user'] !== 'false' && node.bounds && node._bounds && node._bounds[2] > node._bounds[0] && node._bounds[3] > node._bounds[1]);
  const byId = new Map();
  for (const node of usable) {
    const resourceId = safeLabel(node['resource-id']);
    if (!resourceId || resourceId.length > 240) continue;
    const group = byId.get(resourceId) || [];
    group.push(node);
    byId.set(resourceId, group);
  }
  const proposals = [];
  for (const [resourceId, matches] of byId) {
    const clickable = matches.filter((node) => node.clickable === 'true');
    const node = clickable[0] || matches[0];
    const [left, top, right, bottom] = node._bounds;
    proposals.push({
      index: proposals.length + 1,
      selector: { resourceId },
      confidence: matches.length === 1 ? (node.clickable === 'true' ? 'high' : 'medium') : 'low',
      nodeClass: safeLabel(node.class).slice(0, 160) || null,
      clickable: node.clickable === 'true',
      duplicateMatches: matches.length,
      bounds: { left, top, right, bottom },
      selectorHash: shortHash(resourceId),
      rationale: matches.length === 1 ? (node.clickable === 'true' ? 'Unique visible resource ID and clickable node.' : 'Unique visible resource ID; node is not marked clickable.') : 'Resource ID appears multiple times; add a parent/container or stronger assertion manually.'
    });
  }
  const withoutId = usable.filter((node) => !safeLabel(node['resource-id']));
  return {
    schemaVersion: 1,
    reportType: 'paxi-android-selector-proposals',
    input: { fileName: path.basename(absolute), bytes: info.size, sha256: sha256(xml) },
    hierarchy: { totalNodes: nodes.length, visibleBoundedNodes: usable.length, nodesWithoutResourceId: withoutId.length },
    proposals: proposals.slice(0, 100),
    manualCandidates: withoutId.slice(0, 30).map((node) => ({ nodeClass: safeLabel(node.class).slice(0, 160) || null, clickable: node.clickable === 'true', bounds: { left: node._bounds[0], top: node._bounds[1], right: node._bounds[2], bottom: node._bounds[3] }, labelHash: shortHash(node.text || node['content-desc'] || '') })),
    privacy: { visibleTextStored: false, contentDescriptionsStored: false, resourceIdsOnly: true, note: 'Raw visible labels and content descriptions were read only in memory for parsing and are not included in the proposal report. Screenshots require separate privacy review.' },
    limitations: ['Resource IDs are the preferred selector source, but they can still be duplicated or unstable.', 'Nodes without resource IDs require manual selector design; coordinate bounds are evidence only and are not emitted as executable actions.', 'Canvas-rendered controls may not appear in UIAutomator hierarchy.', 'Review the target screen and selector before creating or running a journey.']
  };
}

export async function writeAndroidJourneyFromSelector({ hierarchyPath, packageId, candidateIndex, outputPath, confirm = false } = {}) {
  if (!confirm) throw new Error('Writing an Android journey draft requires explicit --confirm.');
  if (typeof packageId !== 'string' || !PACKAGE_ID.test(packageId)) throw new Error('Supply a valid --package application ID.');
  if (!Number.isInteger(candidateIndex) || candidateIndex < 1 || candidateIndex > 100) throw new Error('--candidate must be a proposal index between 1 and 100.');
  if (!outputPath) throw new Error('Supply --output <journey.json>.');
  const report = await proposeAndroidSelectors({ hierarchyPath });
  const candidate = report.proposals.find((item) => item.index === candidateIndex);
  if (!candidate) throw new Error(`Selector proposal ${candidateIndex} was not found. Choose a candidate with a resource ID.`);
  const destination = path.resolve(outputPath);
  const parentInfo = await fs.lstat(path.dirname(destination)).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('Journey output parent directory must exist and must not be a symlink.');
  const journey = {
    schemaVersion: 1,
    name: `Review selector ${candidate.selectorHash}`,
    description: 'Generated from a local UIAutomator hierarchy. Review the selector and screen context before execution; it asserts only the current visible state.',
    steps: [{ type: 'assertVisible', selector: candidate.selector }]
  };
  const data = `${JSON.stringify(journey, null, 2)}\n`;
  await fs.writeFile(destination, data, { flag: 'wx', mode: 0o600 });
  return { output: destination, packageId, candidate: { index: candidate.index, selector: candidate.selector, confidence: candidate.confidence, rationale: candidate.rationale }, requiresHumanReview: true, journey, note: 'This starter asserts a selector on the current screen. It does not reproduce a navigation path or prove the original defect. Add reviewed actions and defect-specific assertions before using it as a regression test.' };
}
