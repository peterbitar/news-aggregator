/**
 * OpenAI Client Service
 * Provides a centralized client for OpenAI API calls
 */

const OpenAI = require("openai");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Get the configured model for Rabbit personalization
 * @returns {string} Model name (e.g., "gpt-4o-mini")
 */
function getRabbitModel() {
  return process.env.RABBIT_MODEL || "gpt-4o-mini";
}

/**
 * Get the configured batch size for processing events
 * @returns {number} Batch size (default: 5)
 */
function getRabbitBatchSize() {
  return parseInt(process.env.RABBIT_BATCH_SIZE) || 5;
}

/**
 * Call OpenAI chat completion with JSON response format
 * @param {Array} messages - Array of message objects
 * @param {Object} options - Additional options (model, temperature, max_tokens)
 * @returns {Promise<Object>} Parsed JSON response
 */
async function chatCompletionJSON(messages, options = {}) {
  const {
    model = getRabbitModel(),
    temperature = 0.6,
    max_tokens = 4000,
  } = options;

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("[OpenAI] Chat completion error:", error.message);
    throw error;
  }
}

module.exports = {
  openai,
  getRabbitModel,
  getRabbitBatchSize,
  chatCompletionJSON,
};
