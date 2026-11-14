import fs from 'node:fs/promises';
import path from 'node:path';
import { commandExists } from './process.mjs';

async function regularNonSymlink(file) {
  const info = await fs.lstat(file).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink());
}

/** Build a shell-free Gradle invocation for the current host. */
export async function createGradleInvocation({ projectRoot, task, termux = false, offline = false, hostPlatform = process.platform, commandExistsImpl = commandExists } = {}) {
  const extra = [...(termux ? ['--no-daemon', '--max-workers=2'] : []), ...(offline ? ['--offline'] : [])];
  if (hostPlatform === 'win32') {
    const jar = path.join(projectRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar');
    const properties = path.join(projectRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    const batch = path.join(projectRoot, 'gradlew.bat');
    if ((await regularNonSymlink(jar)) && (await regularNonSymlink(properties)) && (await regularNonSymlink(batch))) {
      if (!(await commandExistsImpl('java'))) throw new Error('Java was not found on PATH. Install a supported JDK before running the Gradle Wrapper on Windows.');
      return { command: 'java', args: ['-classpath', jar, 'org.gradle.wrapper.GradleWrapperMain', task, ...extra], wrapper: true };
    }
    if (await commandExistsImpl('gradle')) return { command: 'gradle', args: [task, ...extra], wrapper: false };
    throw new Error('A complete Windows Gradle Wrapper is required (gradlew.bat, gradle/wrapper/gradle-wrapper.jar and gradle-wrapper.properties), or install system Gradle.');
  }

  const wrapper = path.join(projectRoot, 'gradlew');
  if (await regularNonSymlink(wrapper)) {
    return { command: 'bash', args: ['./gradlew', task, ...extra], wrapper: true };
  }
  if (await commandExistsImpl('gradle')) return { command: 'gradle', args: [task, ...extra], wrapper: false };
  throw new Error('No regular Gradle Wrapper was found and Gradle is not installed.');
}
