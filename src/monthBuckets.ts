import { MONTHS_SHORT } from './data';

// Calendar-year month/year rail model — used by both the Timeline rail and
// the On This Day list so they stay in sync and don't drift into two
// different definitions of "how far back" the app goes.
//
// Shape: the current calendar year's months, one tile each (current month
// expanded by default, the rest collapsible) — then whole prior calendar
// years collapse into a single tile apiece. Opening a year tile reveals
// that year's 12 months, which themselves collapse/expand the same way.
// This matches how Photos-style rails read: recent = fine detail, distant
// past = one flick further away.

export type MonthBucket = {
  key: string; // "2026-08"
  year: number;
  month: number; // 0-based
  label: string;
  offsets: number[]; // day offsets within this month, newest first
};

function monthOffsets(year: number, month: number, lastDay: number, today: Date): number[] {
  const offsets: number[] = [];
  for (let day = lastDay; day >= 1; day--) {
    const d = new Date(year, month, day);
    offsets.push(Math.round((d.getTime() - today.getTime()) / 86400000));
  }
  return offsets;
}

// The current calendar year, January through the current month — the
// current month only goes back to today (no future days inside it).
export function buildMonthBuckets(): MonthBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  const currentMonth = today.getMonth();
  const buckets: MonthBucket[] = [];
  for (let m = currentMonth; m >= 0; m--) {
    const lastDay = m === currentMonth ? today.getDate() : new Date(year, m + 1, 0).getDate();
    buckets.push({
      key: `${year}-${String(m + 1).padStart(2, '0')}`,
      year,
      month: m,
      label: MONTHS_SHORT[m],
      offsets: monthOffsets(year, m, lastDay, today),
    });
  }
  return buckets;
}

// A prior calendar year's 12 months, revealed once its year tile is tapped.
export function buildYearMonths(year: number): MonthBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets: MonthBucket[] = [];
  for (let m = 11; m >= 0; m--) {
    const lastDay = new Date(year, m + 1, 0).getDate();
    buckets.push({
      key: `${year}-${String(m + 1).padStart(2, '0')}`,
      year,
      month: m,
      label: MONTHS_SHORT[m],
      offsets: monthOffsets(year, m, lastDay, today),
    });
  }
  return buckets;
}

export const YEARS_BACK = 5;

// Prior calendar years, most recent first — each collapses to one tile
// until opened.
export function buildPastYears(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: YEARS_BACK }, (_, i) => currentYear - 1 - i);
}
