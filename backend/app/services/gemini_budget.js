// Estimates only decide when to count remotely; they are not a tokenizer.
const limit = Math.max(8000, Math.min(200000, Number(process.env.GEMINI_INPUT_TOKEN_BUDGET) || 24000));
const factors = new Map();
const identity = () => process.env.GEMINI_MODEL || 'gemini-flash-latest';
function estimate(text) {
    // Vietnamese needs more tokens than the common English characters/4 heuristic.
    return Math.ceil(text.length * (factors.get(identity()) || 0.65) + 1024);
}
function observe(text, tokens) {
    if (text.length && Number.isFinite(tokens)) factors.set(identity(), Math.max(factors.get(identity()) || 0.65, tokens / text.length * 1.2));
}
const error = (code, message) => Object.assign(new Error(message), { code });
const fallback = failure => ['TOKEN_BUDGET', 'INPUT_TOO_LARGE', 'AI_OUTPUT_LIMIT', 'AI_OUTPUT_INVALID'].includes(failure.code);
module.exports = { limit, estimate, observe, error, fallback, identity };
