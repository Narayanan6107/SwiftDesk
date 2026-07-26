const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

if (!apiKey) {
  console.error('[Gemini Config] ERROR: GEMINI_API_KEY is not defined in the environment. Classification will fail.');
}

if (!process.env.GEMINI_MODEL) {
  console.warn(`[Gemini Config] WARN: GEMINI_MODEL is not defined in the environment. Defaulting to: ${modelName}`);
}

console.log(`[Gemini Config] Initialized. Using Gemini Model: ${modelName}`);

const genAI = new GoogleGenerativeAI(apiKey || '');
const model = genAI.getGenerativeModel({ model: modelName });

module.exports = {
  genAI,
  model,
  modelName
};
