const patterns = [
  { id: 'gradle-distribution', phase: 'before project compilation', title: 'Gradle Wrapper distribution download failed', re: /GradleWrapperMain|gradle\.wrapper\.Download|distribution.*download|SocketException.*connection abort/i, next: ['Check the distributionUrl in gradle-wrapper.properties.', 'Retry once on a stable connection or pre-cache the exact Gradle distribution.', 'After it is cached, use paxi build --offline.'] },
  { id: 'gradle-dependency', title: 'Gradle dependency is missing or could not be resolved', re: /No cached version of .* available for offline mode|Could not resolve all (?:files|dependencies)|Could not find .* required by|Could not resolve .* because/i, next: ['Connect temporarily and run the project build once to warm Gradle dependency caches.', 'For offline builds, keep the same repositories and dependency lockfiles.'] },
  { id: 'pub-cache', title: 'Flutter/Dart package is missing from the local Pub cache', re: /Package .* not found in cache|No version of .* is available in cache|pub get.*offline|Could not find package/i, next: ['While online, run flutter pub get for this project.', 'Then retry with paxi build --offline.'] },
  { id: 'android-sdk', title: 'Android SDK component is missing', re: /Failed to find target with hash string|Android SDK.*not found|platforms;android-|build-tools.*not found/i, next: ['Install the Android platform/build-tools version required by the project.', 'On Termux, review the Flutter-for-Termux post-install output and run paxi doctor.'] },
  { id: 'aapt2', title: 'Android AAPT2 configuration is missing or incompatible', re: /AAPT2.*not found|aapt2FromMavenOverride|AAPT2.*failed/i, next: ['Install the Termux AAPT2 package if applicable.', 'Run paxi configure android --project . and review android/gradle.properties.'] },
  { id: 'java-version', title: 'Java/Gradle version mismatch', re: /requires JVM|Unsupported class file major version|Android Gradle plugin requires Java|invalid source release/i, next: ['Check java --version and the Gradle/Android Gradle Plugin compatibility requirements.', 'Select a supported JDK for this project.'] },
  { id: 'kotlin-plugin', title: 'Kotlin or Android Gradle Plugin compatibility issue', re: /Kotlin Gradle plugin|Kotlin compiler.*incompatible|Plugin .* was not found|Minimum supported Gradle version/i, next: ['Review the Android Gradle Plugin, Kotlin plugin and Gradle Wrapper versions as a compatible set.'] },
  { id: 'disk-full', title: 'Insufficient storage space', re: /No space left on device|ENOSPC|not enough disk space/i, next: ['Check df -h and free space before retrying.', 'Clear only caches you understand; do not delete signing keys or source projects.'] },
  { id: 'memory', title: 'Build may have exceeded available memory', re: /OutOfMemoryError|Java heap space|Killed process|Cannot allocate memory/i, next: ['Close memory-heavy applications.', 'Keep Gradle workers low and avoid local AI inference during builds.'] },
  { id: 'signing', title: 'Android signing configuration failed', re: /Keystore was tampered|Failed to read key|No key with alias|signingConfig|Keystore file.*not found/i, next: ['Check local signing configuration and keystore paths.', 'Never commit keystores or passwords to Git.'] },
  { id: 'adb', title: 'Android device is unavailable to ADB', re: /no devices\/emulators found|device unauthorized|more than one device|adb.*offline/i, next: ['Run adb devices.', 'Authorize USB debugging or pair Wireless debugging and select --device if several devices are connected.'] }
];

export function classifyFailure(message) {
  const text = String(message || '');
  for (const item of patterns) if (item.re.test(text)) return { id: item.id, title: item.title, next: item.next };
  return { id: 'build-failed', title: 'Build or command failed', next: ['Open the PAXI log path shown below.', 'Run paxi preflight --offline to inspect local prerequisites, or paxi doctor for toolchain status.'] };
}

export function renderFailureAdvice(message) {
  const result = classifyFailure(message);
  return `${result.phase ? `Build stopped ${result.phase}.\n` : ''}${result.title}\n${result.next.map((line, index) => `  ${index + 1}. ${line}`).join('\n')}`;
}
