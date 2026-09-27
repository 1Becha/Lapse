const env = process.env;
const port = Number(env.PORT ?? 3000);

export const config = {
  port,
  dataDir: env.LAPSE_DATA_DIR ?? './data',
  baseUrl: (env.LAPSE_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  // Optional basic auth for the whole UI/API (the ICS feed uses its own token).
  user: env.LAPSE_USER,
  password: env.LAPSE_PASSWORD,
  // e.g. smtp://user:pass@smtp.example.com:587
  smtpUrl: env.SMTP_URL,
  smtpFrom: env.SMTP_FROM ?? 'Lapse <lapse@localhost>',
  // "off" disables scans and alerts (demos, read-only instances).
  scheduler: env.LAPSE_SCHEDULER !== 'off',
  scanIntervalHours: Number(env.LAPSE_SCAN_INTERVAL_HOURS ?? 24),
  ctMaxHosts: Number(env.LAPSE_CT_MAX_HOSTS ?? 100),
  // Public lookup services (rdap.org, crt.sh) block anonymous default user agents.
  userAgent: 'Lapse/0.1 (self-hosted expiry tracker)',

  // Contract import. "auto" uses Claude if ANTHROPIC_API_KEY is set, else Ollama
  // if OLLAMA_URL is set, else the built-in rules (nothing leaves the machine).
  aiProvider: (env.LAPSE_AI_PROVIDER ?? 'auto') as 'auto' | 'anthropic' | 'ollama' | 'none',
  anthropicModel: env.LAPSE_ANTHROPIC_MODEL ?? 'claude-opus-5',
  ollamaUrl: env.OLLAMA_URL?.replace(/\/$/, ''),
  ollamaModel: env.OLLAMA_MODEL ?? 'llama3.1:8b',
  maxUploadBytes: Number(env.LAPSE_MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
};
