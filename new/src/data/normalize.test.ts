import { describe, expect, it } from 'vitest';
import {
  getDaysForWeek,
  getMonday,
  getWeeksFromData,
  mergeScheduleData,
  parseScheduleData,
} from './normalize';
import type { RawSchedule } from './types';

const lessonTime = (id: number, hour: number) => ({
  id,
  hour_from: hour,
  minute_from: 0,
  hour_to: hour + 1,
  minute_to: 30,
});

function schedule(overrides: Partial<RawSchedule> = {}): RawSchedule {
  return {
    start_date: '07.09.2026',
    end_date: '13.09.2026',
    lessonTimes: [lessonTime(2, 10), lessonTime(1, 8)],
    lessonTimesEnabled: { '1': [1, 2], '2': [1, 2], '3': [1, 2], '4': [1, 2], '5': [1, 2], '6': [1, 2] },
    lessons: [{ id: 10, date: '07.09.2026', lesson_time_id: 1, discipline: 'Математика' }],
    ...overrides,
  };
}

describe('schedule normalization', () => {
  it('sorts lesson times and creates enabled empty slots', () => {
    const parsed = parseScheduleData(schedule());
    expect(parsed.lessonTimeIds).toEqual([1, 2]);
    expect(parsed.daySlots['08.09.2026'][2]).toEqual([]);
    expect(parsed.daySlots['07.09.2026'][1]).toHaveLength(1);
  });

  it('returns Monday for weekdays and Sunday', () => {
    expect(getMonday(new Date(2026, 8, 9))).toEqual(new Date(2026, 8, 7));
    expect(getMonday(new Date(2026, 8, 13))).toEqual(new Date(2026, 8, 7));
  });

  it('selects days and unique weeks from schedule data', () => {
    const parsed = parseScheduleData(schedule({
      end_date: '20.09.2026',
      lessonTimesEnabled: { '0': [1, 2], '1': [1, 2], '2': [1, 2], '3': [1, 2], '4': [1, 2], '5': [1, 2], '6': [1, 2] },
      lessons: [],
    }));
    expect(getDaysForWeek(parsed.daySlots, new Date(2026, 8, 7))).toContain('13.09.2026');
    expect(getWeeksFromData(parsed.daySlots)).toHaveLength(2);
  });

  it('merges lesson times and slots from multiple periods', () => {
    const first = parseScheduleData(schedule());
    const second = parseScheduleData(schedule({
      start_date: '14.09.2026',
      end_date: '20.09.2026',
      lessons: [{ id: 11, date: '14.09.2026', lesson_time_id: 2, discipline: 'Физика' }],
    }));
    const merged = mergeScheduleData([first, second]);
    expect(merged?.lessonTimeIds).toEqual([1, 2]);
    expect(merged?.daySlots['14.09.2026'][2]).toHaveLength(1);
  });
});