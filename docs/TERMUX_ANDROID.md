# Android builds on Termux (ARM64)

PAXI can orchestrate local Android builds from Termux. It does not include the Android SDK, Flutter SDK, Gradle distribution or a cloud build worker. Toolchain installation remains device-specific.

## Base packages

From the PAXI project directory:

```bash
bash scripts/termux-bootstrap.sh
```

This helper installs Java 21, Gradle, AAPT2, ADB and native build utilities. It does not silently download the large Flutter SDK/Android SDK bundle.

## Flutter ARM64 toolchain

A community-maintained Flutter-for-Termux distribution documents Flutter 3.47.7 / Dart 3.13.5 for aarch64 Termux. Follow its current install guide and verify the package checksum against the exact release asset before installing. Complete the distribution's `post_install.sh` step and confirm:

```bash
flutter --version
dart --version
flutter doctor -v
```

The upstream installation guide describes the Termux package, Android SDK/NDK setup and an ARM64 APK build. Some releases do not include a `flutter_project_config.sh` helper; PAXI 0.5.3 introduced the required Android project edits itself when that helper is absent; this behaviour remains part of the Termux configure workflow. The package is community-maintained, not the official Flutter distribution. Review its current release notes and trust model before use.

Reference: https://github.com/retired64/flutter-for-termux

## Configure each project

From the Flutter or native Android Gradle project directory:

```bash
paxi configure android
```

For a different project directory:

```bash
paxi configure android --project /path/to/project
```

This command modifies local build configuration:

- Flutter projects: uses the vendor helper when present; otherwise updates the Android app Gradle file to use compileSdk/targetSdk 36 and arm64-v8a, writes the Termux AAPT2 override and two-worker limit to `android/gradle.properties`, and fixes an incompatible Gradle wrapper shebang.
- Native Gradle Android projects: writes the Termux ARM64 AAPT2 override and limits Gradle workers to two in the project `gradle.properties`.
- Both project types: when a project Gradle wrapper and its properties file exist, sets `networkTimeout=180000` (three minutes) to make the initial Gradle distribution download more tolerant of slow or briefly stalled mobile connections.

Review the modified project files (`git diff`) before committing. PAXI does not add signing keys or secrets.

## Build

```bash
paxi build --platform android --format apk --debug
paxi build --platform android --format apk --release
paxi build --platform android --format aab --release
```

When PAXI detects Termux, Flutter builds receive `--target-platform android-arm64` and `--no-tree-shake-icons`. Native Gradle builds run with `--no-daemon --max-workers=2` to reduce background memory use. The wrapper download timeout is configured to 180 seconds when the wrapper properties file is present; this improves tolerance but cannot prevent an ISP, server or network connection from aborting a download. This does not guarantee that every Android Gradle Plugin, Kotlin plugin, NDK, CMake or third-party Flutter plugin supports the device environment.

Flutter/Termux documentation currently describes ARM64 as the supported architecture. Do not assume the produced package is universal across 32-bit ARM, x86 or x86_64 devices.

## Prepare and build offline

A first Gradle/Flutter build needs network access unless every exact toolchain distribution and dependency has already been cached. While online, warm the Android/Flutter and Gradle caches:

```bash
flutter precache --android
flutter pub get
cd android
./gradlew --version
./gradlew assembleDebug
cd ..
```

Then check the cache and test offline dependency resolution:

```bash
paxi cache status
paxi preflight --offline
paxi build --platform android --format apk --debug --offline
paxi test --offline
```

For Flutter, PAXI runs `flutter pub get --offline`, builds with `--no-pub`, and sets Gradle's offline start parameter through a temporary Gradle user-home that reuses the existing caches. For native Gradle projects it appends `--offline` to the wrapper/system Gradle task. An uncached Gradle Wrapper distribution is detected before build; the wrapper must be warmed online first. Offline mode applies to managed Gradle and Pub dependency resolution, but is not a network sandbox for custom build scripts or plugins.

Use `paxi doctor --json --offline --project .` or `paxi preflight --offline --json` for a structured readiness report. Run `paxi cache status --json` to inspect local caches. Cache cleanup commands require explicit `--confirm` and should not be used when preparing an offline device.

## Verify and install

PAXI only marks a build successful after locating a valid ZIP-based APK/AAB artifact, checking its central directory and (when `unzip` is installed) entry CRCs, and recording a SHA-256 checksum:

```bash
paxi builds
paxi verify /absolute/path/to/app-debug.apk
paxi devices
paxi install /absolute/path/to/app-debug.apk
paxi build --platform android --format apk --debug --install
```

`paxi install` requires an authorized ADB connection. For installing on the same Android phone, configure Android Wireless debugging and pair/connect ADB locally first. AAB files cannot be installed with `adb install`.

## Troubleshooting

- Run `paxi doctor --json`, `paxi preflight --offline`, and `flutter doctor -v` before escalating build errors. Use `paxi support-bundle` to produce a sanitized diagnostic ZIP; inspect it before sharing.
- If Flutter reports stale Gradle/Kotlin plugin sources after updating its Termux package, follow the distribution's current documented post-install/cache-refresh procedure.
- If Gradle runs out of memory, close other apps, ensure Android has sufficient free memory and retry. PAXI limits Gradle workers, but does not alter project heap settings automatically.
- Keep Android projects in Termux private storage (`$HOME/projects`) rather than Android shared storage for more reliable file permissions and build tooling.
- Never commit keystores, passwords, API tokens or signing properties containing secrets.

## Host detection

PAXI identifies the Termux userland by the `PREFIX` environment variable containing `/com.termux/files/usr` (and a non-empty `HOME`). It does not treat every Node.js runtime reporting Android as Termux. This distinction prevents ordinary Android-hosted test processes from accidentally activating Termux-only AAPT2 checks while real Termux sessions retain the ARM64 AAPT2 and Gradle worker safeguards.

