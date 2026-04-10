const MODEL = {
  id: "g0.5-nano",
  label: "g0.5-nano",
  styleLabel: "compact cloud reply",
  indicatorClass: "md-nano",
  maxTokens: 180,
  temperature: 0.35,
  topP: 0.88,
  historyLimit: 4,
  thinking: false,
  systemPrompt: [
    "You are GenAI Nano.",
    "Reply automatically with concise, practical language.",
    "Prefer short paragraphs over bullets.",
    "Keep spacing tight and avoid extra explanation unless asked.",
    "Use at most 4 short paragraphs."
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
    return Number((0.03 + tokens * 0.0012).toFixed(2));
  }
};

export default MODEL;
