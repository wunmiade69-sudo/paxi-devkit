import fs from 'node:fs';
import path from 'node:path';

const exists = (root, name) => fs.existsSync(path.join(root, name));

export function detectProject(inputPath = process.cwd()) {
  const root = path.resolve(inputPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Project directory does not exist: ${root}`);
  const flutter = exists(root, 'pubspec.yaml');
  const rootGradle = ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts', 'gradlew'].some((name) => exists(root, name));
  const androidDirectory = exists(root, 'app') && (exists(path.join(root, 'app'), 'build.gradle') || exists(path.join(root, 'app'), 'build.gradle.kts'));
  const iosDirectory = exists(root, 'ios') && (exists(path.join(root, 'ios'), 'Runner.xcodeproj') || exists(path.join(root, 'ios'), 'Runner.xcworkspace'));
  const xcodeProject = fs.readdirSync(root).some((name) => name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace'));
  const packageJson = exists(root, 'package.json');
  const expo = packageJson && (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      return Boolean(pkg.dependencies?.expo || pkg.devDependencies?.expo);
    } catch { return false; }
  })();
  const reactNative = packageJson && (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      return Boolean(pkg.dependencies?.['react-native'] || pkg.devDependencies?.['react-native']);
    } catch { return false; }
  })();

  let framework = 'unknown';
  let confidence = 'low';
  let detectedBy = 'no recognised project markers';
  if (flutter) { framework = 'flutter'; confidence = 'high'; detectedBy = 'pubspec.yaml'; }
  else if (rootGradle || androidDirectory) { framework = 'gradle'; confidence = 'high'; detectedBy = androidDirectory ? 'app/ Gradle module' : 'Gradle project files'; }
  else if (iosDirectory || xcodeProject) { framework = 'xcode'; confidence = 'high'; detectedBy = iosDirectory ? 'ios/ Xcode workspace/project' : 'root Xcode project/workspace'; }
  else if (packageJson && expo) { framework = 'expo'; confidence = 'high'; detectedBy = 'package.json Expo dependency'; }
  else if (packageJson && reactNative) { framework = 'react-native'; confidence = 'high'; detectedBy = 'package.json React Native dependency'; }
  else if (packageJson) { framework = 'javascript'; confidence = 'medium'; detectedBy = 'package.json'; }

  const markers = [
    ...(flutter ? ['pubspec.yaml'] : []),
    ...(rootGradle ? ['Gradle project files'] : []),
    ...(androidDirectory ? ['app/ Android module'] : []),
    ...(iosDirectory ? ['ios/ Xcode project'] : []),
    ...(xcodeProject ? ['Xcode project/workspace'] : []),
    ...(packageJson ? ['package.json'] : []),
    ...(expo ? ['Expo dependency'] : []),
    ...(reactNative ? ['React Native dependency'] : [])
  ];
  const support = ['flutter', 'gradle', 'xcode', 'javascript'].includes(framework) ? 'supported' : ['expo', 'react-native'].includes(framework) ? 'detection-only' : 'unsupported';
  const supportNote = support === 'detection-only' ? `${framework} projects are detected but not built or tested by PAXI in this release.` : support === 'unsupported' ? 'No PAXI project adapter is available for this project.' : null;
  return {
    root, name: path.basename(root), framework, confidence, detectedBy, markers, support, supportNote,
    suggestedCommands: framework === 'flutter' ? ['paxi configure android', 'paxi build --platform android --format apk --debug']
      : framework === 'gradle' ? ['paxi configure android', 'paxi build --platform android --format apk --debug']
        : framework === 'expo' || framework === 'react-native' ? ['npm install', 'npx expo run:android (Expo) or npx react-native run-android (React Native)']
          : [],
    platforms: {
      android: flutter || rootGradle || androidDirectory || expo || reactNative,
      ios: flutter || iosDirectory || xcodeProject || expo || reactNative,
      windows: flutter
    }
  };
}
