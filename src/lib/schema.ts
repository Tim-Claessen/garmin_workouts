import { z } from 'zod';

/**
 * The workout schema.
 *
 * Two things here differ from a naive reading of the Intervals.icu syntax, and
 * both were established empirically in the Test 0.4 spike (see
 * docs/intervals-syntax.md):
 *
 * 1. Lap-press is a *flag*, not a duration type. Intervals.icu emits
 *    `until_lap_press: true` alongside a real distance/duration, which acts as a
 *    placeholder the lap press overrides. So every step has a duration, and
 *    `untilLapPress` sits on top of it.
 * 2. The only target here is pace, and it is never model-supplied. Heart rate,
 *    power and effort have no fields at all. What made the original no-targets
 *    rule worth having was not the absence of the field but the model's
 *    inability to invent a number that prescribes effort — `pace` preserves that
 *    exactly, because nothing in parse.ts can populate it. See the note on
 *    `paceSchema`.
 */

export const STEP_TYPES = ['warmup', 'run', 'recover', 'rest', 'cooldown'] as const;
export type StepType = (typeof STEP_TYPES)[number];

/**
 * Where a value came from. `inferred` means the model supplied something the
 * source text did not state, and the review screen must have it acknowledged
 * before the workout can be sent.
 */
export const sourceSchema = z.enum(['parsed', 'inferred']);
export type Source = z.infer<typeof sourceSchema>;

export const durationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('time'),
    seconds: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('distance'),
    metres: z.number().positive(),
  }),
]);
export type Duration = z.infer<typeof durationSchema>;

/**
 * An optional pace range, held as seconds per kilometre.
 *
 * Hand-entered, always. The model is not asked for a pace, `MODEL_JSON_SCHEMA`
 * has no field for one, and `normaliseStep` cannot produce one — there is a test
 * asserting that a pace in model output is discarded. So unlike every other value
 * on a step, a pace cannot be a guess, and it is never `inferred`.
 *
 * Two ends rather than a single value because that is what Intervals.icu stores
 * (`{start, end}` in secs/km) and what Garmin shows as an alert band. They are
 * named for which is slower rather than min/max: a faster pace is a *smaller*
 * number, so "minimum pace" reads backwards to most people — the same shape of
 * trap as `m` meaning minutes. Equal ends are legal and mean a single pace.
 *
 * Bounds and the slower-must-be-slower rule live in validate.ts with the other
 * range checks, so they arrive as messages the review screen can show.
 */
export const paceSchema = z.object({
  slowerSecondsPerKm: z.number().int().positive(),
  fasterSecondsPerKm: z.number().int().positive(),
});
export type Pace = z.infer<typeof paceSchema>;

export const stepSchema = z.object({
  kind: z.literal('step'),
  type: z.enum(STEP_TYPES),
  duration: durationSchema,
  /**
   * When true, the step runs until the lap button is pressed and `duration`
   * serves only as the placeholder Intervals.icu requires.
   */
  untilLapPress: z.boolean().default(false),
  /**
   * Absent means no target, which is the default and stays the common case. It
   * is also what keeps every payload written before this field existed valid.
   */
  pace: paceSchema.optional(),
  note: z.string().max(200).optional(),
  source: sourceSchema,
});
export type Step = z.infer<typeof stepSchema>;

export const repeatSchema = z.object({
  kind: z.literal('repeat'),
  reps: z.number().int().min(2),
  steps: z.array(stepSchema).min(1),
  source: sourceSchema,
});
export type Repeat = z.infer<typeof repeatSchema>;

export const blockSchema = z.discriminatedUnion('kind', [stepSchema, repeatSchema]);
export type Block = z.infer<typeof blockSchema>;

export const workoutSchema = z.object({
  name: z.string().min(1).max(80),
  blocks: z.array(blockSchema).min(1),
});
export type Workout = z.infer<typeof workoutSchema>;

/*
 * `allSteps` and `hasUnacknowledgedInference` used to live here and were called
 * from nowhere. The second was the dangerous one: it read like the server-side
 * guard that stops an unconfirmed workout being sent, so anyone reading this file
 * would take that guard as implemented. It is not, and cannot be — `source` says
 * where a value came from, not whether a human has agreed to it, and
 * acknowledgement is client state that never crosses the wire. The review screen
 * counts outstanding confirmations itself and is the only thing that gates Send.
 */
