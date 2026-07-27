import { describe, expect, it } from 'vitest';
import { toPlainEnglish } from '../src/lib/to-plain-english';
import {
  distanceStep,
  lapPressStep,
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
