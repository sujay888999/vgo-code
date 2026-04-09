const bundledCliAdapter = require("./bundledCliAdapter");
const vgoRemoteAdapter = require("./vgoRemoteAdapter");
const vgoSimAdapter = require("./vgoSimAdapter");
const ollamaAdapter = require("./ollamaAdapter");

const engines = {
  [bundledCliAdapter.engineId]: bundledCliAdapter,
  [vgoRemoteAdapter.engineId]: vgoRemoteAdapter,
  [vgoSimAdapter.engineId]: vgoSimAdapter,
  [ollamaAdapter.engineId]: ollamaAdapter
};

function getEngine(engineId) {
  return engines[engineId] || bundledCliAdapter;
}

function listEngines() {
  return Object.values(engines).map((engine) => ({
    id: engine.engineId,
    label: engine.engineLabel,
    provider: engine.providerLabel
  }));
}

module.exports = {
  getEngine,
  listEngines
};
