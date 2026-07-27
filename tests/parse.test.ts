import { describe, expect, it } from 'vitest';
import { normaliseModelOutput } from '../src/lib/parse';
import type { Step } from '../src/lib/schema';

/**
 * Normalisation, offline. This is the half of parsing that is not a language
 * model: it turns the model's uniform block shape into the internal
 * step | repeat union, and decides which values a human has to confirm.
 *
 * The golden suite in parse.golden.test.ts covers the model itself and is opt-in
 * via PARSE_URL. These are ordinary unit tests and always run.
 */

const step = (over: Record<string, unknown> = {}) => ({
  type: 'run',
  durationKind: 'distance',
  metres: 800,
  untilLapPress: false,
  inferred: false,
  ...over,
});

/** The first step of the first block, whatever shape the block took. */
function firstStep(blocks: ReturnType<typeof normaliseModelOutput>): Step {
  const block = blocks?.blocks[0];
  if (!block) throw new Error('no block');
  return block.kind === 'step' ? block : block.steps[0]!;
}

describe('normaliseModelOutput — what counts as inferred', () => {
  it('takes the model at its word when it read a value from the text', () => {
    const result = normaliseModelOutput({
      name: 'Session',
      blocks: [{ reps: 1, steps: [step()] }],
    });
    expect(firstStep(result).source).toBe('parsed');
  });

  it('marks a value the model admits it supplied', () => {
    const result = normaliseModelOutput({
      name: 'Session',
      blocks: [{ reps: 1, steps: [step({ inferred: true })] }],
    });
    expect(firstStep(result).source).toBe('inferred');
  });

  /*
   * The bug this exists for: an open-ended step arrives with a durationKind but
   * no usable number beside it, so we substitute the 2 km placeholder
   * Intervals.icu requires. That number is ours, not the athlete's, and it was
   * reaching the review screen as `parsed` — presented as something they had
   * written, and needing no confirmation.
   *
   * The old guard tested `durationKind === undefined`, which never fired: the
   * model schema makes durationKind required and the prompt asks for "distance"
   * on exactly these steps.
   */
  it('marks a placeholder we invented, whatever the model claimed', () => {
    for (const durationKind of ['distance', 'time', undefined]) {
      const result = normaliseModelOutput({
        name: 'Session',
        blocks: [
          {
            reps: 1,
            steps: [
              step({
                type: 'cooldown',
                durationKind,
                metres: undefined,
                seconds: undefined,
                untilLapPress: true,
                inferred: false,
              }),
            ],
          },
        ],
      });

      const only = firstStep(result);
      expect(only.source, `durationKind: ${durationKind}`).toBe('inferred');
      expect(only.duration).toEqual({ kind: 'distance', metres: 2000 });
      expect(only.untilLapPress).toBe(true);
    }
  });

  it('leaves a lap-press step alone when the text did give a placeholder', () => {
    // Nothing was substituted here, so the model's own honesty stands.
    const result = normaliseModelOutput({
      name: 'Session',
      blocks: [
        {
          reps: 1,
          steps: [
            step({ type: 'warmup', metres: 3000, untilLapPress: true, inferred: false }),
          ],
        },
      ],
    });

    const only = firstStep(result);
    expect(only.source).toBe('parsed');
    expect(only.duration).toEqual({ kind: 'distance', metres: 3000 });
  });

  it('drops a step with no duration and no lap press rather than inventing one', () => {
    // Nothing to fall back on: a run of unknown length is not a step, and
    // guessing a distance for it is exactly what this parser must not do.
    const result = normaliseModelOutput({
      name: 'Session',
      blocks: [
        { reps: 1, steps: [step({ metres: undefined, seconds: undefined })] },
      ],
    });
    expect(result).toBeNull();
  });
});

describe('normaliseModelOutput — block shape', () => {
  it('collapses a single-step block of one rep into a plain step', () => {
    const result = normaliseModelOutput({
      name: 'Tempo',
      blocks: [{ reps: 1, steps: [step({ metres: 5000 })] }],
    });
    expect(result?.blocks).toHaveLength(1);
    expect(result?.blocks[0]?.kind).toBe('step');
  });

  it('flattens several steps grouped under one rep', () => {
    const result = normaliseModelOutput({
      name: 'Session',
      blocks: [
        {
          reps: 1,
          steps: [step({ type: 'warmup', metres: 2000 }), step({ metres: 5000 })],
        },
      ],
    });
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks.every((block) => block.kind === 'step')).toBe(true);
  });

  it('keeps a real repeat and inherits inference from its steps', () => {
    const result = normaliseModelOutput({
      name: 'Intervals',
      blocks: [
        {
          reps: 6,
          steps: [
            step(),
            step({ type: 'recover', durationKind: 'time', seconds: 90, inferred: true }),
          ],
        },
      ],
    });

    const block = result?.blocks[0];
    expect(block?.kind).toBe('repeat');
    expect(block?.source).toBe('inferred');
  });

  it('returns null when nothing usable came back', () => {
    expect(normaliseModelOutput({ name: 'Empty', blocks: [] })).toBeNull();
    expect(normaliseModelOutput({})).toBeNull();
  });
});
