/** Provider catalogue. Model IDs are starting suggestions; live discovery is authoritative. */
export const PROVIDERS = Object.freeze({
  openai: {
    id: 'openai', name: 'OpenAI', region: 'US', category: 'cloud', protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY',
    suggestedModels: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'],
    notes: 'US provider. Model availability and billing depend on your API account.'
  },
  anthropic: {
    id: 'anthropic', name: 'Anthropic Claude', region: 'US', category: 'cloud', protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com', envKey: 'ANTHROPIC_API_KEY',
    suggestedModels: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    notes: 'US provider. Uses the native Anthropic Messages API.'
  },
  google: {
    id: 'google', name: 'Google Gemini', region: 'US', category: 'cloud', protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', envKey: 'GEMINI_API_KEY',
    suggestedModels: ['gemini-3.8-flash', 'gemini-3.1-pro-preview'],
    notes: 'US provider. Uses the native Gemini generateContent API.'
  },
  deepseek: {
    id: 'deepseek', name: 'DeepSeek', region: 'China', category: 'cloud', protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com', envKey: 'DEEPSEEK_API_KEY',
    suggestedModels: ['deepseek-flash', 'deepseek-v4-pro'],
    notes: 'China-based provider. Model and service availability may vary by account and region.'
  },
  qwen: {
    id: 'qwen', name: 'Alibaba Cloud Qwen', region: 'China / international endpoints', category: 'cloud', protocol: 'openai-chat',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', envKey: 'BAILIAN_API_KEY', envAliases: ['DASHSCOPE_API_KEY'],
    suggestedModels: ['qwen3.8-max', 'qwen3.8-flash'],
    notes: 'Alibaba Model Studio. Change the endpoint for your account region/workspace when required.'
  },
  kimi: {
    id: 'kimi', name: 'Moonshot Kimi', region: 'China / international endpoints', category: 'cloud', protocol: 'openai-chat',
    baseUrl: 'https://api.moonshot.ai/v1', envKey: 'MOONSHOT_API_KEY',
    suggestedModels: ['kimi-k3', 'kimi-k2.6'],
    notes: 'Moonshot provides regional platform endpoints; choose the one tied to your account.'
  },
  zhipu: {
    id: 'zhipu', name: 'Zhipu GLM', region: 'China', category: 'cloud', protocol: 'openai-chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', envKey: 'ZHIPUAI_API_KEY',
    suggestedModels: [],
    notes: 'Use model discovery or enter a model ID available to your Zhipu account.'
  },
  ollama: {
    id: 'ollama', name: 'Ollama (local)', region: 'On-device / self-hosted', category: 'local', protocol: 'openai-chat',
    baseUrl: 'http://127.0.0.1:11434/v1', envKey: null,
    suggestedModels: ['qwen3.5:0.8b', 'qwen3.5:2b', 'deepseek-r1:1.5b'],
    notes: 'Local runtime. Ollama must be installed and running separately.'
  },
  llamacpp: {
    id: 'llamacpp', name: 'llama.cpp server (local)', region: 'On-device / self-hosted', category: 'local', protocol: 'openai-chat',
    baseUrl: 'http://127.0.0.1:8080/v1', envKey: null,
    suggestedModels: ['local-model'],
    notes: 'Local runtime. Install llama.cpp and start llama-server with a GGUF model.'
  },
  custom: {
    id: 'custom', name: 'Custom OpenAI-compatible endpoint', region: 'User-defined', category: 'custom', protocol: 'openai-chat',
    baseUrl: '', envKey: 'PAXI_AI_API_KEY', suggestedModels: [],
    notes: 'Use HTTPS and a provider you trust. Requests are sent to the endpoint you configure.'
  }
});

export const AI_ROLES = Object.freeze(['general', 'coding', 'vision', 'journey']);

export function getProvider(id) {
  const provider = PROVIDERS[String(id || '').toLowerCase()];
  if (!provider) throw new Error(`Unknown AI provider "${id}". Run paxi ai providers to see supported providers.`);
  return provider;
}

export function isLocalProvider(id) {
  return getProvider(id).category === 'local';
}

export function maskKey(value) {
  if (!value) return 'not saved';
  const key = String(value);
  return key.length < 8 ? 'saved' : `${key.slice(0, 3)}${'•'.repeat(Math.min(8, Math.max(4, key.length - 7)))}${key.slice(-4)}`;
}
