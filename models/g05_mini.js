const MODEL = {
  id: "g0.5-mini",
  label: "g0.5-mini",
  styleLabel: "balanced cloud reply",
  indicatorClass: "md-mini",
  maxTokens: 420,
  temperature: 0.55,
  topP: 0.92,
  historyLimit: 8,
  thinking: true,
  systemPrompt: [
    "You are GenAI Mini.",
    "Reply automatically with balanced detail and clear structure.",
    "Use short sections when helpful.",
    "Be direct, readable, and moderately spaced.",
    "Avoid filler and keep output practical."
  ].join(" "),
  buildMessages(history, prompt) {
    const sliced = history.slice(-this.historyLimit).map((item) => ({
      role: item.role === "ai" ? "assistant" : item.role,
      content: item.text
    }));
    return [
      { role: "system", content: this.systemPrompt },
      ...sliced,
      { role: "user", content: prompt }
    ];
  },
  normalizeReply(text) {
    return text.trim().replace(/\n{3,}/g, "\n\n");
  },
  calculateCreditCost(prompt, reply) {
    const tokens = Math.max(1, Math.ceil((prompt.length + reply.length) / 4));
    return Number((0.05 + tokens * 0.0019).toFixed(2));
  }
};

export default MODEL;
