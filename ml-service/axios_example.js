/**
 * Node.js Axios Integration Example
 * Demonstrates how to call the SwiftDesk Python ML service from Node.js.
 *
 * Run with: node axios_example.js
 * Requires:  npm install axios
 */

const axios = require('axios');

const ML_SERVICE = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const TIMEOUT_MS = 5000;

// ── Predict ────────────────────────────────────────────────────────────────────

async function classifyTicket(subject, description) {
  const res = await axios.post(
    `${ML_SERVICE}/predict`,
    { subject, description },
    { timeout: TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
  );

  const {
    predicted_category,
    predicted_priority,
    confidence,
    requires_llm_validation,
    category_confidence,
    priority_confidence,
  } = res.data;

  return {
    predicted_category,
    predicted_priority,
    confidence,
    requires_llm_validation,
    category_confidence,
    priority_confidence,
  };
}

// ── Health check ────────────────────────────────────────────────────────────────

async function checkHealth() {
  const res = await axios.get(`${ML_SERVICE}/health`, { timeout: TIMEOUT_MS });
  return res.data;
}

// ── Example usage ───────────────────────────────────────────────────────────────

async function main() {
  console.log('SwiftDesk ML Service — Axios Integration Example\n');

  // Health check
  try {
    const health = await checkHealth();
    console.log('Health:', health);
  } catch (err) {
    console.error('ML service unavailable:', err.message);
    return;
  }

  // Test predictions
  const tickets = [
    {
      subject: 'Cannot login to my account',
      description: 'I have been trying to login but keep getting an error. My account appears to be locked.',
    },
    {
      subject: 'Production outage - all users affected',
      description: 'Our entire platform is down. All users are unable to access the service. Revenue impact is critical. Need immediate assistance.',
    },
    {
      subject: 'Unexpected charge on my invoice',
      description: 'I was charged $150 on my last invoice but expected to pay $75. Please refund the difference.',
    },
  ];

  for (const ticket of tickets) {
    console.log(`\nSubject: "${ticket.subject}"`);
    try {
      const result = await classifyTicket(ticket.subject, ticket.description);
      console.log('  Category:             ', result.predicted_category);
      console.log('  Priority:             ', result.predicted_priority);
      console.log('  Confidence:           ', result.confidence.toFixed(3));
      console.log('  Requires LLM:         ', result.requires_llm_validation);
      console.log('  Cat confidence:       ', result.category_confidence?.toFixed(3));
      console.log('  Pri confidence:       ', result.priority_confidence?.toFixed(3));
    } catch (err) {
      console.error('  Error:', err.message);
    }
  }
}

main().catch(console.error);
