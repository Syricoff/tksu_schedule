import type { RawSchedule, ScheduleKind, SchedulePeriod } from '../data/types';
import { readStorage, writeStorage } from './storage';

interface CachedSchedule {
  ts: number;
  data: RawSchedule;
}

function key(kind: ScheduleKind, entityId: string, period: SchedulePeriod): string {
  void kind;
  return `sched_${entityId}_${period.month}_${period.year}`;
}

export function getCachedSchedule(
  kind: ScheduleKind,
  entityId: string,
  period: SchedulePeriod,
): CachedSchedule | null {
  const value = readStorage(key(kind, entityId, period));
  if (!value) return null;
  try {
    return JSON.parse(value) as CachedSchedule;
  } catch {
    return null;
  }
}

export function cacheSchedule(
  kind: ScheduleKind,
  entityId: string,
  period: SchedulePeriod,
  data: RawSchedule,
): void {
  writeStorage(key(kind, entityId, period), JSON.stringify({ ts: Date.now(), data }));
}