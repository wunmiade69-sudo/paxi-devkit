import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-doctor-foundation-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config-home');
const { inspectProject } = await import('../src/doctor/project-inspect.mjs');
const { getDoctorProfile, setDoctorPreference, setDoctorLearningMode, resetDoctorProfile } = await import('../src/doctor/profile.mjs');
const { DEVICE_PROFILES, DEVICE_CONDITIONS, buildLabPlan, saveLabPreset, listLabPresets, deleteLabPreset } = await import('../src/doctor/device-lab.mjs');

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(temp, 'project-'));
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return root;
}

test('Doctor identifies React + Vite web projects without claiming a build adapter', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', vite: '^6.0.0' }, scripts: { dev: 'vite' } }),
    'index.html': '<div id="root"></div>',
    'src/main.jsx': '/* app entry */',
    'src/App.jsx': 'export default function App() { return null; }'
  });
  const report = await inspectProject(root);
  assert.ok(report.technologies.frameworks.includes('React + Vite'));
  assert.ok(report.technologies.categories.includes('website'));
  assert.equal(report.capabilities.reactDetected, true);
  assert.equal(report.capabilities.existingBuildAdapter, 'not-available-for-this-project-type');
  assert.ok(report.findings.some((finding) => finding.code === 'test-script-missing'));
});

test('Doctor reports conservative static HTML accessibility hints', async () => {
  const root = await fixture({
    'index.html': '<img src="hero.png"><button><svg></svg></button>'
  });
  const report = await inspectProject(root);
  assert.ok(report.findings.some((finding) => finding.code === 'html-image-alt'));
  assert.ok(report.findings.some((finding) => finding.code === 'html-button-name'));
  assert.ok(report.limitations.some((item) => item.includes('heuristic')));
});

test('Doctor identifies C++ and reports missing build definitions without compiling', async () => {
  const root = await fixture({ 'src/main.cpp': 'int main() { return 0; }' });
  const report = await inspectProject(root);
  assert.ok(report.technologies.languages.includes('C++'));
  assert.ok(report.findings.some((finding) => finding.code === 'cpp-build-definition-missing'));
  assert.ok(report.limitations.some((item) => item.includes('does not execute project scripts')));
});

test('developer preferences are explicit, validated, local and resettable', async () => {
  const initial = await getDoctorProfile();
  assert.equal(initial.learningMode, 'explicit');
  const saved = await setDoctorPreference('guidance', 'detailed');
  assert.equal(saved.preferences.guidance, 'detailed');
  const languages = await setDoctorPreference('preferredLanguages', 'JavaScript,C++,Rust');
  assert.deepEqual(languages.preferences.preferredLanguages, ['JavaScript', 'C++', 'Rust']);
  await assert.rejects(() => setDoctorPreference('automation', 'do-anything'), /must be one of/);
  const off = await setDoctorLearningMode('off');
  assert.equal(off.learningMode, 'off');
  const stillOff = await setDoctorPreference('guidance', 'concise');
  assert.equal(stillOff.learningMode, 'off', 'changing a preference must not silently re-enable learning');
  const reset = await resetDoctorProfile();
  assert.equal(reset.preferences.guidance, 'step-by-step');
  assert.equal(reset.learningMode, 'explicit');
});

test('Device Lab accepts five profiles and six conditions, and presets are saved locally', async () => {
  assert.deepEqual(Object.keys(DEVICE_PROFILES), ['compact', 'standard', 'large', 'foldable', 'tablet']);
  assert.deepEqual(Object.keys(DEVICE_CONDITIONS), ['font', 'landscape', 'dark', 'keyboard', 'zoom', 'offline']);
  const plan = buildLabPlan({ profiles: ['compact', 'tablet'], conditions: ['font', 'keyboard'] });
  assert.equal(plan.planStatus, 'planned-not-executed');
  assert.equal(plan.passStatus, 'not-tested');
  assert.equal(plan.evidenceCollected, false);
  assert.equal(plan.plannedCases, 4);
  await saveLabPreset({ name: 'responsive-check', profiles: ['compact', 'tablet'], conditions: ['font', 'keyboard'] });
  assert.equal((await listLabPresets()).some((item) => item.name === 'responsive-check'), true);
  assert.equal(await deleteLabPreset('responsive-check'), true);
  assert.equal((await listLabPresets()).some((item) => item.name === 'responsive-check'), false);
  await assert.rejects(() => saveLabPreset({ name: '../unsafe', profiles: ['standard'], conditions: [] }), /safe characters/);
});

test.after(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});
