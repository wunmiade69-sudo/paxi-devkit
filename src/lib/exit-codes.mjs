export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  GENERAL_FAILURE: 1,
  INVALID_ARGUMENTS: 2,
  PROJECT_DETECTION: 10,
  MISSING_TOOLCHAIN: 11,
  OFFLINE_CACHE_MISSING: 12,
  BUILD_FAILED: 13,
  ARTIFACT_VERIFICATION: 14,
  DEVICE_UNAVAILABLE: 15,
  TIMEOUT: 16,
  CANCELLED: 17,
  SECURITY_REFUSAL: 18
});

export function exitCodeForError(error) {
  if (Number.isInteger(error?.exitCode)) return error.exitCode;
  const message = String(error?.message || error || '');
  // Parse/usage failures must win before the word "timeout" in a usage line.
  if (/Usage:|Unknown .*option|Unknown command|must be an integer|requires a value|must be .* or /i.test(message)) return EXIT_CODES.INVALID_ARGUMENTS;
  if (/timed out after|timed out|timeout/i.test(message)) return EXIT_CODES.TIMEOUT;
  if (/cancelled by Ctrl\+C|was cancelled/i.test(message)) return EXIT_CODES.CANCELLED;
  if (/offline cache missing|missing Gradle distribution|Pub cache.*missing|offline mode/i.test(message)) return EXIT_CODES.OFFLINE_CACHE_MISSING;
  if (/signature verification failed|Strict .*verification failed|strict installation requires|artifact.*verification|bundletool rejected|codesign rejected/i.test(message)) return EXIT_CODES.ARTIFACT_VERIFICATION;
  if (/No authorized Android device|adb device|requested adb device|ADB is not|device is unavailable/i.test(message)) return EXIT_CODES.DEVICE_UNAVAILABLE;
  if (/Refusing |security policy|not trusted|changed after approval|Plugin trust cancelled|Plugin trust requires interactive confirmation|symbolic-link|symlink|--allow-unverified-release/i.test(message)) return EXIT_CODES.SECURITY_REFUSAL;
  if (/project directory does not exist|Could not detect|project framework|detection-only|not a PAXI build target|Cannot build framework/i.test(message)) return EXIT_CODES.PROJECT_DETECTION;
  if (/not found on PATH|not installed|missing tool|verification tools are missing|requires macOS|requires.*Xcode|No regular Gradle wrapper/i.test(message)) return EXIT_CODES.MISSING_TOOLCHAIN;
  if (/Local Android build|Flutter iOS build|Xcode archive failed|Gradle.*failed|Build tool exited|Project tests .*failed/i.test(message)) return EXIT_CODES.BUILD_FAILED;
  return EXIT_CODES.GENERAL_FAILURE;
}

export function exitCodeHelp() {
  return Object.fromEntries(Object.entries(EXIT_CODES).map(([key, value]) => [value, key.toLowerCase().replaceAll('_', ' ')]));
}
