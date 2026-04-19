const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");

const DEFAULT_PROFILE_ID = "default";

const GUEST_MODEL_LABELS = {
  "glm-4.7-flash": "GLM-4.7-Flash（免费）",
  "glm-4v-flash": "GLM-4V-Flash（免费）",
  "glm-4.1v-thinking-flash": "GLM-4.1V-Thinking-Flash（免费）",
  "glm-4-flash-250414": "GLM-4-Flash-250414（免费）"
};

const MOJIBAKE_PATTERN = /[锛鏃鍏璐鐧诲綍鏈]/;

function buildGuestModelCatalog() {
  return Object.entries(GUEST_MODEL_LABELS).map(([id, label]) => ({
    id,
    label,
    description: "",
    contextWindow: 0
  }));
}

function normalizeModelCatalog(catalog, { isLoggedIn = false } = {}) {
  const items = Array.isArray(catalog) ? catalog : [];
  const normalized = items
    .map((item) => {
      const id = String(item?.id || "").trim();
      if (!id) {
        return null;
      }
      const fallbackLabel = GUEST_MODEL_LABELS[id] || "";
      const rawLabel = String(item?.label || item?.name || "").trim();
      const shouldUseFallback = fallbackLabel && (!rawLabel || rawLabel === id || MOJIBAKE_PATTERN.test(rawLabel));
      return {
        id,
        label: shouldUseFallback ? fallbackLabel : rawLabel || id,
        description: String(item?.description || ""),
        contextWindow: Number(item?.contextWindow || item?.contextTokens || item?.maxContextTokens || 0)
      };
    })
    .filter(Boolean);

  if (!isLoggedIn && normalized.length === 0) {
    return buildGuestModelCatalog();
  }
  return normalized;
}

const DEFAULT_SETTINGS = {
  permissions: {
    mode: "default"
  },
  access: {
    scope: "full-system"
  },
  appearance: {
    theme: "aurora",
    uiMode: "standard",
    compactMode: false,
    messageDensity: "comfortable"
  },
  localization: {
    locale: "zh-CN"
  },
  behavior: {
    enterToSend: true,
    autoScroll: true,
    showTaskPanel: false,
    confirmDangerousOps: true
  },
  agent: {
    autoSummarizeContext: true,
    contextCompressionThreshold: 0.9,
    showRuntimeMeta: true,
    showExecutionPlan: true,
    fallbackModel: "",
    suggestSkillAugmentation: true,
    autoSearchSkillsOnApproval: true,
    maxToolSteps: 120,
    maxTaskRuntimeMinutes: 240
  },
  skills: {
    disabled: []
  },
  remote: {
    baseUrl: "http://127.0.0.1:3210",
    modelListUrl: "",
    ollamaUrl: "",
    provider: "VGO Remote",
    model: "vgo-coder-pro",
    apiKey: "",
    systemPrompt: "You are VGO CODE, a practical coding agent deeply integrated with VGO AI."
  },
  remoteProfiles: [
    {
      id: DEFAULT_PROFILE_ID,
      name: "默认 VGO AI",
      provider: "VGO Remote",
      baseUrl: "http://127.0.0.1:3210",
      modelListUrl: "",
      ollamaUrl: "",
      modelCatalog: [],
      model: "vgo-coder-pro",
      apiKey: "",
      systemPrompt: "You are VGO CODE, a practical coding agent deeply integrated with VGO AI."
    },
    {
      id: "ollama-gemma4",
      name: "Gemma4 本地模型",
      provider: "Ollama",
      baseUrl: "http://localhost:11434",
      modelListUrl: "",
      ollamaUrl: "http://localhost:11434",
      modelCatalog: [],
      model: "gemma4:latest",
      apiKey: "",
      systemPrompt: ""
    },
    {
      id: "ollama-gemma4-e4b",
      name: "Gemma4 E4B 本地模型",
      provider: "Ollama",
      baseUrl: "http://localhost:11434",
      modelListUrl: "",
      ollamaUrl: "http://localhost:11434",
      modelCatalog: [],
      model: "gemma4:e4b",
      apiKey: "",
      systemPrompt: ""
    }
  ],
  activeRemoteProfileId: DEFAULT_PROFILE_ID,
  vgoAI: {
    loggedIn: false,
    email: "",
    rememberedPassword: "",
    rememberPassword: true,
    displayName: "Guest",
    accessToken: "",
    preferredModel: "vgo-coder-pro",
    linkedAt: "",
    modelCatalog: [],
    profile: null
  }
};

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "vgo-settings.json");
}

