import { describe, expect, it } from 'vitest';
import {
  compareMonths,
  dayCellLabel,
  daysWithEntries,
  entriesPerDay,
  monthGrid,
  monthLabel,
  monthOf,
  monthRange,
  nextMonth,
  prevMonth,
  shortDate,
  WEEKDAY_HEADERS,
} from './calendar';

describe('monthGrid', () => {
  it('starts weeks on Monday and pads both ends to full weeks', () => {
    // 1 Nov 2026 is a Sunday: six padding cells before it.
    const weeks = monthGrid(2026, 11);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[1]?.[0]).toBe('2026-11-02'); // Monday
    expect(weeks[5]).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(weeks.flat().filter((d) => d !== null)).toHaveLength(30);
  });

  it('needs no leading padding when the month starts on a Monday', () => {
    // 1 Jun 2026 is a Monday.
    const weeks = monthGrid(2026, 6);
    expect(weeks[0]?.[0]).toBe('2026-06-01');
    expect(weeks[weeks.length - 1]).toEqual(['2026-06-29', '2026-06-30', null, null, null, null, null]);
  });

  it('handles February in a leap year', () => {
    // 1 Feb 2028 is a Tuesday; 2028 is a leap year, so the month ends on Tue 29.
    const weeks = monthGrid(2028, 2);
    const days = weeks.flat().filter((d): d is string => d !== null);
    expect(days).toHaveLength(29);
    expect(days[days.length - 1]).toBe('2028-02-29');
    expect(weeks[0]?.[1]).toBe('2028-02-01');
    expect(monthGrid(2026, 2).flat().filter((d) => d !== null)).toHaveLength(28);
  });

  it('fits a 28-day February starting on Monday in exactly four weeks', () => {
    // 1 Feb 2027 is a Monday.
    const weeks = monthGrid(2027, 2);
    expect(weeks).toHaveLength(4);
    expect(weeks.flat().includes(null)).toBe(false);
  });

  it('labels the columns Monday first', () => {
    expect(WEEKDAY_HEADERS[0]).toBe('Mon');
    expect(WEEKDAY_HEADERS[6]).toBe('Sun');
  });
});

describe('month navigation', () => {
  it('rolls over December to January and back', () => {
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
    expect(prevMonth(2027, 1)).toEqual({ year: 2026, month: 12 });
    expect(nextMonth(2026, 11)).toEqual({ year: 2026, month: 12 });
    expect(prevMonth(2026, 11)).toEqual({ year: 2026, month: 10 });
  });

  it('compares months across years', () => {
    expect(compareMonths({ year: 2026, month: 12 }, { year: 2027, month: 1 })).toBeLessThan(0);
    expect(compareMonths({ year: 2026, month: 11 }, { year: 2026, month: 11 })).toBe(0);
    expect(compareMonths({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBeGreaterThan(0);
  });

  it('labels and finds months', () => {
    expect(monthLabel(2026, 11)).toBe('November 2026');
    expect(monthLabel(2027, 1)).toBe('January 2027');
    expect(monthOf('2026-11-26')).toEqual({ year: 2026, month: 11 });
  });
});

describe('monthRange', () => {
  it('covers the first to the last day of the month', () => {
    expect(monthRange(2026, 11)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange(2100, 2)).toEqual({ from: '2100-02-01', to: '2100-02-28' }); // not a leap year
  });
});

describe('entries per day', () => {
  const entries = [{ worn_on: '2026-11-24' }, { worn_on: '2026-11-24' }, { worn_on: '2026-11-02' }];

  it('marks each day that has an entry', () => {
    expect(daysWithEntries(entries)).toEqual(new Set(['2026-11-24', '2026-11-02']));
    expect(daysWithEntries([]).size).toBe(0);
  });

  it('counts entries per day', () => {
    const counts = entriesPerDay(entries);
    expect(counts.get('2026-11-24')).toBe(2);
    expect(counts.get('2026-11-02')).toBe(1);
    expect(counts.get('2026-11-03')).toBeUndefined();
  });
});

describe('dayCellLabel', () => {
  const today = '2026-11-26';

  it('reads the date and how much was logged', () => {
    expect(shortDate('2026-11-24')).toBe('Tue 24 Nov');
    expect(dayCellLabel('2026-11-24', 2, today)).toBe('Tue 24 Nov, 2 outfits logged');
    expect(dayCellLabel('2026-11-23', 1, today)).toBe('Mon 23 Nov, 1 outfit logged');
    expect(dayCellLabel('2026-11-22', 0, today)).toBe('Sun 22 Nov, nothing logged');
  });

  it('marks today and leaves future days as a plain date', () => {
    expect(dayCellLabel(today, 0, today)).toBe('Thu 26 Nov, today, nothing logged');
    expect(dayCellLabel('2026-11-27', 0, today)).toBe('Fri 27 Nov');
  });
});
