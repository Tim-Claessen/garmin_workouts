import type { Block, Workout } from '../src/lib/schema';

/**
 * Structural comparison for the golden suite.
 *
 * Deliberately ignores `name`, `note` and `source`. The name is free text and
 * the model will phrase it differently every run; `source` is a judgement about
 * what was inferred, which is genuinely subjective and is reviewed by a human
 * rather than asserted here. What must be right is the *shape*: step types,
 * durations, units and repeat counts.
 */

export interface Difference {
  path: string;
  expected: unknown;
  actual: unknown;
}

function compareBlock(
  expected: Block,
  actual: Block | undefined,
  path: string,
  differences: Difference[],
): void {
  if (!actual) {
    differences.push({ path, expected: expected.kind, actual: 'missing' });
    return;
  }

  if (expected.kind !== actual.kind) {
    differences.push({ path: `${path}.kind`, expected: expected.kind, actual: actual.kind });
    return;
  }

  if (expected.kind === 'step' && actual.kind === 'step') {
    if (expected.type !== actual.type) {
      differences.push({ path: `${path}.type`, expected: expected.type, actual: actual.type });
    }
    if (expected.untilLapPress !== actual.untilLapPress) {
      differences.push({
        path: `${path}.untilLapPress`,
        expected: expected.untilLapPress,
        actual: actual.untilLapPress,
      });
    }
    if (expected.duration.kind !== actual.duration.kind) {
      differences.push({
        path: `${path}.duration.kind`,
        expected: expected.duration.kind,
        actual: actual.duration.kind,
      });
      return;
    }
    // A fixture can mark a duration `anyValue` when the source text genuinely
    // does not state one — "jog back recovery" has no number, so 90s and 120s
    // are both defensible and scoring one as wrong measures nothing. The unit
    // and the structure are still checked; only the magnitude is free.
    if ((expected.duration as { anyValue?: boolean }).anyValue) return;

    const expectedValue =
      expected.duration.kind === 'time' ? expected.duration.seconds : expected.duration.metres;
    const actualValue =
      actual.duration.kind === 'time'
        ? actual.duration.seconds
        : (actual.duration as { metres: number }).metres;
    if (expectedValue !== actualValue) {
      differences.push({
        path: `${path}.duration.value`,
        expected: expectedValue,
        actual: actualValue,
      });
    }
    return;
  }

  if (expected.kind === 'repeat' && actual.kind === 'repeat') {
    if (expected.reps !== actual.reps) {
      differences.push({ path: `${path}.reps`, expected: expected.reps, actual: actual.reps });
    }
    const length = Math.max(expected.steps.length, actual.steps.length);
    for (let i = 0; i < length; i += 1) {
      compareBlock(expected.steps[i]!, actual.steps[i], `${path}.steps[${i}]`, differences);
    }
  }
}

export function diffWorkouts(expected: Workout, actual: Workout): Difference[] {
  const differences: Difference[] = [];
  const length = Math.max(expected.blocks.length, actual.blocks.length);
  for (let i = 0; i < length; i += 1) {
    if (!expected.blocks[i]) {
      differences.push({ path: `blocks[${i}]`, expected: 'nothing', actual: 'extra block' });
      continue;
    }
    compareBlock(expected.blocks[i]!, actual.blocks[i], `blocks[${i}]`, differences);
  }
  return differences;
}
