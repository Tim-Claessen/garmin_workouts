import { describe, expect, it } from 'vitest';
import {
  CUE_MAX_LENGTH,
  formatDistance,
  formatPace,
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
  pace,
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

/**
 * Recover and rest reached the watch labelled as runs. Warm-up and cool-down get
 * their type from the section header, but a recovery inside a repeat has no
 * header of its own, so a bare `- 90s` was indistinguishable from work.
 * `intensity=` is the FIT step-intensity field Garmin reads for the label.
 */
describe('step intensity', () => {
  it('marks recover and rest so Garmin does not read them as work', () => {
    expect(formatStep(timeStep('recover', 90))).toBe('- 90s intensity=recovery');
    expect(formatStep(timeStep('rest', 120))).toBe('- 2m intensity=rest');
  });

  it('leaves the types that already arrive correctly alone', () => {
    // run is Garmin's default, and warmup/cooldown come from their headers —
    // a route captured from a real synced workout. Nothing to gain by changing it.
    expect(formatStep(distanceStep('run', 800))).toBe('- 0.8km');
    expect(formatStep(lapPressStep('warmup'))).toBe('- Press lap 2km');
    expect(formatStep(lapPressStep('cooldown'))).toBe('- Press lap 2km');
  });

  it('puts the attribute after the duration, never before it', () => {
    // Anything before the first duration is read as the cue, so an attribute
    // placed there would show up as the words "intensity=rest" on the watch.
    const step = timeStep('recover', 90, { note: 'jog back' });
    expect(formatStep(step)).toBe('- jog back 90s intensity=recovery');
    expect(formatStep(step).indexOf('90s')).toBeLessThan(
      formatStep(step).indexOf('intensity='),
    );
  });

  it('still marks the step when it also ends on a lap press', () => {
    const step = timeStep('recover', 90, { untilLapPress: true });
    expect(formatStep(step)).toBe('- Press lap 90s intensity=recovery');
  });

  it('introduces no digits, so the unit trap stays shut', () => {
    for (const step of [timeStep('recover', 90), timeStep('rest', 300)]) {
      expect(formatStep(step).split('intensity=')[1]).not.toMatch(/[0-9]/);
    }
  });
});

/**
 * The one target this app sends, and the only value on a step that cannot have
 * come from the model. The captured payload behind these assertions is in
 * docs/intervals-syntax.md:
 *
 *   - 2.5km 5:57-5:23/km Pace
 *   → {"pace":{"start":357,"end":323,"units":"secs/km"}}
 */
describe('pace targets', () => {
  it('writes the slower end first, as the captured payload does', () => {
    // 5:57 became `start` and 5:23 became `end`. Written the other way round the
    // band is inverted on the watch and nothing in between would say so.
    expect(formatPace(pace('5:57', '5:23'))).toBe('5:57-5:23/km Pace');
    expect(formatPace(pace('4:15', '3:55'))).toBe('4:15-3:55/km Pace');
  });

  it('pads seconds to two digits', () => {
    // 4:5 is not a pace. Intervals.icu would read the value differently or not
    // at all, and either way the target is not what was typed.
    expect(formatPace(pace('4:05', '3:09'))).toBe('4:05-3:09/km Pace');
    expect(formatPace(pace('4:00', '3:00'))).toBe('4:00-3:00/km Pace');
  });

  it('collapses equal ends to a single value', () => {
    expect(formatPace(pace('4:00', '4:00'))).toBe('4:00/km Pace');
  });

  it('always states the unit and the Pace keyword', () => {
    // Omitting /km falls back to the athlete's sport default — invisible state
    // that can differ per person. Omitting `Pace` means it is not read as a
    // target at all.
    for (const value of [pace('6:00', '5:30'), pace('3:30', '3:30'), pace('4:15', '3:55')]) {
      expect(formatPace(value)).toMatch(/\/km Pace$/);
    }
  });

  it('sits after the duration and before the intensity', () => {
    // Anything before the first duration is read as the step's cue, so a pace
    // placed there becomes the literal words "4:15-3:55/km Pace" on the watch.
    const step = timeStep('recover', 90, { pace: pace('6:30', '6:00') });
    const line = formatStep(step);
    expect(line).toBe('- 90s 6:30-6:00/km Pace intensity=recovery');
    expect(line.indexOf('90s')).toBeLessThan(line.indexOf('6:30'));
    expect(line.indexOf('6:30')).toBeLessThan(line.indexOf('intensity='));
  });

  it('coexists with a lap press and a cue on the same line', () => {
    const step = distanceStep('warmup', 2000, {
      untilLapPress: true,
      note: 'easy jog',
      pace: pace('6:00', '5:30'),
    });
    expect(formatStep(step)).toBe('- Press lap easy jog 2km 6:00-5:30/km Pace');
  });

  it('is absent from the line when the step has no target', () => {
    expect(formatStep(distanceStep('run', 800))).toBe('- 0.8km');
    expect(formatStep(distanceStep('run', 800))).not.toMatch(/Pace/);
  });

  it('introduces no bare metre value anywhere on the line', () => {
    // The m/mtr trap, checked across the whole step line rather than just the
    // duration — a pace adds digits to the line and must not reopen it.
    const steps = [
      distanceStep('run', 800, { pace: pace('4:15', '3:55') }),
      timeStep('recover', 90, { pace: pace('6:30', '6:00') }),
      distanceStep('warmup', 2000, { untilLapPress: true, pace: pace('6:00', '6:00') }),
    ];
    for (const step of steps) {
      expect(formatStep(step)).not.toMatch(/\d\s*m(\s|$)/);
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
    // Confirmed against the workout_doc captured in docs/intervals-syntax.md,
    // which reached a real watch — with one deliberate departure. The recovery
    // line now carries `intensity=recovery`; on the captured version it was a
    // bare `- 90s`, and that is exactly why the step arrived on the watch
    // labelled as a run. See the note in docs/intervals-syntax.md.
    expect(toDescription(referenceWorkout())).toBe(
      [
        'Warmup',
        '- Press lap 2km',
        '',
        'Main set 6x',
        '- 0.8km',
        '- 90s intensity=recovery',
        '',
        'Cooldown',
        '- Press lap 2km',
      ].join('\n'),
    );
  });

  it('carries a pace target through the whole payload', () => {
    // The end-to-end shape of a session with a target on the effort only, which
    // is how interval sessions are actually prescribed. This is the string that
    // goes over the wire; everything else about pace is a detail of producing it.
    const w = workout(
      [
        lapPressStep('warmup'),
        repeat(6, [
          distanceStep('run', 800, { pace: pace('4:15', '3:55') }),
          timeStep('recover', 90),
        ]),
        lapPressStep('cooldown'),
      ],
      'Tuesday intervals',
    );

    expect(toDescription(w)).toBe(
      [
        'Warmup',
        '- Press lap 2km',
        '',
        'Main set 6x',
        '- 0.8km 4:15-3:55/km Pace',
        '- 90s intensity=recovery',
        '',
        'Cooldown',
        '- Press lap 2km',
      ].join('\n'),
    );
  });

  it('leaves the payload byte-identical when no step carries a pace', () => {
    // The feature is optional, and a session without a target must produce the
    // exact string it produced before pace existed.
    expect(toDescription(referenceWorkout())).not.toMatch(/Pace/);
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
    // The recovery carries its step type after the duration; the blank line that
    // has to close a repeat block still follows it.
    expect(description).toMatch(/- 1m intensity=recovery\n\nCooldown/);
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
