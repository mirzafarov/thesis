// System-wide security settings, editable by administrators. Values from .env are the defaults;
// once an administrator saves a value it is stored in the database and applies immediately (no restart).
import { prisma } from './prisma';

export interface SystemSettings {
  require2faForManagers: boolean;
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumber: boolean;
  passwordRequireSymbol: boolean;
  checkBreachedPasswords: boolean;
  sessionIdleMinutes: number;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  privacyPolicyVersion: string;
}

export const DEFAULT_SETTINGS: SystemSettings = {
  require2faForManagers: process.env.REQUIRE_2FA_FOR_MANAGERS !== 'false',
  passwordMinLength: 8,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireNumber: true,
  passwordRequireSymbol: true,
  checkBreachedPasswords: true,
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES || 30),
  loginMaxAttempts: 5,
  loginLockMinutes: 15,
  privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION || '1.0',
};

/** Allowed values for each setting (checked on every save). */
const RULES: { [K in keyof SystemSettings]: (v: unknown) => v is SystemSettings[K] } = {
  require2faForManagers: (v): v is boolean => typeof v === 'boolean',
  passwordMinLength: (v): v is number => Number.isInteger(v) && (v as number) >= 8 && (v as number) <= 64,
  passwordRequireUppercase: (v): v is boolean => typeof v === 'boolean',
  passwordRequireLowercase: (v): v is boolean => typeof v === 'boolean',
  passwordRequireNumber: (v): v is boolean => typeof v === 'boolean',
  passwordRequireSymbol: (v): v is boolean => typeof v === 'boolean',
  checkBreachedPasswords: (v): v is boolean => typeof v === 'boolean',
  sessionIdleMinutes: (v): v is number => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 480,
  loginMaxAttempts: (v): v is number => Number.isInteger(v) && (v as number) >= 3 && (v as number) <= 50,
  loginLockMinutes: (v): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1440,
  privacyPolicyVersion: (v): v is string => typeof v === 'string' && /^[\w.\-]{1,20}$/.test(v),
};

export const SETTING_LIMITS = {
  passwordMinLength: [8, 64], sessionIdleMinutes: [5, 480], loginMaxAttempts: [3, 50], loginLockMinutes: [1, 1440],
} as const;

// Short cache: settings are read on every request, but must apply within seconds after a change.
let cache: { value: SystemSettings; at: number } | null = null;
const CACHE_MS = 5000;

export async function getSettings(): Promise<SystemSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await prisma.systemSetting.findMany();
  const value = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const key = row.key as keyof SystemSettings;
    if (key in RULES && RULES[key](row.value)) (value as Record<string, unknown>)[key] = row.value;
  }
  cache = { value, at: Date.now() };
  return value;
}

export class InvalidSettingError extends Error {}

/** Save some settings. Returns the full settings and the list of keys that actually changed. */
export async function updateSettings(changes: Record<string, unknown>, adminId: string) {
  const current = await getSettings();
  const changed: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in RULES)) throw new InvalidSettingError(`Unknown setting: ${key}`);
    if (!RULES[key as keyof SystemSettings](value)) throw new InvalidSettingError(`Invalid value for ${key}`);
    if (current[key as keyof SystemSettings] !== value) changed.push(key);
  }
  for (const key of changed) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: changes[key] as never, updatedBy: adminId },
      update: { value: changes[key] as never, updatedBy: adminId },
    });
  }
  cache = null;
  return { settings: await getSettings(), changed };
}

/** The password rules users must follow (shown on sign-up and reset forms). */
export async function passwordPolicy() {
  const s = await getSettings();
  return {
    minLength: s.passwordMinLength,
    requireUppercase: s.passwordRequireUppercase,
    requireLowercase: s.passwordRequireLowercase,
    requireNumber: s.passwordRequireNumber,
    requireSymbol: s.passwordRequireSymbol,
    checkBreached: s.checkBreachedPasswords,
  };
}

/** Returns an error message if the password breaks the policy, otherwise null. */
export async function checkPasswordPolicy(password: unknown): Promise<string | null> {
  const p = await passwordPolicy();
  const pw = typeof password === 'string' ? password : '';
  const missing: string[] = [];
  if (p.requireUppercase && !/[A-Z]/.test(pw)) missing.push('an uppercase letter');
  if (p.requireLowercase && !/[a-z]/.test(pw)) missing.push('a lowercase letter');
  if (p.requireNumber && !/[0-9]/.test(pw)) missing.push('a number');
  if (p.requireSymbol && !/[^A-Za-z0-9]/.test(pw)) missing.push('a special character');
  if (pw.length < p.minLength || missing.length) {
    return `Password must be at least ${p.minLength} characters long${missing.length ? ' and contain ' + missing.join(', ') : ''}.`;
  }
  if (pw.length > 200) return 'Password is too long.';
  return null;
}
