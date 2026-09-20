export const storageKeys = {
  activeTab: 'active_tab',
  studentGroup: 'stu_group',
  teacher: 'tch_staff',
  savedGroups: 'saved_groups',
} as const;

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be disabled or full; the app remains usable without persistence.
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const value = readStorage(key);
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}