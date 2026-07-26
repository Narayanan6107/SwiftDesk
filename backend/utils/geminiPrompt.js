/**
 * Builds the strict JSON prompt for Gemini to classify a ticket.
 */
function buildClassificationPrompt(ticketDetails) {
  const { subject, description, userCategory, userPriority } = ticketDetails;

  return `
You are an expert IT support dispatcher. Your job is to classify a support ticket into the correct category and priority based on its subject and description.

# Allowed Classifications

CATEGORIES (choose exactly one):
- Billing
- Technical
- Account
- Delivery
- Other

PRIORITIES (choose exactly one):
- Low
- Medium
- High
- Critical

# Instructions
1. Analyze the subject and description.
2. The user may have pre-selected a category (${userCategory || 'Not provided'}) and priority (${userPriority || 'Not provided'}). You must correct them if they are inappropriate based on the text.
3. Infer the correct category and priority.
4. Output your response as a raw, valid JSON object ONLY. Do not include markdown blocks, backticks, or any other text before or after the JSON.

# Expected JSON Format:
{
  "category": "one of the allowed categories",
  "priority": "one of the allowed priorities",
  "confidence": <a number between 0.0 and 1.0 representing your confidence>,
  "reason": "a brief 1-sentence explanation of why you chose this classification"
}

# Ticket Data
Subject: ${subject}
Description: ${description}
`;
}

module.exports = {
  buildClassificationPrompt
};
