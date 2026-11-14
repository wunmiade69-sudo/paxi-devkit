const SECRET_PATTERNS = [
  { name: 'private-key block', regex: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g },
  { name: 'authorization credential', regex: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi },
  { name: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: 'OpenAI-style API key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'npm access token', regex: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  { name: 'JWT token', regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'AWS access key ID', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Stripe secret key', regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'credential URL user-info', regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/gi },
  { name: 'credential URL query parameter', regex: /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|key|signature|sig|x-amz-signature|x-amz-credential)=)[^&#\s]+/gi, replace: (_match, prefix) => `${prefix}[REDACTED]` },
  { name: 'secret assignment', regex: /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|azure[_-]?(?:client[_-]?secret|storage[_-]?key)|aws[_-]?secret[_-]?access[_-]?key|password|passwd|secret|private[_-]?key|account[_-]?key|connection[_-]?string)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, replace: (_match, key, separator) => `${key}${separator}[REDACTED]` }
];

export function redactSensitiveText(value) {
  let text = String(value ?? '');
  const detected = new Set();
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) detected.add(pattern.name);
    pattern.regex.lastIndex = 0;
    text = text.replace(pattern.regex, pattern.replace || '[REDACTED]');
  }
  return { text, redacted: detected.size > 0, categories: [...detected] };
}
