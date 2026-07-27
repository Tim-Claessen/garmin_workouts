import type { Block, Step, Workout } from '../lib/schema';
import { toPlainEnglish } from '../lib/to-plain-english';

/**
 * The review screen.
 *
 * The interaction the whole design is built around: every value the model
 * inferred is amber and must be acknowledged individually. When the last one is
 * confirmed the amber disappears, the stack turns cyan, and only then does Send
 * enable. There is deliberately no confirm-all — that would turn review into
 * rubber-stamping, which is the failure mode the review step exists to prevent.
 */

interface ValidationError {
  code: string;
  blockIndex: number | null;
  stepIndex: number | null;
  message: string;
}

interface ParseResponse {
  workout: Workout;
  validationErrors: ValidationError[];
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STEP_LABEL: Record<Step['type'], string> = {
  warmup: 'Warm up',
  run: 'Run',
  recover: 'Recover',
  rest: 'Rest',
  cooldown: 'Cool down',
};

let workout: Workout | null = null;
let originalText = '';
let validationErrors: ValidationError[] = [];
/** Keys of inferred steps the user has confirmed. */
const acknowledged = new Set<string>();

function stepKey(blockIndex: number, stepIndex: number | null): string {
  return stepIndex === null ? `${blockIndex}` : `${blockIndex}.${stepIndex}`;
}

function isUnacknowledged(step: Step, key: string): boolean {
  return step.source === 'inferred' && !acknowledged.has(key);
}

function outstandingCount(): number {
  if (!workout) return 0;
  let count = 0;
  workout.blocks.forEach((block, blockIndex) => {
    if (block.kind === 'step') {
      if (isUnacknowledged(block, stepKey(blockIndex, null))) count += 1;
      return;
    }
    block.steps.forEach((step, stepIndex) => {
      if (isUnacknowledged(step, stepKey(blockIndex, stepIndex))) count += 1;
    });
  });
  return count;
}

function formatValue(step: Step): string {
  if (step.duration.kind === 'distance') {
    const metres = step.duration.metres;
    return metres >= 1000 ? `${Number((metres / 1000).toFixed(2))} km` : `${metres} m`;
  }
  const seconds = step.duration.seconds;
  if (seconds < 120) return `${seconds} s`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Current editable magnitude and unit for a step, in the unit the user sees. */
function editableValue(step: Step): { value: number; unit: string } {
  if (step.duration.kind === 'distance') {
    return step.duration.metres >= 1000
      ? { value: Number((step.duration.metres / 1000).toFixed(3)), unit: 'km' }
      : { value: step.duration.metres, unit: 'm' };
  }
  return step.duration.seconds % 60 === 0 && step.duration.seconds >= 60
    ? { value: step.duration.seconds / 60, unit: 'min' }
    : { value: step.duration.seconds, unit: 's' };
}

function applyValue(step: Step, value: number, unit: string): void {
  if (!Number.isFinite(value) || value <= 0) return;
  switch (unit) {
    case 'km':
      step.duration = { kind: 'distance', metres: Math.round(value * 1000) };
      break;
    case 'm':
      step.duration = { kind: 'distance', metres: Math.round(value) };
      break;
    case 'min':
      step.duration = { kind: 'time', seconds: Math.round(value * 60) };
      break;
    default:
      step.duration = { kind: 'time', seconds: Math.round(value) };
  }
}

function errorsFor(blockIndex: number, stepIndex: number | null): ValidationError[] {
  return validationErrors.filter(
    (error) => error.blockIndex === blockIndex && error.stepIndex === stepIndex,
  );
}

function renderStep(step: Step, blockIndex: number, stepIndex: number | null): HTMLElement {
  const key = stepKey(blockIndex, stepIndex);
  const unacknowledged = isUnacknowledged(step, key);
  const stepErrors = errorsFor(blockIndex, stepIndex);

  const item = document.createElement('li');
  item.className = 'step';
  item.dataset.inferred = String(unacknowledged);
  item.dataset.open = String(step.untilLapPress);
  if (stepErrors.length > 0) item.classList.add('error');

  const label = document.createElement('div');
  label.className = 'step__label';
  label.textContent = STEP_LABEL[step.type];
  item.append(label);

  const row = document.createElement('div');
  row.className = 'step__row';
  const value = document.createElement('span');
  if (step.untilLapPress) {
    value.className = 'step__open';
    value.textContent = 'until lap press';
  } else {
    value.className = 'step__value data';
    value.textContent = formatValue(step);
  }
  row.append(value);
  item.append(row);

  // Controls. Every field is constrained — no free text anywhere except the
  // workout name, so a mis-typed unit cannot reach the watch.
  const controls = document.createElement('div');
  controls.className = 'controls';

  const typeSelect = document.createElement('select');
  typeSelect.setAttribute('aria-label', 'Step type');
  for (const type of Object.keys(STEP_LABEL) as Step['type'][]) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = STEP_LABEL[type];
    option.selected = type === step.type;
    typeSelect.append(option);
  }
  typeSelect.addEventListener('change', () => {
    step.type = typeSelect.value as Step['type'];
    acknowledge(key);
  });
  controls.append(typeSelect);

  if (!step.untilLapPress) {
    const { value: magnitude, unit } = editableValue(step);

    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = '1';
    numberInput.step = 'any';
    numberInput.value = String(magnitude);
    numberInput.setAttribute('aria-label', 'Duration or distance');

    const unitSelect = document.createElement('select');
    unitSelect.setAttribute('aria-label', 'Unit');
    for (const option of ['s', 'min', 'm', 'km']) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      node.selected = option === unit;
      unitSelect.append(node);
    }

    const commit = () => {
      applyValue(step, Number(numberInput.value), unitSelect.value);
      acknowledge(key);
    };
    numberInput.addEventListener('change', commit);
    unitSelect.addEventListener('change', commit);

    controls.append(numberInput, unitSelect);
  }

