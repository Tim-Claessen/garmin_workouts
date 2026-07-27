import {
  workoutSchema,
  type Block,
  type Source,
  type Step,
  type StepType,
  type Workout,
} from './schema';
import { validateWorkout, type ValidationError } from './validate';

export const PARSE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * The model-facing schema is deliberately *not* the internal one.
 *
 * Internally a block is a discriminated union of step | repeat, which is precise
 * but awkward for a model to fill in reliably. Here every block has the same
 * shape — a repeat count and a list of steps, where a plain step is just
 * `reps: 1`. Uniformity costs a normalisation pass and buys a markedly better
 * hit rate, which matters because Workers AI models are weaker at structured
 * extraction than a frontier model would be.
 */
const MODEL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reps: { type: 'integer' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['warmup', 'run', 'recover', 'rest', 'cooldown'],
                },
                durationKind: { type: 'string', enum: ['time', 'distance'] },
                seconds: { type: 'number' },
                metres: { type: 'number' },
                untilLapPress: { type: 'boolean' },
                inferred: { type: 'boolean' },
                note: { type: 'string' },
              },
              required: ['type', 'durationKind', 'untilLapPress', 'inferred'],
            },
          },
        },
        required: ['reps', 'steps'],
      },
    },
  },
  required: ['name', 'blocks'],
} as const;

export const SYSTEM_PROMPT = `You convert a pasted running session into structured JSON.

Return JSON only. No prose, no explanation, no markdown fences.

UNITS — this is the most important rule:
- "800m", "400m", "1k", "1km" are DISTANCES. Use durationKind "distance" and put the value in "metres". 800m is 800 metres, never 800 minutes.
- "90s", "2min", "10 minutes" are TIMES. Use durationKind "time" and put the value in "seconds".
- Never put a distance in "seconds" or a time in "metres".

STEP TYPES: warmup, run, recover, rest, cooldown.

REPEATS: "6 x 800m with 90s recovery" is ONE block with reps 6 and two steps: a run of 800 metres and a recover of 90 seconds. A step that is not repeated is a block with reps 1 and a single step.

NEVER INVENT:
- Do not produce pace, speed, heart rate, power or effort targets. There are no fields for them. If the source mentions them, ignore them.
- Do not add a warm-up or a cool-down that the text does not mention. If the session is only "5km tempo run", the answer is exactly one block: one run step of 5000 metres. No warm-up. No cool-down. Adding them is wrong even though most runners would do them.
- Only produce steps the text actually describes.

INFERRED VALUES — set "inferred": true on any step where you supplied something the text did not state, and false when the text stated it explicitly. Be honest: this flag is what a human reviews before the workout is sent.

OPEN-ENDED STEPS: if a warm-up or cool-down is mentioned with no duration or distance, set "untilLapPress": true, set durationKind "distance" and metres 2000 as a placeholder, and mark it inferred. If a duration IS given, use it and set untilLapPress false.

VAGUE RECOVERIES: "jog back", "same as effort", "full recovery" have no number. Choose a sensible recovery and mark it inferred: true.

NAME: use the session's own title if it has one, otherwise a short descriptive name.

NOTE — this is what the athlete reads on their watch mid-run, so use THEIR words:
- Set "note" to a short label taken from the source text, one to three words, in the wording the session used. "threshold", "hard", "jog back", "easy", "steady", "controlled".
- Copy their phrasing rather than paraphrasing it. If they wrote "comfortably hard", the note is "comfortably hard".
- Use letters only. No numbers, no units, no pace or heart-rate figures.
- If the text says nothing about how a step should feel, leave "note" out entirely. Do not invent a description.`;

interface ModelStep {
  type?: string;
  durationKind?: string;
  seconds?: number;
  metres?: number;
  untilLapPress?: boolean;
  inferred?: boolean;
  note?: string;
}

interface ModelBlock {
  reps?: number;
  steps?: ModelStep[];
}

interface ModelWorkout {
  name?: string;
  blocks?: ModelBlock[];
}

const STEP_TYPE_SET = new Set<StepType>([
  'warmup',
  'run',
  'recover',
  'rest',
  'cooldown',
]);

function toSource(inferred: unknown): Source {
  return inferred === true ? 'inferred' : 'parsed';
}

