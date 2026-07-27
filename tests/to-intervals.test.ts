import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  formatTime,
  toDescription,
  toIntervalsEvent,
} from '../src/lib/to-intervals';
import {
  distanceStep,
  lapPressStep,
  referenceWorkout,
  repeat,
  timeStep,
  workout,
} from './helpers';

describe('formatDistance — the m/mtr trap', () => {
  it('emits kilometres, never a bare metre value', () => {
    expect(formatDistance(400)).toBe('0.4km');
    expect(formatDistance(800)).toBe('0.8km');
    expect(formatDistance(2000)).toBe('2km');
    expect(formatDistance(1609)).toBe('1.609km');
  });

  it('never produces a digit immediately followed by a lone m', () => {
    // `400m` in Intervals.icu syntax is 400 MINUTES. If this assertion ever
    // fails, the emitter can produce a 26-hour workout that the API accepts
    // silently. See docs/intervals-syntax.md.
    for (const metres of [50, 400, 800, 1000, 1609, 5000, 21_097, 42_000]) {
      expect(formatDistance(metres)).not.toMatch(/\d\s*m$/);
      expect(formatDistance(metres)).toMatch(/km$/);
    }
  });
});

describe('formatTime', () => {
  it('uses minutes only for whole minutes', () => {
    expect(formatTime(600)).toBe('10m');
    expect(formatTime(60)).toBe('1m');
    expect(formatTime(2700)).toBe('45m');
  });

  it('uses seconds for anything else', () => {
    expect(formatTime(90)).toBe('90s');
    expect(formatTime(45)).toBe('45s');
    expect(formatTime(150)).toBe('150s');
  });
});

describe('toDescription', () => {
  it('reproduces the verified reference session', () => {
    // This exact string was confirmed to parse into the workout_doc captured in
    // docs/intervals-syntax.md, which reached a real watch.
    expect(toDescription(referenceWorkout())).toBe(
      [
        'Warmup',
        '- Press lap 2km',
        '',
        'Main set 6x',
        '- 0.8km',
        '- 90s',
        '',
        'Cooldown',
        '- Press lap 2km',
      ].join('\n'),
    );
  });

  it('marks lap-press steps with the literal flag text', () => {
    const description = toDescription(workout([lapPressStep('warmup')]));
    expect(description).toContain('Press lap');
  });

  it('puts warm-up and cool-down under headers Intervals.icu recognises', () => {
    // warmup:true / cooldown:true are derived from the header text, not the step.
    const description = toDescription(
      workout([lapPressStep('warmup'), lapPressStep('cooldown')]),
    );
    expect(description).toContain('Warmup');
    expect(description).toContain('Cooldown');
  });

  it('separates repeat blocks with blank lines', () => {
    const description = toDescription(
      workout([
        timeStep('warmup', 600),
        repeat(4, [distanceStep('run', 400), timeStep('recover', 60)]),
        timeStep('cooldown', 600),
      ]),
    );
    expect(description).toContain('\n\nMain set 4x\n');
    // 60s is a whole minute, so it goes out as "1m" — which genuinely does mean
    // one minute here. The trap is only ever a *distance* written with a bare m.
    expect(description).toMatch(/- 1m\n\nCooldown/);
  });

  it('never emits a bare metre duration anywhere in a full workout', () => {
    const description = toDescription(referenceWorkout());
    for (const line of description.split('\n')) {
      if (line.startsWith('- ')) expect(line).not.toMatch(/\d\s*m$/);
    }
  });
});

describe('toIntervalsEvent', () => {
  it('builds the calendar event shape the API expects', () => {
    const event = toIntervalsEvent(referenceWorkout(), '2026-07-28');
    expect(event.category).toBe('WORKOUT');
    expect(event.type).toBe('Run');
    expect(event.name).toBe('Tuesday intervals');
    expect(event.start_date_local).toBe('2026-07-28T00:00:00');
    expect(event.description).toContain('Main set 6x');
  });
});
