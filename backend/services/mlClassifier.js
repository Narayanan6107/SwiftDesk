/**
 * ML Classifier Service — Node.js HTTP Client
 *
 * Calls the Python FastAPI ML microservice (ml-service/) to classify tickets.
 *
 * INTERFACE CONTRACT (unchanged from the keyword-based implementation):
 *   classify(subject: string, description: string)
 *     → Promise<{ category, priority, confidence, sentiment, scores }>
 *
 * Behaviour:
 *   1. POST to ML_SERVICE_URL/predict with subject + description.
 *   2. If requires_llm_validation=false and confidence ≥ threshold → trust ML.
 *   3. If requires_llm_validation=true → confidence returned as-is; the
 *      caller (routes/tickets.js) will invoke LLM validation.
 *   4. If the Python service is unavailable (network error, 5xx) → falls back
 *      to the local keyword-matching classifier so the pipeline never stalls.
 */

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_REQUEST_TIMEOUT_MS = parseInt(process.env.ML_REQUEST_TIMEOUT_MS || '5000', 10);

// ── Local keyword fallback (used when Python service is down) ─────────────────

const CATEGORY_RULES = [
  {
    category: 'Technical',
    weight: 1,
    keywords: [
      'error', 'bug', 'crash', 'broken', 'fail', 'failure', 'exception',
      'not working', 'down', 'timeout', 'connection', '500', '404', '503',
      'performance', 'slow', 'freeze', 'hang', 'unresponsive', 'api',
      'integration', 'sync', 'data loss', 'corrupt',
    ],
  },
  {
    category: 'Billing',
    weight: 1,
    keywords: [
      'invoice', 'payment', 'charge', 'refund', 'subscription', 'bill',
      'cost', 'price', 'credit', 'debit', 'overcharged', 'discount',
      'receipt', 'transaction', 'renewal', 'cancel', 'upgrade', 'downgrade',
    ],
  },
  {
    category: 'Account',
    weight: 1,
    keywords: [
      'login', 'password', 'access', 'locked', 'account', 'username',
      'authenticate', 'sign in', 'sign out', 'reset', 'mfa', '2fa',
      'permissions', 'role', 'profile', 'settings',
    ],
  },
  {
    category: 'Feature Request',
    weight: 0.9,
    keywords: [
      'feature', 'request', 'suggest', 'enhancement', 'improve', 'add',
      'new functionality', 'would be great', 'would love', 'wish', 'roadmap',
      'please add', 'option to',
    ],
  },
  {
    category: 'General',
    weight: 0.6,
    keywords: ['question', 'how to', 'help', 'information', 'guide', 'tutorial', 'explain'],
  },
];

const PRIORITY_RULES = [
  {
    priority: 'Critical',
    weight: 1,
    keywords: [
      'urgent', 'critical', 'emergency', 'outage', 'production down',
      'all users affected', 'data loss', 'immediately', 'asap', 'system down',
    ],
  },
  {
    priority: 'High',
    weight: 1,
    keywords: [
      'high', 'important', 'quickly', 'many users', 'multiple users',
      'significant', 'major', 'serious', 'blocking',
    ],
  },
  {
    priority: 'Medium',
    weight: 1,
    keywords: ['medium', 'moderate', 'some users', 'occasional', 'intermittent', 'workaround'],
  },
  {
    priority: 'Low',
    weight: 1,
    keywords: ['low', 'minor', 'cosmetic', 'when possible', 'nice to have', 'not urgent'],
  },
];

const SENTIMENT_RULES = [
  { sentiment: 'frustrated', keywords: ['frustrated', 'angry', 'unacceptable', 'terrible', 'worst', 'fed up'] },
  { sentiment: 'negative', keywords: ['disappointed', 'bad', 'problem', 'broken', 'unhappy', 'concerned'] },
  { sentiment: 'positive', keywords: ['thank', 'thanks', 'appreciate', 'great', 'love', 'excellent', 'amazing'] },
];

function _matchScore(text, keywords) {
  const lower = text.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw)).length;
  return hits / keywords.length;
}

function _keywordClassify(subject, description) {
  const text = `${subject} ${description}`;

  const categoryScores = CATEGORY_RULES.map((r) => ({
    category: r.category,
    score: _matchScore(text, r.keywords) * r.weight,
  })).sort((a, b) => b.score - a.score);

  const priorityScores = PRIORITY_RULES.map((r) => ({
    priority: r.priority,
    score: _matchScore(text, r.keywords) * r.weight,
  })).sort((a, b) => b.score - a.score);

  let sentiment = 'neutral';
  for (const rule of SENTIMENT_RULES) {
    if (_matchScore(text, rule.keywords) > 0) { sentiment = rule.sentiment; break; }
  }

  const catTop = categoryScores[0]?.score ?? 0;
  const catSecond = categoryScores[1]?.score ?? 0;
  const priTop = priorityScores[0]?.score ?? 0;
  const priSecond = priorityScores[1]?.score ?? 0;

  let confidence = 0.45; // default when no keywords match
  if (catTop > 0 || priTop > 0) {
    const catGap = catTop > 0 ? Math.min(1, (catTop - catSecond) / catTop + catTop) : 0;
    const priGap = priTop > 0 ? Math.min(1, (priTop - priSecond) / priTop + priTop) : 0;
    confidence = Math.max(0.40, Math.min(0.80, (catGap + priGap) / 2));
    // Keyword fallback caps at 0.80 — below ML threshold — so LLM always validates
  }

  return {
    category: catTop > 0 ? categoryScores[0].category : 'General',
    priority: priTop > 0 ? priorityScores[0].priority : 'Medium',
    confidence,
    sentiment,
    scores: {
      category: Object.fromEntries(categoryScores.map((s) => [s.category, s.score])),
      priority: Object.fromEntries(priorityScores.map((s) => [s.priority, s.score])),
    },
    source: 'keyword_fallback',
  };
}

// ── Python ML service caller ───────────────────────────────────────────────────

let _mlServiceAvailable = true; // circuit-breaker flag

async function _callMLService(subject, description) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ML_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, description }),
    });

    if (!res.ok) {
      console.error(`[ML-Service] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    _mlServiceAvailable = true;
    return data;
  } catch (err) {
    if (_mlServiceAvailable) {
      // Only log once to avoid log spam
      console.warn(
        `[ML-Service] Unavailable (${err.name === 'AbortError' ? 'timeout' : err.message}) — using keyword fallback`
      );
      _mlServiceAvailable = false;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a support ticket.
 * Tries the Python ML service first; falls back to keyword matching on failure.
 *
 * @param {string} subject
 * @param {string} description
 * @returns {Promise<{
 *   category: string,
 *   priority: string,
 *   confidence: number,
 *   sentiment: string,
 *   scores: object,
 *   source: 'ml_service' | 'keyword_fallback'
 * }>}
 */
async function classify(subject, description) {
  const mlResult = await _callMLService(subject, description);

  if (mlResult) {
    return {
      category: mlResult.predicted_category,
      priority: mlResult.predicted_priority,
      confidence: mlResult.confidence,
      // Python service signals when LLM is needed;
      // we translate this back into a confidence below threshold
      // so the existing pipeline logic (in routes/tickets.js) works unchanged.
      sentiment: 'neutral', // Python service doesn't classify sentiment
      scores: {
        category: { [mlResult.predicted_category]: mlResult.category_confidence },
        priority: { [mlResult.predicted_priority]: mlResult.priority_confidence },
      },
      source: 'ml_service',
    };
  }

  // Keyword fallback — confidence always < threshold so LLM will validate
  return _keywordClassify(subject, description);
}

module.exports = { classify };
