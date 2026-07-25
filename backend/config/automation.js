/**
 * SwiftDesk Automation Engine — Configuration
 *
 * All values can be overridden via environment variables so that
 * thresholds and SLA windows can be tuned without code changes.
 */

module.exports = {
  // ── ML Classification ────────────────────────────────────────────────────
  /** Minimum confidence required to trust the ML model outright (0–1). */
  ML_CONFIDENCE_THRESHOLD: parseFloat(process.env.ML_CONFIDENCE_THRESHOLD || '0.85'),

  // ── LLM Provider ─────────────────────────────────────────────────────────
  /** OpenAI-compatible endpoint. Swap for Azure / local Ollama / etc. */
  LLM_API_URL: process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions',
  LLM_API_KEY: process.env.OPENAI_API_KEY || '',
  LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o-mini',
  /** Max milliseconds to wait for LLM response before falling back to rules. */
  LLM_TIMEOUT_MS: parseInt(process.env.LLM_TIMEOUT_MS || '10000', 10),

  // ── SLA Windows (hours per priority) ─────────────────────────────────────
  SLA_HOURS: {
    Critical: parseFloat(process.env.SLA_HOURS_CRITICAL || '1'),
    High: parseFloat(process.env.SLA_HOURS_HIGH || '4'),
    Medium: parseFloat(process.env.SLA_HOURS_MEDIUM || '8'),
    Low: parseFloat(process.env.SLA_HOURS_LOW || '24'),
  },

  // ── Level / Priority mapping ──────────────────────────────────────────────
  /**
   * Which priorities each support level can handle.
   * L1 → Low only  |  L2 → Low + Medium  |  L3 → all
   */
  LEVEL_CAPABILITIES: {
    L1: ['Low'],
    L2: ['Low', 'Medium'],
    L3: ['Low', 'Medium', 'High', 'Critical'],
  },

  /**
   * Minimum level that must handle each priority.
   * Used to build the set of eligible agents.
   */
  PRIORITY_MIN_LEVEL: {
    Low: 'L1',
    Medium: 'L2',
    High: 'L3',
    Critical: 'L3',
  },

  /** Escalation ladder: after SLA breach, try the next level. */
  ESCALATION_PATH: {
    L1: 'L2',
    L2: 'L3',
    L3: null, // already at highest tier
  },

  // ── Cron Schedules ────────────────────────────────────────────────────────
  /** How often the queue processor tries to assign waiting tickets. */
  QUEUE_CRON: process.env.QUEUE_CRON || '*/2 * * * *',
  /** How often the SLA watcher checks for breaches. */
  SLA_CRON: process.env.SLA_CRON || '*/5 * * * *',
};
