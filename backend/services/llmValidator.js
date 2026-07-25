/**
 * LLM Validator Service
 *
 * Invoked when ML confidence is below the configured threshold.
 * Calls an OpenAI-compatible API (GPT-4o-mini by default) and asks it to:
 *   1. Validate the ticket (is it a real support request?)
 *   2. Determine the correct category
 *   3. Determine the correct priority
 *   4. Return a brief explanation
 *
 * If no API key is configured or the request times out, falls back to a
 * deterministic rule-based approach so the pipeline never stalls.
 *
 * To switch LLM providers: set LLM_API_URL + LLM_API_KEY in .env.
 * The service sends a standard OpenAI Chat Completions payload.
 */

const cfg = require('../config/automation');

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a support ticket triage assistant for SwiftDesk.
Your task is to classify the incoming support ticket and return a JSON object.

Rules:
- category must be one of: Technical, Billing, General, Account, Feature Request
- priority must be one of: Low, Medium, High, Critical
- explanation must be 1-2 sentences explaining your reasoning
- Return ONLY valid JSON — no markdown, no extra text.

Priority guidelines:
  Critical → system outage, data loss, complete blocker for many users
  High     → significant impact, many users affected, time-sensitive
  Medium   → moderate impact, workaround available
  Low      → cosmetic, nice-to-have, affects one user, not urgent`;

const USER_PROMPT_TEMPLATE = (subject, description, mlResult) =>
  `Support ticket to classify:

Subject: ${subject}
Description: ${description}

ML model attempted classification (low confidence):
  category: ${mlResult.category} (confidence: ${(mlResult.confidence * 100).toFixed(1)}%)
  priority: ${mlResult.priority}

Please validate and return:
{
  "category": "<one of the allowed categories>",
  "priority": "<one of the allowed priorities>",
  "explanation": "<your reasoning>"
}`;

// ── Fallback rule-based validator ─────────────────────────────────────────────

/**
 * Used when LLM is unavailable or times out.
 * Applies a small set of high-signal rules to make a reasonable decision.
 */
function _ruleBasedFallback(subject, description, mlResult) {
  const text = `${subject} ${description}`.toLowerCase();

  // Override ML category only if strong signal exists
  let category = mlResult.category;
  if (/\b(error|bug|crash|outage|down|fail)\b/.test(text)) category = 'Technical';
  else if (/\b(invoice|payment|refund|charge|bill)\b/.test(text)) category = 'Billing';
  else if (/\b(login|password|access|locked|account)\b/.test(text)) category = 'Account';

  // Override ML priority only if strong signal exists
  let priority = mlResult.priority;
  if (/\b(urgent|critical|emergency|outage|production down|data loss)\b/.test(text)) priority = 'Critical';
  else if (/\b(important|many users|blocking|asap)\b/.test(text)) priority = 'High';

  return {
    category,
    priority,
    explanation:
      `Rule-based fallback applied (LLM unavailable). ` +
      `Detected keywords indicate ${category} category at ${priority} priority.`,
  };
}

// ── LLM call ──────────────────────────────────────────────────────────────────

/**
 * Parse the LLM's JSON response. Returns null if parsing fails.
 */
function _parseLLMResponse(content) {
  try {
    // Strip any accidental markdown fences
    const clean = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const validCategories = ['Technical', 'Billing', 'General', 'Account', 'Feature Request'];
    const validPriorities = ['Low', 'Medium', 'High', 'Critical'];

    if (!validCategories.includes(parsed.category)) return null;
    if (!validPriorities.includes(parsed.priority)) return null;

    return {
      category: parsed.category,
      priority: parsed.priority,
      explanation: parsed.explanation || '',
    };
  } catch {
    return null;
  }
}

/**
 * Call the LLM API with a timeout. Returns raw response text or null on error.
 */
async function _callLLM(subject, description, mlResult) {
  if (!cfg.LLM_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.LLM_TIMEOUT_MS);

  try {
    const response = await fetch(cfg.LLM_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: cfg.LLM_MODEL,
        temperature: 0.1, // low temperature for deterministic classification
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT_TEMPLATE(subject, description, mlResult) },
        ],
        response_format: { type: 'json_object' }, // enforce JSON mode if supported
      }),
    });

    if (!response.ok) {
      console.error(`[LLM] API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[LLM] Request timed out after %dms', cfg.LLM_TIMEOUT_MS);
    } else {
      console.error('[LLM] Request failed:', err.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a ticket when ML confidence is insufficient.
 *
 * @param {string} subject
 * @param {string} description
 * @param {{ category: string, priority: string, confidence: number }} mlResult
 * @returns {Promise<{
 *   category: string,
 *   priority: string,
 *   explanation: string,
 *   usedLLM: boolean,
 * }>}
 */
async function validate(subject, description, mlResult) {
  // Try LLM first
  const rawContent = await _callLLM(subject, description, mlResult);
  if (rawContent) {
    const parsed = _parseLLMResponse(rawContent);
    if (parsed) {
      console.log('[LLM] Classification succeeded via API');
      return { ...parsed, usedLLM: true };
    }
    console.warn('[LLM] Response could not be parsed — using fallback');
  } else {
    console.warn('[LLM] Unavailable — using rule-based fallback');
  }

  // Fallback
  const fallback = _ruleBasedFallback(subject, description, mlResult);
  return { ...fallback, usedLLM: false };
}

module.exports = { validate };