function normaliseStep(raw: ModelStep): Step | null {
  const type = STEP_TYPE_SET.has(raw.type as StepType) ? (raw.type as StepType) : null;
  if (!type) return null;

  const untilLapPress = raw.untilLapPress === true;

  let duration: Step['duration'] | null = null;
  /** True when the number below came from us, not from the model. */
  let substituted = false;

  if (raw.durationKind === 'distance' && typeof raw.metres === 'number' && raw.metres > 0) {
    duration = { kind: 'distance', metres: Math.round(raw.metres) };
  } else if (
    raw.durationKind === 'time' &&
    typeof raw.seconds === 'number' &&
    raw.seconds > 0
  ) {
    duration = { kind: 'time', seconds: Math.round(raw.seconds) };
  } else if (untilLapPress) {
    // A lap-press step still needs the placeholder Intervals.icu requires, so
    // supply one rather than discarding an otherwise good step.
    duration = { kind: 'distance', metres: 2000 };
    substituted = true;
  }

  if (!duration) return null;

  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 200) : undefined;

  return {
    kind: 'step',
    type,
    duration,
    untilLapPress,
    ...(note ? { note } : {}),
    // A step whose duration we had to substitute is inferred whatever the model
    // claimed, because we made it up rather than reading it.
    //
    // The earlier test for this was `raw.durationKind === undefined`, which never
    // fired: durationKind is required by the model schema and the prompt asks for
    // "distance" explicitly on open-ended steps. The case that actually occurs is
    // a durationKind with no usable number beside it, and it was reaching the
    // review screen as `parsed` — an invented 2 km presented as something the
    // athlete had written, needing no confirmation.
    source: substituted ? 'inferred' : toSource(raw.inferred),
  };
}

/** Collapses the model's uniform block shape into the internal step | repeat union. */
function normaliseBlock(raw: ModelBlock): Block | null {
  const steps = (raw.steps ?? [])
    .map((step) => normaliseStep(step))
    .filter((step): step is Step => step !== null);

  if (steps.length === 0) return null;

  const reps = typeof raw.reps === 'number' && raw.reps > 1 ? Math.round(raw.reps) : 1;

  if (reps === 1) {
    // A block of one rep is a plain step. If the model grouped several steps
    // under reps 1, they are independent steps — the caller flattens them.
    return steps.length === 1 ? steps[0]! : { kind: 'repeat', reps: 1, steps, source: 'parsed' };
  }

  return {
    kind: 'repeat',
    reps,
    steps,
    source: steps.some((step) => step.source === 'inferred') ? 'inferred' : 'parsed',
  };
}

export function normaliseModelOutput(raw: ModelWorkout): Workout | null {
  const blocks: Block[] = [];

  for (const rawBlock of raw.blocks ?? []) {
    const block = normaliseBlock(rawBlock);
    if (!block) continue;
    // reps === 1 with several steps means "not actually a repeat" — flatten.
    if (block.kind === 'repeat' && block.reps === 1) blocks.push(...block.steps);
    else blocks.push(block);
  }

  if (blocks.length === 0) return null;

  const candidate = {
    name: (raw.name ?? '').trim() || 'Run session',
    blocks,
  };

  const result = workoutSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

export type ParseResult =
  | { ok: true; workout: Workout; validationErrors: ValidationError[] }
  | { ok: false; reason: 'empty_input' | 'model_error' | 'unparseable'; detail?: string };

/**
 * Extracts whatever JSON object is in the model's response. JSON mode should
 * return clean JSON, but Cloudflare is explicit that conformance is not
 * guaranteed, so this copes with a fenced or prose-wrapped response rather than
 * failing the whole request over formatting.
 */
export function extractJson(response: unknown): ModelWorkout | null {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    return response as ModelWorkout;
  }
  if (typeof response !== 'string') return null;

  const trimmed = response.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const braced = trimmed.match(/\{[\s\S]*\}/);
  if (braced?.[0]) candidates.push(braced[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as ModelWorkout;
    } catch {
      // try the next shape
    }
  }
  return null;
}

/**
 * The model call, injected rather than imported.
 *
 * This module deliberately does not import `cloudflare:workers`. Doing so would
 * make it unimportable under Node, which would put the golden suite out of reach
 * of plain vitest. src/lib/ai.ts supplies the real binding-backed runner.
 */
export type AiRunner = (model: string, input: unknown) => Promise<unknown>;

export function buildRequest(text: string) {
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: MODEL_JSON_SCHEMA,
    },
  };
}

export async function parseWorkout(text: string, run: AiRunner): Promise<ParseResult> {
  if (!text.trim()) return { ok: false, reason: 'empty_input' };

  let raw: unknown;
  try {
    const result = await run(PARSE_MODEL, buildRequest(text));
    raw = (result as { response?: unknown })?.response ?? result;
  } catch (error) {
    return {
      ok: false,
      reason: 'model_error',
      detail: error instanceof Error ? error.message : 'unknown',
    };
  }

  const extracted = extractJson(raw);
  if (!extracted) return { ok: false, reason: 'unparseable' };

  const workout = normaliseModelOutput(extracted);
  if (!workout) return { ok: false, reason: 'unparseable' };

  // Validation errors are returned rather than thrown: the review screen shows
  // them against the offending step so they can be corrected by hand.
  return { ok: true, workout, validationErrors: validateWorkout(workout) };
}
