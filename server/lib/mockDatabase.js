const crypto = require("node:crypto");

function createMockDatabase() {
  const models = [
    {
      id: "vgo-coder-pro",
      label: "VGO AI Pro",
      description: "Balanced coding model for everyday implementation.",
      contextWindow: 32000
    },
    {
      id: "vgo-coder-fast",
      label: "VGO AI Fast",
      description: "Low-latency coding model for fast turnarounds.",
      contextWindow: 24000
    },
    {
      id: "vgo-architect-max",
      label: "VGO Architect Max",
      description: "Deep reasoning model for architecture and refactors.",
      contextWindow: 64000
    }
  ];

  const users = new Map();

  function ensureUser(displayName) {
    const normalized = (displayName || "VGO AI Developer").trim() || "VGO AI Developer";
    if (!users.has(normalized)) {
      users.set(normalized, {
        displayName: normalized,
        token: `vgo_${crypto.randomUUID().replace(/-/g, "")}`
      });
    }
    return users.get(normalized);
  }

  return {
    models,
    ensureUser
  };
}

module.exports = {
  createMockDatabase
};
