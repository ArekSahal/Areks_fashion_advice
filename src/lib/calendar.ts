// #56 slice 3b: month calendar in the Diary tab. Pure date helpers only (tested in calendar.test.ts), so this file
// never imports supabase. Days are local calendar days as `YYYY-MM-DD`; months are 1-based (1 = January).

/** A calendar month: `month` is 1-12. */
export type YearMonth = { year: number; month: number };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Column headers for a Monday-first week (Swedish users). */
export const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseDay(day: string): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return { y, m, d };
}

/** E.g. "Mon 20 Nov" (English UI, fixed format so it reads the same on every device). */
export function shortDate(day: string): string {
  const { y, m, d } = parseDay(day);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** The month a `YYYY-MM-DD` day falls in. */
export function monthOf(day: string): YearMonth {
  const { y, m } = parseDay(day);
  return { year: y, month: m };
}

/** "November 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1] ?? ''} ${year}`;
}

export function prevMonth(year: number, month: number): YearMonth {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonth(year: number, month: number): YearMonth {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Negative if `a` is before `b`, 0 if the same month, positive if after. */
export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one (handles leap years).
  return new Date(year, month, 0).getDate();
}

/** First and last day of the month, for a `worn_on` range query. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const prefix = `${year}-${pad(month)}`;
  return { from: `${prefix}-01`, to: `${prefix}-${pad(daysInMonth(year, month))}` };
}

/**
 * The month as weeks of 7 cells, Monday first. A cell is the day (`YYYY-MM-DD`) or null for padding before the 1st
 * and after the last day, so every week has exactly 7 cells.
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Sunday (0) becomes 6
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  const total = daysInMonth(year, month);
  for (let d = 1; d <= total; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The days that have at least one diary entry. */
export function daysWithEntries(entries: readonly { worn_on: string }[]): Set<string> {
  return new Set(entries.map((e) => e.worn_on));
}

/** How many entries each day has. */
export function entriesPerDay(entries: readonly { worn_on: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.worn_on, (counts.get(e.worn_on) ?? 0) + 1);
  return counts;
}

/**
 * Screen-reader name for a day cell: "Tue 24 Nov, 2 outfits logged", "Thu 26 Nov, today, nothing logged".
 * Future days get the date only (nothing can be logged yet).
 */
export function dayCellLabel(day: string, count: number, today: string): string {
  const date = shortDate(day);
  if (day > today) return date;
  const when = day === today ? `${date}, today` : date;
  const logged = count === 0 ? 'nothing logged' : count === 1 ? '1 outfit logged' : `${count} outfits logged`;
  return `${when}, ${logged}`;
}
