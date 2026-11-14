import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'paxi'
);
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const HISTORY_FILE = path.join(CONFIG_DIR, 'build-history.json');

export const DOCTOR_PROFILE_FILE = path.join(CONFIG_DIR, 'doctor-profile.json');
export const DOCTOR_LAB_FILE = path.join(CONFIG_DIR, 'doctor-device-lab.json');
export const DOCTOR_LAB_RUNS_FILE = path.join(CONFIG_DIR, 'doctor-device-lab-runs.json');
export const DOCTOR_AGENT_MEMORY_FILE = path.join(CONFIG_DIR, 'doctor-agent-memory.json');
export const DOCTOR_AGENT_FEEDBACK_FILE = path.join(CONFIG_DIR, 'doctor-agent-feedback.json');
export const DOCTOR_VERIFIED_FIXES_FILE = path.join(CONFIG_DIR, 'doctor-verified-fixes.json');
export const AI_BUDGET_FILE = path.join(CONFIG_DIR, 'ai-budget.json');

export const AI_VAULT_FILE = path.join(CONFIG_DIR, 'ai-vault.json');
export const AI_MODELS_DIR = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'paxi', 'models');
