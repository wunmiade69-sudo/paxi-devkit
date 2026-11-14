import { detectProject } from '../lib/project-detect.mjs';

export async function detect(inputPath = process.cwd(), { json = false } = {}) {
  const project = detectProject(inputPath);
  if (json) return console.log(JSON.stringify(project, null, 2));
  console.log(`Project: ${project.name}`);
  console.log(`Root: ${project.root}`);
  console.log(`Framework: ${project.framework} (${project.confidence} confidence)`);
  console.log(`Detected by: ${project.detectedBy}`);
  console.log(`Platforms: ${Object.entries(project.platforms).filter(([, supported]) => supported).map(([name]) => name).join(', ') || 'not determined'}`);
  console.log(`Markers: ${project.markers.join(', ') || 'none'}`);
  if (project.suggestedCommands.length) console.log(`Suggested: ${project.suggestedCommands.join(' ; ')}`);
  return project;
}
