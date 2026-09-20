import type { Lesson, LessonTime, RawSchedule } from './types';

export interface ParsedSchedule {
  lessonTimes: Record<number, LessonTime>;
  lessonTimeIds: number[];
  daySlots: Record<string, Record<number, Lesson[]>>;
  raw: RawSchedule;
}

function parseDate(value: string): Date {
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return new Date(Number.NaN);
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function dateKey(date: Date): string {
  return [date.getDate(), date.getMonth() + 1, date.getFullYear()]
    .map((part) => String(part).padStart(2, '0'))
    .join('.');
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function parseScheduleData(raw: RawSchedule): ParsedSchedule {
  const lessonTimes: Record<number, LessonTime> = {};
  raw.lessonTimes.forEach((lessonTime) => { lessonTimes[lessonTime.id] = lessonTime; });
  const lessonTimeIds = raw.lessonTimes
    .map((lessonTime) => lessonTime.id)
    .sort((left, right) => {
      const a = lessonTimes[left];
      const b = lessonTimes[right];
      return (a.hour_from * 60 + a.minute_from) - (b.hour_from * 60 + b.minute_from);
    });

  const daySlots: Record<string, Record<number, Lesson[]>> = {};
  let current = parseDate(raw.start_date);
  const end = parseDate(raw.end_date);
  while (current <= end) {
    const enabled = raw.lessonTimesEnabled[String(current.getDay())];
    if (enabled) {
      const key = dateKey(current);
      daySlots[key] ??= {};
      enabled.forEach((id) => { daySlots[key][id] ??= []; });
    }
    current = addDays(current, 1);
  }

  raw.lessons.forEach((lesson) => {
    const key = dateKey(parseDate(lesson.date));
    daySlots[key] ??= {};
    daySlots[key][lesson.lesson_time_id] ??= [];
    daySlots[key][lesson.lesson_time_id].push(lesson);
  });

  return { lessonTimes, lessonTimeIds, daySlots, raw };
}

export function mergeScheduleData(items: ParsedSchedule[]): ParsedSchedule | null {
  if (!items.length) return null;
  const merged: ParsedSchedule = {
    lessonTimes: {},
    lessonTimeIds: [],
    daySlots: {},
    raw: items[0].raw,
  };
  items.forEach((item) => {
    item.lessonTimeIds.forEach((id) => { merged.lessonTimes[id] ??= item.lessonTimes[id]; });
    Object.entries(item.daySlots).forEach(([day, slots]) => {
      merged.daySlots[day] ??= {};
      Object.entries(slots).forEach(([id, lessons]) => {
        const numericId = Number(id);
        merged.daySlots[day][numericId] ??= [];
        merged.daySlots[day][numericId].push(...lessons);
      });
    });
  });
  merged.lessonTimeIds = Object.keys(merged.lessonTimes).map(Number).sort((left, right) => {
    const a = merged.lessonTimes[left];
    const b = merged.lessonTimes[right];
    return (a.hour_from * 60 + a.minute_from) - (b.hour_from * 60 + b.minute_from);
  });
  return merged;
}

export function getMonday(date: Date): Date {
  const monday = new Date(date);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function getDaysForWeek(daySlots: ParsedSchedule['daySlots'], monday: Date): string[] {
  const sunday = addDays(monday, 6);
  return Object.keys(daySlots).filter((key) => {
    const date = parseDate(key);
    return date >= monday && date <= sunday;
  }).sort((left, right) => parseDate(left).getTime() - parseDate(right).getTime());
}

export function getWeeksFromData(daySlots: ParsedSchedule['daySlots']): Date[] {
  const seen = new Set<string>();
  return Object.keys(daySlots).sort((left, right) => parseDate(left).getTime() - parseDate(right).getTime())
    .map((key) => getMonday(parseDate(key)))
    .filter((monday) => {
      const key = monday.toISOString().slice(0, 10);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}