  const lapButton = document.createElement('button');
  lapButton.type = 'button';
  lapButton.className = 'btn btn--quiet tap';
  lapButton.style.width = 'auto';
  lapButton.style.marginTop = '0';
  lapButton.textContent = step.untilLapPress ? 'Use a set duration' : 'Until lap press';
  lapButton.addEventListener('click', () => {
    step.untilLapPress = !step.untilLapPress;
    // Intervals.icu still needs a placeholder alongside the lap-press flag.
    if (step.untilLapPress && step.duration.kind === 'time') {
      step.duration = { kind: 'distance', metres: 2000 };
    }
    acknowledge(key);
  });
  controls.append(lapButton);

  item.append(controls);

  for (const error of stepErrors) {
    const message = document.createElement('p');
    message.className = 'notice error';
    message.textContent = error.message;
    item.append(message);
  }

  if (unacknowledged) {
    const ack = document.createElement('button');
    ack.type = 'button';
    ack.className = 'ack tap';
    ack.innerHTML = '<span class="ack__mark" aria-hidden="true">&#9888;</span> This was a guess — confirm it';
    ack.addEventListener('click', () => acknowledge(key));
    item.append(ack);
  }

  return item;
}

function acknowledge(key: string): void {
  acknowledged.add(key);
  render();
}

function renderBlock(block: Block, blockIndex: number): HTMLElement {
  if (block.kind === 'step') {
    return renderStep(block, blockIndex, null);
  }

  const wrapper = document.createElement('li');
  wrapper.className = 'repeat';

  const count = document.createElement('div');
  count.className = 'repeat__count data';

  const stepper = document.createElement('input');
  stepper.type = 'number';
  stepper.min = '2';
  stepper.max = '30';
  stepper.step = '1';
  stepper.value = String(block.reps);
  stepper.setAttribute('aria-label', 'Number of repeats');
  stepper.addEventListener('change', () => {
    const next = Number(stepper.value);
    if (Number.isFinite(next) && next >= 1) {
      block.reps = Math.round(next);
      render();
    }
  });

  count.append(stepper, document.createTextNode('×'));
  wrapper.append(count);

  const inner = document.createElement('ul');
  inner.className = 'stack';
  block.steps.forEach((step, stepIndex) => {
    inner.append(renderStep(step, blockIndex, stepIndex));
  });
  wrapper.append(inner);

  const blockErrors = errorsFor(blockIndex, null);
  for (const error of blockErrors) {
    const message = document.createElement('p');
    message.className = 'notice error';
    message.textContent = error.message;
    wrapper.append(message);
  }

  return wrapper;
}

