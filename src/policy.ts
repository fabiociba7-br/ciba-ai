export const ZERO_COST_MODELS = new Set(["@cf/google/gemma-4-26b-a4b-it"]);

export const MAX_REQUESTS_PER_MINUTE = 12;

export const MAX_ADMIN_AUTH_FAILURES_PER_MINUTE = 10;

export const getLimit = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

export const resolveModel = (settingModel?: string, environmentModel?: string): string | null => {
  const candidate = settingModel || environmentModel || "@cf/google/gemma-4-26b-a4b-it";
  return ZERO_COST_MODELS.has(candidate) ? candidate : null;
};

export const isValidAppId = (value: string): boolean => /^[A-Za-z0-9_.]{3,150}$/.test(value);
