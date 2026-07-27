import type { Block, Step, Workout } from './schema';

/**
 * A plain-English restatement of the structured workout, generated on the client
 * from the data itself rather than from the model. It exists so the meaning of
 * the workout can be checked in one read, without decoding a step stack.
 *
 * It must never be produced by an LLM: the whole point is that it reflects
 * exactly what will be sent, so that a mis-parse reads as obviously wrong.
 */

function describeDuration(step: Step): string {
  if (step.untilLapPress) return 'until you press lap';

  if (step.duration.kind === 'distance') {
    const metres = step.duration.metres;
    return metres >= 1000
      ? `${Number((metres / 1000).toFixed(2))}km`
      : `${metres}m`;
  }

  const seconds = step.duration.seconds;
  // Recoveries are spoken in seconds — "90s recovery", not "1m30s" — because
  // that is how sessions are written and how runners think about them. Only
  // once past two minutes does a minute figure read more naturally.
  if (seconds < 120) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

const VERB: Record<Step['type'], string> = {
  warmup: 'warm up',
  run: 'run',
  recover: 'recover',
  rest: 'rest',
  cooldown: 'cool down',
};

function describeStep(step: Step): string {
  const duration = describeDuration(step);
  const verb = VERB[step.type];

  if (step.untilLapPress) return `${verb} ${duration}`;
  if (step.type === 'run') return duration;
  return `${verb} for ${duration}`;
}

function describeBlock(block: Block): string {
  if (block.kind === 'step') return describeStep(block);

  const parts = block.steps.map((step) => describeStep(step));

  // The common shape is effort + recovery, which reads best as
  // "6 × 800m with 90s recovery" rather than as two clauses.
  const second = block.steps[1];
  if (
    block.steps.length === 2 &&
    second &&
    (second.type === 'recover' || second.type === 'rest') &&
    !second.untilLapPress
  ) {
    const noun = second.type === 'recover' ? 'recovery' : 'rest';
    return `${block.reps} × ${parts[0]} with ${describeDuration(second)} ${noun}`;
  }

  return `${block.reps} × ${parts.join(', then ')}`;
}

export function toPlainEnglish(workout: Workout): string {
  if (workout.blocks.length === 0) return 'This workout has no steps.';

  const clauses = workout.blocks.map((block) => describeBlock(block));
  const sentence =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(', then ')}, then ${clauses[clauses.length - 1]}`;

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
