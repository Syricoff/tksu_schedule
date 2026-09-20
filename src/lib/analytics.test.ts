import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackGroupSelect, trackTeacherSelect } from './analytics';

describe('analytics module', () => {
  beforeEach(() => {
    // @ts-expect-error test mock
    globalThis.window = {};
  });

  it('tracks group selection event when goatcounter is loaded', () => {
    const countFn = vi.fn();
    (globalThis.window as Window & { goatcounter?: { count: typeof countFn } }).goatcounter = {
      count: countFn,
    };

    trackGroupSelect('Б-ИСиТ-11');
    expect(countFn).toHaveBeenCalledWith({
      path: 'event-group/Б-ИСиТ-11',
      title: 'Б-ИСиТ-11',
      event: true,
    });
  });

  it('tracks teacher selection event when goatcounter is loaded', () => {
    const countFn = vi.fn();
    (globalThis.window as Window & { goatcounter?: { count: typeof countFn } }).goatcounter = {
      count: countFn,
    };

    trackTeacherSelect('Иванов И.И.');
    expect(countFn).toHaveBeenCalledWith({
      path: 'event-teacher/Иванов И.И.',
      title: 'Иванов И.И.',
      event: true,
    });
  });

  it('handles absence of goatcounter gracefully without throwing', () => {
    expect(() => trackGroupSelect('Б-ИСиТ-11')).not.toThrow();
    expect(() => trackTeacherSelect('Иванов И.И.')).not.toThrow();
  });
});