function render(): void {
  if (!workout) return;

  el<HTMLInputElement>('workout-name').value = workout.name;
  el('restatement').textContent = toPlainEnglish(workout);

  const stack = el('stack');
  stack.replaceChildren();
  workout.blocks.forEach((block, blockIndex) => {
    stack.append(renderBlock(block, blockIndex));
  });

  const outstanding = outstandingCount();
  const globalErrors = validationErrors.filter((error) => error.blockIndex === null);

  const notice = el('send-notice');
  const sendButton = el<HTMLButtonElement>('send');

  if (globalErrors.length > 0) {
    notice.textContent = globalErrors[0]!.message;
    notice.className = 'notice error';
    sendButton.disabled = true;
  } else if (outstanding > 0) {
    notice.textContent =
      outstanding === 1
        ? '1 value still needs confirming before this can be sent.'
        : `${outstanding} values still need confirming before this can be sent.`;
    notice.className = 'notice';
    sendButton.disabled = true;
  } else {
    notice.textContent = 'Everything is confirmed.';
    notice.className = 'notice';
    sendButton.disabled = false;
  }
}

function show(view: 'paste' | 'review' | 'success'): void {
  for (const name of ['paste', 'review', 'success'] as const) {
    el(`view-${name}`).classList.toggle('hidden', name !== view);
  }
  // The original text is only meaningful next to the parsed result.
  el('original').classList.toggle('hidden', view !== 'review');
  document.querySelector('.shell')?.classList.toggle('shell--review', view === 'review');
}

function showError(message: string): void {
  const panel = el('parse-error');
  panel.textContent = message;
  panel.classList.remove('hidden');
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  // Local date, not UTC — a workout is planned against the day the athlete is in.
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

async function convert(): Promise<void> {
  const text = el<HTMLTextAreaElement>('paste').value;
  if (!text.trim()) {
    showError('Paste a session first.');
    return;
  }

  const button = el<HTMLButtonElement>('convert');
  button.disabled = true;
  button.textContent = 'Reading it…';
  el('parse-error').classList.add('hidden');

  try {
    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const payload = (await response.json()) as ParseResponse & { error?: string };

    if (!response.ok) {
      showError(payload.error ?? 'That could not be read. Try again.');
      return;
    }

    workout = payload.workout;
    validationErrors = payload.validationErrors ?? [];
    originalText = text;
    acknowledged.clear();
    el('original-text').textContent = originalText;
    el<HTMLInputElement>('date').value = tomorrow();
    show('review');
    render();
  } catch {
    showError('Could not reach the server. Check your connection and try again.');
  } finally {
    button.disabled = false;
    button.textContent = 'Convert';
  }
}

async function send(): Promise<void> {
  if (!workout) return;

  const button = el<HTMLButtonElement>('send');
  const date = el<HTMLInputElement>('date').value;
  button.disabled = true;
  button.textContent = 'Sending…';
  el('send-error').classList.add('hidden');

  try {
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workout, date }),
    });
    const payload = (await response.json()) as { error?: string; date?: string };

    if (!response.ok) {
      const panel = el('send-error');
      panel.textContent = payload.error ?? 'That did not send. Try again.';
      panel.classList.remove('hidden');
      button.disabled = false;
      button.textContent = 'Send to Garmin';
      return;
    }

    const when = new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', {
      weekday: 'long',
    });
    el('success-line').textContent =
      `On the calendar for ${when}. Open Garmin Connect on your phone to sync it to your watch.`;
    show('success');
  } catch {
    const panel = el('send-error');
    panel.textContent = 'Could not reach the server. Check your connection and try again.';
    panel.classList.remove('hidden');
    button.disabled = false;
    button.textContent = 'Send to Garmin';
  }
}

export function init(): void {
  el('convert').addEventListener('click', () => void convert());
  el('send').addEventListener('click', () => void send());

  el('workout-name').addEventListener('change', (event) => {
    if (workout) workout.name = (event.target as HTMLInputElement).value.trim() || 'Run session';
  });

  el('back').addEventListener('click', () => {
    show('paste');
  });

  el('again').addEventListener('click', () => {
    el<HTMLTextAreaElement>('paste').value = '';
    workout = null;
    show('paste');
  });

  el('original-toggle').addEventListener('click', () => {
    const body = el('original-body');
    const hidden = body.classList.toggle('hidden');
    el('original-toggle').textContent = hidden ? 'Show original' : 'Hide original';
  });
}
