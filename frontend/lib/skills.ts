export interface InstalledSkillPayload {
  skillIds: string[];
}

export function normalizeInstalledSkillIds(skillIds?: string[]) {
  const normalized = Array.from(new Set(['general-agent', ...(skillIds || [])]));
  return normalized.length ? normalized : ['general-agent'];
}
