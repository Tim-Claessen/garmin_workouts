import { describe, expect, it } from 'vitest';
import { toPlainEnglish } from '../src/lib/to-plain-english';
import {
  distanceStep,
  lapPressStep,
  pace,
  referenceWorkout,
  repeat,
  timeStep,
  workout,
} from './helpers';

describe('toPlainEnglish', () => {
  it('restates the reference session the way the plan specifies', () => {
    expect(toPlainEnglish(referenceWorkout())).toBe(
      'Warm up until you press lap, then 6 × 800m with 90s recovery, then cool down until you press lap.',
    );
  });

  it('describes lap-press steps as open ended rather than by their placeholder', () => {
    const text = toPlainEnglish(workout([lapPressStep('warmup', 2000)]));
    expect(text).toContain('until you press lap');
    expect(text).not.toContain('2km');
  });

  it('handles a single block', () => {
    expect(toPlainEnglish(workout([timeStep('run', 1800)]))).toBe('30 minutes.');
  });

  it('states the pace target, so the restatement matches what is sent', () => {
    const text = toPlainEnglish(
      workout([distanceStep('run', 800, { pace: pace('4:15', '3:55') })]),
    );
    expect(text).toBe('800m at 4:15–3:55 per km.');
  });

  it('reads a single-value target without a range', () => {
    const text = toPlainEnglish(
      workout([distanceStep('run', 800, { pace: pace('4:00', '4:00') })]),
    );
    expect(text).toBe('800m at 4:00 per km.');
  });

  it('keeps the pace on the effort inside a collapsed repeat', () => {
    const text = toPlainEnglish(
      workout([
        repeat(6, [
          distanceStep('run', 800, { pace: pace('4:15', '3:55') }),
          timeStep('recover', 90),
        ]),
      ]),
    );
    expect(text).toBe('6 × 800m at 4:15–3:55 per km with 90s recovery.');
  });

  it('abandons the collapsed form rather than drop a pace on the recovery', () => {
    // The collapsed branch speaks the recovery through describeDuration, which
    // has no pace in it. Collapsing here would print a sentence that no longer
    // matches the payload — the one thing this module exists to prevent.
    const text = toPlainEnglish(
      workout([
        repeat(6, [
          distanceStep('run', 800, { pace: pace('4:15', '3:55') }),
          timeStep('recover', 90, { pace: pace('6:30', '6:00') }),
        ]),
      ]),
    );
    expect(text).toContain('recover for 90s at 6:30–6:00 per km');
    expect(text).not.toContain('with 90s recovery');
  });

  it('says nothing about pace when no step carries one', () => {
    expect(toPlainEnglish(referenceWorkout())).not.toMatch(/per km/);
  });

  it('joins three or more steps inside a repeat with commas', () => {
    const text = toPlainEnglish(
      workout([
        repeat(3, [
          distanceStep('run', 400),
          timeStep('recover', 60),
          timeStep('rest', 30),
        ]),
      ]),
    );
    expect(text).toContain('3 × 400m, then recover for 60s, then rest for 30s');
  });
});