function createDefaultProfile() {
  return {
    ...DEFAULT_SETTINGS.remoteProfiles[0]
  };
}

function getBuiltInProfiles() {
  return DEFAULT_SETTINGS.remoteProfiles.map((profile) => ({ ...profile }));
}

function normalizeProfiles(parsed) {
  const existingProfiles =
    Array.isArray(parsed.remoteProfiles) && parsed.remoteProfiles.length
      ? parsed.remoteProfiles.map((profile, index) => ({
          id: profile.id || `profile-${index + 1}`,
          name: profile.name || `远程配置 ${index + 1}`,
          provider: profile.provider || "VGO Remote",
          baseUrl: profile.baseUrl || DEFAULT_SETTINGS.remote.baseUrl,
          modelListUrl: profile.modelListUrl || "",
          ollamaUrl: profile.ollamaUrl || "",
          modelCatalog: Array.isArray(profile.modelCatalog) ? profile.modelCatalog : [],
          model: profile.model || DEFAULT_SETTINGS.remote.model,
          apiKey: profile.apiKey || "",
          systemPrompt: profile.systemPrompt || DEFAULT_SETTINGS.remote.systemPrompt
        }))
      : [createDefaultProfile()];

  const profiles = existingProfiles.slice();
  for (const builtInProfile of getBuiltInProfiles()) {
    const existingIndex = profiles.findIndex((profile) => profile.id === builtInProfile.id);
    if (existingIndex >= 0) {
      // Built-in local/cloud profiles should keep their canonical wiring even if older
      // runtime sync logic previously overwrote them with a mismatched provider/model.
      profiles[existingIndex] = {
        ...profiles[existingIndex],
        ...builtInProfile
      };
      continue;
    }
    if (!profiles.some((profile) => profile.id === builtInProfile.id)) {
      profiles.push(builtInProfile);
    }
  }

  const activeRemoteProfileId = profiles.some((item) => item.id === parsed.activeRemoteProfileId)
    ? parsed.activeRemoteProfileId
    : profiles[0].id;

  const activeProfile = profiles.find((item) => item.id === activeRemoteProfileId) || profiles[0];

  return {
    profiles,
    activeRemoteProfileId,
    remote: {
      ...DEFAULT_SETTINGS.remote,
      ...(parsed.remote || {}),
      provider: activeProfile.provider,
      baseUrl: activeProfile.baseUrl,
      modelListUrl: activeProfile.modelListUrl || "",
      ollamaUrl: activeProfile.ollamaUrl || "",
      model: activeProfile.model,
      apiKey: activeProfile.apiKey,
      systemPrompt: activeProfile.systemPrompt
    }
  };
}

function loadSettings() {
  const file = getSettingsFilePath();
  try {
    if (!fs.existsSync(file)) {
      return structuredClone(DEFAULT_SETTINGS);
    }

    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeProfiles(parsed);

    return {
      permissions: {
        ...DEFAULT_SETTINGS.permissions,
        ...(parsed.permissions || {})
      },
      access: {
        ...DEFAULT_SETTINGS.access,
        ...(parsed.access || {})
      },
      appearance: {
        ...DEFAULT_SETTINGS.appearance,
        ...(parsed.appearance || {})
      },
      localization: {
        ...DEFAULT_SETTINGS.localization,
        ...(parsed.localization || {})
      },
      behavior: {
        ...DEFAULT_SETTINGS.behavior,
        ...(parsed.behavior || {})
      },
      agent: {
        ...DEFAULT_SETTINGS.agent,
        ...(parsed.agent || {})
      },
      skills: {
        ...DEFAULT_SETTINGS.skills,
        ...(parsed.skills || {}),
        disabled: Array.isArray(parsed.skills?.disabled)
          ? parsed.skills.disabled.filter((item) => typeof item === "string")
          : DEFAULT_SETTINGS.skills.disabled
      },
      remote: normalized.remote,
      remoteProfiles: normalized.profiles,
      activeRemoteProfileId: normalized.activeRemoteProfileId,
      vgoAI: {
        ...DEFAULT_SETTINGS.vgoAI,
        ...(parsed.vgoAI || {}),
        modelCatalog: normalizeModelCatalog(parsed.vgoAI?.modelCatalog, {
          isLoggedIn: Boolean(parsed.vgoAI?.loggedIn)
        })
      }
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings(settings) {
  const file = getSettingsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_PROFILE_ID,
  loadSettings,
  saveSettings
};
