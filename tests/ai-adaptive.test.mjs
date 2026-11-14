import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-ai-adaptive-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
process.env.PAXI_AI_MODE = 'local';
process.env.PAXI_AI_LOCAL_URL = 'http://127.0.0.1:8080';
const { learnProjectConventions } = await import('../src/doctor/learning.mjs');
const { setDoctorPreference, setDoctorLearningMode } = await import('../src/doctor/profile.mjs');
const { explain } = await import('../src/commands/ai.mjs');

async function fixtureProject() {
  const root = path.join(temp, 'react-app');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'adaptive-react-app', dependencies: { react: '^19.0.0', vite: '^6.0.0', prettier: '^3.0.0', vitest: '^3.0.0' } }));
  await fs.writeFile(path.join(root, 'package-lock.json'), '{}');
  await fs.writeFile(path.join(root, 'src', 'App.jsx'), "const title = 'private-source-marker';\nexport default function App() { return <h1>{title}</h1>; };\n");
  return root;
}

function installFetchCapture(t) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'diagnosis ready' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return requests;
}

test('AI explanation uses the learned project summary without sending source files', async (t) => {
  const project = await fixtureProject();
  await setDoctorPreference('guidance', 'concise');
  await setDoctorPreference('dependencyPolicy', 'minimal');
  await setDoctorPreference('testingStyle', 'test-first');
  await learnProjectConventions(project);
  const requests = installFetchCapture(t);
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => { console.log = originalLog; });
  await explain('Vite build failed', { projectPath: project });
  assert.equal(requests.length, 1);
  const prompt = requests[0].body.messages[1].content;
  assert.match(prompt, /projectConventions/);
  assert.doesNotMatch(prompt, /adaptive-react-app/);
  assert.match(prompt, /"guidance": "concise"/);
  assert.match(prompt, /"dependencyPolicy": "minimal"/);
  assert.match(prompt, /"testingStyle": "test-first"/);
  assert.match(prompt, /Prettier/);
  assert.doesNotMatch(prompt, /private-source-marker/);
  assert.doesNotMatch(prompt, new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(requests[0].body.messages[0].content, /Respect the supplied developer preferences/);
});

test('AI explanation excludes all adaptive profile metadata with --no-profile', async (t) => {
  const project = await fixtureProject();
  await learnProjectConventions(project);
  const requests = installFetchCapture(t);
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => { console.log = originalLog; });
  await explain('A generic error', { projectPath: project, includeProfile: false });
  const prompt = requests[0].body.messages[1].content;
  assert.equal(prompt, 'Explain this development error. Give a concise diagnosis, likely root cause, safe steps to verify, and a minimal fix if justified:\n\nA generic error');
  assert.doesNotMatch(prompt, /adaptive-react-app|developerPreferences|projectConventions/);
});

test('disabled learning excludes learned project conventions from adaptive context', async (t) => {
  const project = await fixtureProject();
  await learnProjectConventions(project);
  await setDoctorLearningMode('off');
  const requests = installFetchCapture(t);
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => { console.log = originalLog; });
  await explain('Learning is disabled', { projectPath: project });
  const prompt = requests[0].body.messages[1].content;
  assert.doesNotMatch(prompt, /adaptive-react-app/);
  assert.match(prompt, /"projectConventions": null/);
});

test.after(async () => {
  delete process.env.PAXI_AI_MODE;
  delete process.env.PAXI_AI_LOCAL_URL;
  await fs.rm(temp, { recursive: true, force: true });
});
