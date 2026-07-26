const { model, modelName } = require('../config/gemini');
const { buildClassificationPrompt } = require('../utils/geminiPrompt');

const VALID_CATEGORIES = ['Billing', 'Technical', 'Account', 'Delivery', 'Other'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

/**
 * Extracts and parses a JSON object from the raw model response.
 * Handles cases where the model wraps the response in markdown blocks.
 */
function parseGeminiResponse(rawText) {
  let cleanText = rawText.trim();
  
  // Remove markdown block if present (e.g., ```json ... ```)
  if (cleanText.startsWith('```')) {
    const lines = cleanText.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].startsWith('```')) lines.pop();
    cleanText = lines.join('\n').trim();
  }

  const parsed = JSON.parse(cleanText);

  // Validate fields
  if (!parsed.category || !VALID_CATEGORIES.includes(parsed.category)) {
    throw new Error(`Invalid or missing category in response: ${parsed.category}`);
  }
  if (!parsed.priority || !VALID_PRIORITIES.includes(parsed.priority)) {
    throw new Error(`Invalid or missing priority in response: ${parsed.priority}`);
  }

  return {
    category: parsed.category,
    priority: parsed.priority,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 1.0,
    reason: parsed.reason || 'No reason provided'
  };
}

/**
 * Classifies a ticket using Gemini with a single retry on failure.
 */
async function classifyTicket(ticketDetails) {
  const prompt = buildClassificationPrompt(ticketDetails);
  
  let attempts = 0;
  const maxAttempts = 2; // 1 initial + 1 retry

  while (attempts < maxAttempts) {
    attempts++;
    try {
      console.log(`[Gemini] Attempt ${attempts}: Sending classification request for ticket...`);
      console.log(`[Gemini] Selected model: ${modelName}`);
      console.log(`[Gemini] Request sent to Gemini:\n${prompt}`);
      
      const result = await model.generateContent(prompt);
      const rawResponse = result.response.text();
      console.log(`[Gemini] Raw Gemini response:`, rawResponse);

      const parsedData = parseGeminiResponse(rawResponse);
      console.log(`[Gemini] Parsed JSON Output:`, parsedData);

      return {
        ...parsedData,
        validationSource: 'Gemini',
        invalidCategory: false,
        invalidPriority: false
      };
    } catch (err) {
      console.error(`[Gemini] Attempt ${attempts} failed:`, err.message);
      if (attempts >= maxAttempts) {
        console.error(`[Gemini] Max attempts reached. Falling back to defaults.`);
        break; // exit loop to return fallback
      }
    }
  }

  // Fallback if all attempts fail
  console.log(`[Gemini] Fallback logic used (API completely unavailable or invalid JSON)`);
  const fallbackCategory = (ticketDetails.userCategory && VALID_CATEGORIES.includes(ticketDetails.userCategory)) 
    ? ticketDetails.userCategory 
    : 'Other';
    
  const fallbackPriority = (ticketDetails.userPriority && VALID_PRIORITIES.includes(ticketDetails.userPriority)) 
    ? ticketDetails.userPriority 
    : 'Medium';

  return {
    category: fallbackCategory,
    priority: fallbackPriority,
    confidence: 0,
    reason: 'Fallback due to Gemini API failure or invalid response',
    validationSource: null,
    invalidCategory: false,
    invalidPriority: false
  };
}

module.exports = {
  classifyTicket
};
