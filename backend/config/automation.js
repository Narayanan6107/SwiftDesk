/**
 * SwiftDesk Automation Engine — Configuration
 *
 * All values can be overridden via environment variables so that
 * thresholds and SLA windows can be tuned without code changes.
 */

const PRIORITY_ORDER = ['Low', 'Medium', 'High'];
const ASSIGNMENT_PRIORITIES = ['Low', 'Medium', 'High'];

/** Ticket category → engineer skill tokens used for matching. */
const CATEGORY_SKILL_ALIASES = {
  Technical: ['Technical', 'General'],
  'Network Issue': ['Network', 'Technical'],
  Network: ['Network', 'Technical'],
  Billing: ['Billing'],
  Account: ['Account', 'General'],
  Delivery: ['Delivery', 'General'],
  General: ['General'],
  Other: ['General'],
  'Feature Request': ['General', 'Technical'],
};

function normalizePriority(priority) {
  if (!priority) return 'Medium';
  const normalized = String(priority).trim();
  if (!normalized) return 'Medium';
  // Critical is not a valid priority — treat as High
  if (/^critical$/i.test(normalized)) return 'High';
  if (['Low', 'Medium', 'High'].includes(normalized)) return normalized;
  // case-insensitive match
  const lower = normalized.toLowerCase();
  if (lower === 'low') return 'Low';
  if (lower === 'medium') return 'Medium';
  if (lower === 'high') return 'High';
  return 'Medium';
}

/**
 * Resolve ML / user priority for assignment (preserves Critical).
 * Invalid or missing values default to Medium and flag invalid.
 */
function resolvePredictedPriority(priority) {
  if (priority == null) {
    return { value: 'Medium', invalid: true, slaPriority: 'Medium' };
  }
  const normalized = String(priority).trim();
  if (!normalized) {
    return { value: 'Medium', invalid: true, slaPriority: 'Medium' };
  }
  // Treat Critical as High — only 3 priority levels exist
  if (/^critical$/i.test(normalized)) {
    return { value: 'High', invalid: false, slaPriority: 'High' };
  }
  if (ASSIGNMENT_PRIORITIES.includes(normalized)) {
    return { value: normalized, invalid: false, slaPriority: normalized };
  }
  if (['low', 'medium', 'high'].includes(normalized.toLowerCase())) {
    const titled = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
    return { value: titled, invalid: false, slaPriority: titled };
  }
  return { value: 'Medium', invalid: true, slaPriority: 'Medium' };
}

function getSlaPriority(priority) {
  return resolvePredictedPriority(priority).slaPriority;
}

/** Minimum support tier required for a predicted priority. */
function getRequiredSupportLevel(priority) {
  const { value } = resolvePredictedPriority(priority);
  const map = { Low: 'L1', Medium: 'L2', High: 'L3' };
  return map[value] || 'L2';
}

/**
 * Ordered levels to try when assigning. First tier with capacity wins.
 * Low → L1, then L2, then L3 fallback. High/Critical → L3 only.
 */
function getLevelPreferenceOrder(priority) {
  const { value } = resolvePredictedPriority(priority);
  switch (value) {
    case 'Low':
      // L1 preferred; L2/L3 as fallback if no L1 available
      return ['L1', 'L2', 'L3'];
    case 'Medium':
      // L2 preferred; L3 as fallback if no L2 available
      return ['L2', 'L3'];
    case 'High':
      // High must be handled by L3 only
      return ['L3'];
    default:
      return ['L2', 'L3'];
  }
}

function getCategorySkillTokens(category) {
  if (!category) return ['General'];
  const trimmed = String(category).trim();
  return CATEGORY_SKILL_ALIASES[trimmed] || CATEGORY_SKILL_ALIASES[trimmed.replace(/\s+Issue$/i, '')] || [trimmed, 'General'];
}

function engineerMatchesCategory(engineer, category) {
  const skills = Array.isArray(engineer?.skills) ? engineer.skills : [];
  if (!skills.length) return true;
  const tokens = getCategorySkillTokens(category).map((t) => t.toLowerCase());
  return skills.some((skill) => {
    const s = String(skill).toLowerCase();
    return tokens.some((token) => s === token || s.includes(token) || token.includes(s));
  });
}

function getPriorityRank(priority) {
  const normalized = normalizePriority(priority);
  return PRIORITY_ORDER.indexOf(normalized) + 1;
}

function getPrioritySortValue(left, right) {
  const leftRank = getPriorityRank(left.priority || left.aiPriority || left.priorityRank);
  const rightRank = getPriorityRank(right.priority || right.aiPriority || right.priorityRank);
  if (leftRank !== rightRank) return rightRank - leftRank;
  const leftTime = new Date(left.createdAt || left.queuedAt || 0).getTime();
  const rightTime = new Date(right.createdAt || right.queuedAt || 0).getTime();
  return leftTime - rightTime;
}

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
    L3: ['Low', 'Medium', 'High'],
  },

  /**
   * Minimum level that must handle each priority.
   * L1 → Low only | L2 → Low + Medium | L3 → all (Low + Medium + High)
   */
  PRIORITY_MIN_LEVEL: {
    Low: 'L1',
    Medium: 'L2',
    High: 'L3',
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
  PRIORITY_ORDER,
  ASSIGNMENT_PRIORITIES,
  CATEGORY_SKILL_ALIASES,
  normalizePriority,
  resolvePredictedPriority,
  getSlaPriority,
  getRequiredSupportLevel,
  getLevelPreferenceOrder,
  getCategorySkillTokens,
  engineerMatchesCategory,
  getPriorityRank,
  getPrioritySortValue,
};
