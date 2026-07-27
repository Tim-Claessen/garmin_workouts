import { describe, expect, it } from 'vitest';
import { inScope, windowFor, type CalendarEvent } from '../src/lib/intervals-admin';

/**
 * This decides what gets irreversibly deleted from a real calendar, so the
 * partitioning is tested directly rather than trusted.
 */

const NOW = '2026-07-27';

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 1,
  category: 'WORKOUT',
  start_date_local: `${NOW}T00:00:00`,
  ...over,
});

describe('inScope', () => {
  it('only ever touches workouts', () => {
    // The calendar also holds season markers, notes and races. None of those
    // were created by this app.
    for (const category of ['SEASON_START', 'NOTE', 'RACE_A', undefined]) {
      for (const scope of ['future', 'past', 'all'] as const) {
        expect(inScope(event({ category }), scope, NOW), `${category}/${scope}`).toBe(false);
      }
    }
  });

  it('treats today as upcoming, not past', () => {
    const today = event({ start_date_local: `${NOW}T00:00:00` });
    expect(inScope(today, 'future', NOW)).toBe(true);
    expect(inScope(today, 'past', NOW)).toBe(false);
  });

  it('splits either side of today', () => {
    const yesterday = event({ start_date_local: '2026-07-26T00:00:00' });
    const tomorrow = event({ start_date_local: '2026-07-28T00:00:00' });

    expect(inScope(yesterday, 'past', NOW)).toBe(true);
    expect(inScope(yesterday, 'future', NOW)).toBe(false);
    expect(inScope(tomorrow, 'future', NOW)).toBe(true);
    expect(inScope(tomorrow, 'past', NOW)).toBe(false);
  });

  it('future and past are disjoint and together equal all', () => {
    const events = [
      event({ id: 1, start_date_local: '2020-01-01T00:00:00' }),
      event({ id: 2, start_date_local: '2026-07-26T00:00:00' }),
      event({ id: 3, start_date_local: `${NOW}T00:00:00` }),
      event({ id: 4, start_date_local: '2026-07-28T00:00:00' }),
      event({ id: 5, start_date_local: '2099-01-01T00:00:00' }),
    ];

    const past = events.filter((e) => inScope(e, 'past', NOW));
    const future = events.filter((e) => inScope(e, 'future', NOW));
    const all = events.filter((e) => inScope(e, 'all', NOW));

    expect(past.length + future.length).toBe(all.length);
    expect(past.filter((e) => future.includes(e))).toEqual([]);
  });

  it('ignores an event with no date rather than guessing', () => {
    const undated = event({ start_date_local: undefined });
    expect(inScope(undated, 'future', NOW)).toBe(false);
    expect(inScope(undated, 'past', NOW)).toBe(false);
  });
});

describe('windowFor', () => {
  it('asks the API for a window wide enough for each scope', () => {
    expect(windowFor('all').oldest < '2001-01-01').toBe(true);
    expect(windowFor('all').newest > '2098-01-01').toBe(true);
    expect(windowFor('future').newest > '2098-01-01').toBe(true);
    expect(windowFor('past').oldest < '2001-01-01').toBe(true);
  });
});
