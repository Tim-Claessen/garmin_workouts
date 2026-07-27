import { describe, expect, it } from 'vitest';
import {
  CUE_MAX_LENGTH,
  formatDistance,
  formatStep,
  formatTime,
  sanitiseCue,
  sanitiseCueInput,
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

describe('sanitiseCue', () => {
  it('keeps the athlete\'s wording', () => {
    expect(sanitiseCue('threshold effort')).toBe('threshold effort');
    expect(sanitiseCue('jog back')).toBe('jog back');
    expect(sanitiseCue('comfortably hard')).toBe('comfortably hard');
  });

  it('strips every digit', () => {
    // A number in a cue can be read as a duration by the Intervals.icu parser,
    // which is the 400m-becomes-400-minutes failure by another route.
    expect(sanitiseCue('400m reps')).not.toMatch(/[0-9]/);
    expect(sanitiseCue('90s recovery')).not.toMatch(/[0-9]/);
    expect(sanitiseCue('6x800')).toBe('x');
  });

  it('caps length and tidies whitespace', () => {
    expect(sanitiseCue('   easy    jog   ')).toBe('easy jog');
    expect(sanitiseCue('a'.repeat(60)).length).toBeLessThanOrEqual(24);
  });

  it('returns empty for nothing usable', () => {
    expect(sanitiseCue(undefined)).toBe('');
    expect(sanitiseCue('   ')).toBe('');
    expect(sanitiseCue('123')).toBe('');
  });
});

/**
 * The cue is editable on the review screen, which makes it the only free-text
 * field besides the workout name. It is safe to be one because this runs on every
 * keystroke: a digit is gone before it can be stored, rather than being quietly
 * removed at send time and leaving the field disagreeing with the watch.
 */
describe('sanitiseCueInput', () => {
  it('lets a trailing space stand so a second word can be typed', () => {
    // The whole reason this exists separately from sanitiseCue. Trimming on
    // every keystroke makes the space between two words impossible to enter.
    expect(sanitiseCueInput('comfortably ')).toBe('comfortably ');
    expect(sanitiseCueInput('comfortably h')).toBe('comfortably h');
  });

  it('strips digits as they are typed, leaving no gap behind them', () => {
    expect(sanitiseCueInput('800m hard')).toBe('m hard');
    // Typed one character at a time, a leading number never appears at all:
    // each keystroke is stripped and the leading space goes with it.
    expect(sanitiseCueInput('8')).toBe('');
    expect(sanitiseCueInput('80')).toBe('');
  });

  it('still drops leading whitespace, so a cue cannot start with a gap', () => {
    expect(sanitiseCueInput('   easy')).toBe('easy');
  });

  it('caps at the emitted length, so nothing is lost after the field says it fits', () => {
    expect(sanitiseCueInput('a'.repeat(60))).toHaveLength(CUE_MAX_LENGTH);
  });

  it('agrees with sanitiseCue once trimmed', () => {
    // The property the review screen depends on: what the field shows is what
    // goes out. If these two ever diverge, the field is lying.
    for (const value of [
      'threshold effort',
      '   easy    jog   ',
      '6x800',
      'comfortably hard',
      'a'.repeat(60),
      '123',
      '',
    ]) {
      expect(sanitiseCueInput(value).trim(), value).toBe(sanitiseCue(value));
    }
  });
});

describe('step cues', () => {
  it('places the cue before the duration', () => {
    const step = distanceStep('run', 800, { note: 'threshold' });
    expect(formatStep(step)).toBe('- threshold 0.8km');
  });

  it('keeps the lap-press flag first', () => {
    const step = distanceStep('warmup', 2000, { untilLapPress: true, note: 'easy jog' });
    expect(formatStep(step)).toBe('- Press lap easy jog 2km');
  });

  it('omits the cue when there is no note', () => {
    expect(formatStep(distanceStep('run', 800))).toBe('- 0.8km');
  });

  it('never lets a note reintroduce a bare metre value', () => {
    const step = distanceStep('run', 800, { note: 'do 400m floats' });
    expect(formatStep(step)).not.toMatch(/\d\s*m\b(?!$)/);
    expect(formatStep(step).endsWith('0.8km')).toBe(true);
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
