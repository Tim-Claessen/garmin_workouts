import type { Block, Step, Workout } from '../lib/schema';
import { toDescription } from '../lib/to-intervals';
import { toPlainEnglish } from '../lib/to-plain-english';

/**
 * The review screen.
 *
 * The interaction the whole design is built around: every value the model
 * inferred is amber and must be acknowledged individually. When the last one is
 * confirmed the amber disappears, the ready banner turns cyan, and only then
 * does Send enable. There is deliberately no confirm-all — that would turn
 * review into rubber-stamping, which is the failure mode the review step exists
 * to prevent.
 *
 * The workout renders as a table of steps rather than a column of forms, and
 * editing happens in one reusable sheet. That keeps fifteen steps readable in a
 * single pass, which is the only way "check every step" is a real instruction
 * rather than a request to scroll.
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

/**
 * Unit labels are spelled out. In Intervals.icu syntax `m` means minutes while
 * metres are `mtr`, and a picker offering both "m" and "min" reproduces exactly
 * that ambiguity in the one place a person chooses between them.
 */
const UNIT_LABEL: Record<string, string> = {
  s: 'seconds',
  min: 'minutes',
  m: 'metres',
  km: 'km',
};

let workout: Workout | null = null;
let originalText = '';
let validationErrors: ValidationError[] = [];
/**
 * Whether a send is in flight. Held in state rather than read off the button,
 * so that leaving the review view and coming back cannot strand the button
 * disabled and reading "Sending…".
 */
let sending = false;
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

/* ---- Derived figures ------------------------------------------------------ */

/*
 * The stat row is computed from the workout on every render and stored nowhere,
 * for the same reason the restatement is never model-generated: a figure that is
 * derived cannot drift from what will be sent.
 */

/** Total steps with repeat blocks expanded. */
function totalSteps(w: Workout): number {
  return w.blocks.reduce(
    (total, block) => total + (block.kind === 'step' ? 1 : block.reps * block.steps.length),
    0,
  );
}

/**
 * Distance across `run` steps only, repeats expanded. Lap-press steps are
 * excluded: their distance is the placeholder Intervals.icu requires, not a
 * distance anyone intends to cover.
 */
function workMetres(w: Workout): number {
  const add = (step: Step, times: number) =>
    step.type === 'run' && !step.untilLapPress && step.duration.kind === 'distance'
      ? step.duration.metres * times
      : 0;

  return w.blocks.reduce((total, block) => {
    if (block.kind === 'step') return total + add(block, 1);
    return total + block.steps.reduce((sum, step) => sum + add(step, block.reps), 0);
  }, 0);
}

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/* ---- Value formatting ----------------------------------------------------- */

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

/** The same amount, spelled out, for the row's screen-reader label. */
function spokenValue(step: Step): string {
  if (step.untilLapPress) return 'until you press lap';
  if (step.duration.kind === 'distance') {
    const metres = step.duration.metres;
    return metres >= 1000
      ? `${Number((metres / 1000).toFixed(2))} kilometres`
      : `${metres} metres`;
  }
  const seconds = step.duration.seconds;
  if (seconds < 120) return `${seconds} seconds`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds`;
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

/* ---- The editing sheet ---------------------------------------------------- */

/*
 * One sheet, reused for whichever step is being edited. The fields are the same
 * constrained set the row used to carry inline — no free text anywhere except
 * the workout name, so a mis-typed unit cannot reach the watch. Editing is a
 * draft until Save, so Cancel really discards.
 */

interface SheetState {
  step: Step;
  key: string;
  number: number;
  type: Step['type'];
  untilLapPress: boolean;
  value: number;
  unit: string;
  /** The Edit button that opened the sheet, so focus can be handed back. */
  opener: HTMLElement | null;
}

let sheet: SheetState | null = null;

function paintSheet(): void {
  if (!sheet) return;
  el<HTMLSelectElement>('sheet-type').value = sheet.type;
  el<HTMLInputElement>('sheet-value').value = String(sheet.value);
  el<HTMLSelectElement>('sheet-unit').value = sheet.unit;

  el('sheet-ends-set').setAttribute('aria-pressed', String(!sheet.untilLapPress));
  el('sheet-ends-lap').setAttribute('aria-pressed', String(sheet.untilLapPress));
  // A lap-press step still carries a placeholder duration, but it is not a
  // number anyone should be asked to choose.
  el('sheet-amount').classList.toggle('hidden', sheet.untilLapPress);
}

function openSheet(step: Step, key: string, number: number, opener: HTMLElement): void {
  const { value, unit } = editableValue(step);
  sheet = {
    step,
    key,
    number,
    type: step.type,
    untilLapPress: step.untilLapPress,
    value,
    unit,
    opener,
  };

  el('sheet-title').textContent = `Step ${number} — ${STEP_LABEL[step.type].toLowerCase()}`;
  paintSheet();
  el('sheet').classList.remove('hidden');
  el<HTMLSelectElement>('sheet-type').focus();
}

function closeSheet(): void {
  const opener = sheet?.opener ?? null;
  sheet = null;
  el('sheet').classList.add('hidden');
  opener?.focus();
}

function saveSheet(): void {
  if (!sheet) return;
  const { step, key } = sheet;

  step.type = sheet.type;

  if (sheet.untilLapPress !== step.untilLapPress) {
    step.untilLapPress = sheet.untilLapPress;
    // Intervals.icu still needs a placeholder alongside the lap-press flag.
    if (sheet.untilLapPress && step.duration.kind === 'time') {
      step.duration = { kind: 'distance', metres: 2000 };
    }
  }

  if (!sheet.untilLapPress) {
    applyValue(step, Number(el<HTMLInputElement>('sheet-value').value), sheet.unit);
  }

  closeSheet();
  // Changing a value is as much an act of review as agreeing with it.
  acknowledge(key);
}

/* ---- Rendering the step table --------------------------------------------- */

function renderStep(
  step: Step,
  blockIndex: number,
  stepIndex: number | null,
  number: number,
  total: number,
): HTMLElement {
  const key = stepKey(blockIndex, stepIndex);
  const unacknowledged = isUnacknowledged(step, key);
  const stepErrors = errorsFor(blockIndex, stepIndex);

  const item = document.createElement('li');
  item.className = 'step';
  item.dataset.type = step.type;
  item.dataset.inferred = String(unacknowledged);
  item.dataset.open = String(step.untilLapPress);
  item.dataset.error = String(stepErrors.length > 0);
  item.dataset.key = key;
  item.setAttribute(
    'aria-label',
    [
      `Step ${number} of ${total}`,
      STEP_LABEL[step.type].toLowerCase(),
      spokenValue(step),
      unacknowledged ? 'guessed' : null,
    ]
      .filter(Boolean)
      .join(', '),
  );

  const index = document.createElement('span');
  index.className = 'step__index';
  index.textContent = String(number);
  item.append(index);

  const main = document.createElement('div');
  main.className = 'step__main';

  const marker = document.createElement('span');
  marker.className = 'step__marker';
  main.append(marker);

  const label = document.createElement('span');
  label.className = 'step__label';
  label.textContent = STEP_LABEL[step.type];
  main.append(label);

  // The athlete's own wording, which is what shows on the watch mid-run.
  if (step.note) {
    const cue = document.createElement('span');
    cue.className = 'step__cue';
    cue.textContent = `“${step.note}”`;
    main.append(cue);
  }
  item.append(main);

  const value = document.createElement('span');
  value.className = 'step__value';
  value.textContent = step.untilLapPress ? 'Open-ended' : formatValue(step);
  item.append(value);

  const ends = document.createElement('div');
  ends.className = 'step__ends';

  const endsText = document.createElement('span');
  endsText.textContent = step.untilLapPress ? 'Until lap press' : 'Set duration';
  ends.append(endsText);

  if (unacknowledged) {
    const flag = document.createElement('span');
    flag.className = 'label step__flag';
    flag.textContent = 'Guessed';
    ends.append(flag);
  } else {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'step__edit';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit step ${number}`);
    edit.addEventListener('click', () => openSheet(step, key, number, edit));
    ends.append(edit);
  }
  item.append(ends);

  for (const error of stepErrors) {
    const message = document.createElement('p');
    message.className = 'step__error';
    message.textContent = `Step ${number}: ${error.message}`;
    item.append(message);
  }

  if (unacknowledged) {
    const guess = document.createElement('div');
    guess.className = 'step__guess';

    const explanation = document.createElement('p');
    explanation.textContent = step.untilLapPress
      ? "The text didn't say how this step ends. Running until you press lap is the model's guess."
      : `The text didn't say how long. ${formatValue(step)} is the model's guess.`;
    guess.append(explanation);

    const ack = document.createElement('button');
    ack.type = 'button';
    ack.className = 'confirm';
    ack.textContent = "That's right";
    ack.setAttribute('aria-label', `That's right — confirm step ${number}`);
    ack.addEventListener('click', () => acknowledge(key));
    guess.append(ack);

    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'btn btn--quiet';
    change.textContent = 'Change it';
    change.setAttribute('aria-label', `Change step ${number}`);
    change.addEventListener('click', () => openSheet(step, key, number, change));
    guess.append(change);

    item.append(guess);
  }

  return item;
}

function acknowledge(key: string): void {
  acknowledged.add(key);
  render();
}

/** Short summary of one pass of a repeat block: "4.8 km + 9 min". */
function repeatSummary(block: Extract<Block, { kind: 'repeat' }>): string {
  let metres = 0;
  let seconds = 0;
  for (const step of block.steps) {
    if (step.untilLapPress) continue;
    if (step.duration.kind === 'distance') metres += step.duration.metres;
    else seconds += step.duration.seconds;
  }

  const parts: string[] = [];
  if (metres > 0) {
    parts.push(
      metres * block.reps >= 1000
        ? `${Number(((metres * block.reps) / 1000).toFixed(2))} km`
        : `${metres * block.reps} m`,
    );
  }
  if (seconds > 0) parts.push(`${Math.round((seconds * block.reps) / 60)} min`);
  return parts.join(' + ');
}

/**
 * @returns the rendered node and the step number the next block starts at, so
 *   numbering runs across the whole workout with repeats expanded.
 */
function renderBlock(
  block: Block,
  blockIndex: number,
  start: number,
  total: number,
): { node: HTMLElement; next: number } {
  if (block.kind === 'step') {
    return {
      node: renderStep(block, blockIndex, null, start, total),
      next: start + 1,
    };
  }

  const wrapper = document.createElement('li');
  wrapper.className = 'repeat';

  const head = document.createElement('div');
  head.className = 'repeat__head';

  const count = document.createElement('span');
  count.className = 'repeat__count';

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
  head.append(count);

  const what = document.createElement('span');
  what.className = 'label';
  what.textContent = `Repeat ${block.steps.length} ${block.steps.length === 1 ? 'step' : 'steps'}`;
  head.append(what);

  const summary = repeatSummary(block);
  if (summary) {
    const node = document.createElement('span');
    node.className = 'repeat__summary';
    node.textContent = summary;
    head.append(node);
  }
  wrapper.append(head);

  const inner = document.createElement('ul');
  inner.className = 'repeat__inner';
  block.steps.forEach((step, stepIndex) => {
    inner.append(renderStep(step, blockIndex, stepIndex, start + stepIndex, total));
  });
  wrapper.append(inner);

  for (const error of errorsFor(blockIndex, null)) {
    const message = document.createElement('p');
    message.className = 'step__error repeat__error';
    message.textContent = error.message;
    wrapper.append(message);
  }

  return { node: wrapper, next: start + block.reps * block.steps.length };
}

/* ---- Render --------------------------------------------------------------- */

function renderNotice(outstanding: number, total: number): void {
  const notice = el('send-notice');
  notice.replaceChildren();

  const dot = document.createElement('span');
  dot.className = 'dot';
  notice.append(dot);

  const text = document.createElement('span');
  text.className = 'banner__text';
  notice.append(text);

  if (outstanding === 0) {
    notice.className = 'banner banner--ready';
    text.textContent = `All ${total} steps confirmed.`;
    return;
  }

  notice.className = 'banner banner--infer';

  if (outstanding === 1) {
    text.textContent = '1 step was guessed. Confirm it to send.';
    return;
  }

  text.append(document.createTextNode(`${outstanding} of ${total} steps were guessed.`));

  const note = document.createElement('span');
  note.className = 'banner__note';
  note.textContent = 'Confirm each one — there is no confirm-all on purpose.';
  text.append(note);

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'link';
  jump.textContent = 'Jump to first ↓';
  jump.addEventListener('click', () => {
    document
      .querySelector('.step[data-inferred="true"]')
      ?.scrollIntoView({ block: 'center' });
  });
  notice.append(jump);
}

function render(): void {
  if (!workout) return;

  el<HTMLInputElement>('workout-name').value = workout.name;
  el('restatement').textContent = toPlainEnglish(workout);

  const total = totalSteps(workout);
  const metres = workMetres(workout);
  el('stat-steps').textContent = String(total);
  el('stat-work').textContent =
    metres >= 1000 ? `${Number((metres / 1000).toFixed(2))} km` : `${metres} m`;
  el('stat-planned').textContent = formatDate(el<HTMLInputElement>('date').value);

  // What actually leaves, shown before it leaves.
  el('payload').textContent = toDescription(workout);

  const stack = el('stack');
  stack.replaceChildren();
  let number = 1;
  workout.blocks.forEach((block, blockIndex) => {
    const { node, next } = renderBlock(block, blockIndex, number, total);
    stack.append(node);
    number = next;
  });

  const outstanding = outstandingCount();
  const globalErrors = validationErrors.filter((error) => error.blockIndex === null);

  renderNotice(outstanding, total);

  // A global failure and outstanding confirmations are different problems, so
  // they get different places to appear: the banner tracks review progress, the
  // "Won't send" card states what is blocking the send.
  if (globalErrors.length > 0) showBlocker(globalErrors[0]!.message);

  const sendButton = el<HTMLButtonElement>('send');

  // Button label and enabled state are derived here on every render, so they can
  // never be left stranded by a view change part-way through a send.
  if (sending) {
    sendButton.textContent = 'Sending…';
    sendButton.disabled = true;
  } else if (outstanding > 0) {
    sendButton.textContent = `${outstanding} left to confirm`;
    sendButton.disabled = true;
  } else {
    sendButton.textContent = 'Send to watch';
    sendButton.disabled = globalErrors.length > 0;
  }
}

/** The "Won't send" card: global validation failures and send failures alike. */
function showBlocker(message: string): void {
  el('send-error-text').textContent = message;
  el('send-error').classList.remove('hidden');
}

function clearBlocker(): void {
  el('send-error').classList.add('hidden');
}

function show(view: 'paste' | 'review' | 'success'): void {
  for (const name of ['paste', 'review', 'success'] as const) {
    el(`view-${name}`).classList.toggle('hidden', name !== view);
  }
  // The spine is only meaningful once there is something to check.
  el('spine').classList.toggle('hidden', view !== 'review');
  document.querySelector('.shell')?.classList.toggle('shell--review', view === 'review');
  if (view !== 'review') closeSheetIfOpen();
}

function closeSheetIfOpen(): void {
  if (sheet) closeSheet();
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
    showError('Enter a session first.');
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
    clearBlocker();
    el('original-text').textContent = originalText;
    el<HTMLInputElement>('date').value = tomorrow();
    show('review');
    render();
  } catch {
    showError('Could not reach the server. Check your connection and try again.');
  } finally {
    button.disabled = false;
    button.textContent = 'Read it →';
  }
}

function failSend(message: string): void {
  showBlocker(message);
  sending = false;
  render();
}

async function send(): Promise<void> {
  if (!workout || sending) return;

  const date = el<HTMLInputElement>('date').value;
  clearBlocker();
  sending = true;
  render();

  try {
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workout, date, athlete: currentAthleteId() }),
    });
    const payload = (await response.json()) as { error?: string; athlete?: string };

    if (!response.ok) {
      failSend(payload.error ?? 'That did not send. Try again.');
      return;
    }

    const when = new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', {
      weekday: 'long',
    });
    const who = payload.athlete ? `${payload.athlete}'s` : 'the';
    // Success says what happens next, not that something succeeded.
    el('success-line').textContent = `On ${who} calendar for ${when}`;
    el('success-name').textContent = workout.name;

    const metres = workMetres(workout);
    el('success-meta').textContent = [
      `${totalSteps(workout)} steps`,
      metres > 0 ? `${Number((metres / 1000).toFixed(2))} km of work` : null,
      formatDate(date),
    ]
      .filter(Boolean)
      .join(' · ');

    sending = false;
    show('success');
    render();
  } catch {
    failSend('Could not reach the server. Check your connection and try again.');
  }
}

/* ---- Athletes ------------------------------------------------------------ */

/*
 * The storage key still says "garmin-builder". Renaming it to match the app's
 * name would silently forget everyone's athlete choice on the next visit, and
 * writing to the wrong person's calendar is the worst thing this app can do.
 */
const ATHLETE_STORAGE_KEY = 'garmin-builder:athlete';

/** Empty until the roster loads. Never holds credentials — labels and ids only. */
let athletes: { id: string; label: string }[] = [];

function currentAthleteId(): string | null {
  const select = document.getElementById('athlete') as HTMLSelectElement | null;
  return select?.value || null;
}

function currentAthleteLabel(): string {
  const id = currentAthleteId();
  return athletes.find((a) => a.id === id)?.label ?? 'this athlete';
}

/** Copy that names the athlete has to be repainted whenever the choice changes. */
function paintAthlete(): void {
  const label = currentAthleteLabel();
  const known = athletes.length > 0;

  el('athlete-avatar').textContent = known ? label.charAt(0).toUpperCase() : '';

  const toggle = el('clear-toggle');
  if (!toggle.dataset.open) {
    toggle.textContent = known ? `Tidy up ${label}'s calendar` : 'Tidy up the calendar';
  }
}

async function loadAthletes(): Promise<void> {
  const row = el('athlete-row');
  const select = el<HTMLSelectElement>('athlete');

  try {
    const response = await fetch('/api/athletes');
    const payload = (await response.json()) as {
      athletes?: { id: string; label: string }[];
      error?: string;
    };

    if (!response.ok || !payload.athletes?.length) {
      showError(payload.error ?? 'No athletes are set up yet.');
      return;
    }

    athletes = payload.athletes;
    select.replaceChildren();
    for (const athlete of athletes) {
      const option = document.createElement('option');
      option.value = athlete.id;
      option.textContent = athlete.label;
      select.append(option);
    }

    const remembered = localStorage.getItem(ATHLETE_STORAGE_KEY);
    if (remembered && athletes.some((a) => a.id === remembered)) {
      select.value = remembered;
    }

    select.addEventListener('change', () => {
      localStorage.setItem(ATHLETE_STORAGE_KEY, select.value);
      paintAthlete();
    });

    // With one athlete there is no choice to make, so the picker stays hidden
    // rather than presenting a menu of one.
    row.classList.toggle('hidden', athletes.length < 2);
    paintAthlete();
  } catch {
    showError('Could not load the athlete list.');
  }
}

/* ---- Clearing the Intervals.icu calendar --------------------------------- */

type ClearScope = 'future' | 'past' | 'all';

const SCOPE_LABEL: Record<ClearScope, string> = {
  future: 'upcoming workouts',
  past: 'past workouts',
  all: 'all workouts',
};

let pendingScope: ClearScope | null = null;

function clearStatus(message: string, isError = false): void {
  const node = el('clear-status');
  node.textContent = message;
  node.className = isError ? 'notice error' : 'notice';
}

async function askToClear(scope: ClearScope): Promise<void> {
  pendingScope = null;
  el('clear-confirm').classList.add('hidden');
  clearStatus('Counting…');

  try {
    const athlete = currentAthleteId();
    const response = await fetch(
      `/api/clear?scope=${scope}${athlete ? `&athlete=${encodeURIComponent(athlete)}` : ''}`,
    );
    const payload = (await response.json()) as {
      count?: number;
      athlete?: string;
      error?: string;
    };

    if (!response.ok) {
      clearStatus(payload.error ?? 'Could not reach Intervals.icu.', true);
      return;
    }

    const who = payload.athlete ?? currentAthleteLabel();

    if (!payload.count) {
      clearStatus(`No ${SCOPE_LABEL[scope]} on ${who}'s calendar.`);
      return;
    }

    pendingScope = scope;
    // Naming the athlete in the confirmation is the point: this is the one place
    // a wrong selection would be expensive and irreversible.
    el('clear-confirm-text').textContent =
      `Delete ${payload.count} planned ${payload.count === 1 ? 'workout' : 'workouts'} from ${who}'s calendar? This can't be undone. Recorded runs are never touched.`;
    el<HTMLButtonElement>('clear-go').textContent = `Delete ${payload.count}`;
    el('clear-confirm').classList.remove('hidden');
    clearStatus('');
  } catch {
    clearStatus('Could not reach the server.', true);
  }
}

async function doClear(): Promise<void> {
  if (!pendingScope) return;
  const scope = pendingScope;

  el('clear-confirm').classList.add('hidden');
  pendingScope = null;
  clearStatus('Deleting…');

  try {
    const response = await fetch('/api/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope, confirm: scope, athlete: currentAthleteId() }),
    });
    const payload = (await response.json()) as {
      deleted?: number;
      failed?: number;
      athlete?: string;
      error?: string;
    };

    if (!response.ok) {
      clearStatus(payload.error ?? 'Nothing was deleted.', true);
      return;
    }

    const failed = payload.failed ?? 0;
    clearStatus(
      failed > 0
        ? `Removed ${payload.deleted}. ${failed} could not be removed.`
        : `Removed ${payload.deleted}.`,
      failed > 0,
    );
  } catch {
    clearStatus('Could not reach the server.', true);
  }
}

/* ---- Wiring -------------------------------------------------------------- */

function initSheet(): void {
  const typeSelect = el<HTMLSelectElement>('sheet-type');
  for (const type of Object.keys(STEP_LABEL) as Step['type'][]) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = STEP_LABEL[type];
    typeSelect.append(option);
  }
  typeSelect.addEventListener('change', () => {
    if (sheet) sheet.type = typeSelect.value as Step['type'];
  });

  const unitSelect = el<HTMLSelectElement>('sheet-unit');
  for (const unit of ['s', 'min', 'm', 'km']) {
    const option = document.createElement('option');
    option.value = unit;
    option.textContent = UNIT_LABEL[unit]!;
    unitSelect.append(option);
  }
  unitSelect.addEventListener('change', () => {
    if (sheet) sheet.unit = unitSelect.value;
  });

  for (const [id, lap] of [
    ['sheet-ends-set', false],
    ['sheet-ends-lap', true],
  ] as [string, boolean][]) {
    el(id).addEventListener('click', () => {
      if (!sheet) return;
      sheet.untilLapPress = lap;
      paintSheet();
    });
  }

  el('sheet-save').addEventListener('click', () => saveSheet());
  el('sheet-cancel').addEventListener('click', () => closeSheet());
  el('sheet-close').addEventListener('click', () => closeSheet());

  // Clicking the scrim is a cancel, not a save.
  el('sheet').addEventListener('click', (event) => {
    if (event.target === el('sheet')) closeSheet();
  });

  document.addEventListener('keydown', (event) => {
    if (!sheet) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== 'Tab') return;

    // The sheet is aria-modal, so keyboard focus has to behave like it.
    const focusable = el('sheet').querySelectorAll<HTMLElement>(
      'button, select, input, a[href]',
    );
    const list = Array.from(focusable).filter((node) => node.offsetParent !== null);
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

export function init(): void {
  void loadAthletes();
  initSheet();

  el('convert').addEventListener('click', () => void convert());
  el('send').addEventListener('click', () => void send());

  el('workout-name').addEventListener('change', (event) => {
    if (workout) workout.name = (event.target as HTMLInputElement).value.trim() || 'Run session';
  });

  // The planned date is part of the derived stat row, so it repaints with it.
  el('date').addEventListener('change', () => render());

  el('back').addEventListener('click', () => {
    // Leaving mid-send abandons the request; clear the flag so returning does
    // not find the button stuck.
    sending = false;
    show('paste');
  });

  el('again').addEventListener('click', () => {
    el<HTMLTextAreaElement>('paste').value = '';
    workout = null;
    sending = false;
    clearBlocker();
    show('paste');
  });

  el('clear-toggle').addEventListener('click', () => {
    const panel = el('clear-body');
    const hidden = panel.classList.toggle('hidden');
    const toggle = el('clear-toggle');
    if (hidden) {
      delete toggle.dataset.open;
      paintAthlete();
      pendingScope = null;
      el('clear-confirm').classList.add('hidden');
      clearStatus('');
    } else {
      toggle.dataset.open = 'true';
      toggle.textContent = 'Hide';
    }
  });

  for (const scope of ['future', 'past', 'all'] as ClearScope[]) {
    el(`clear-${scope}`).addEventListener('click', () => void askToClear(scope));
  }

  el('clear-go').addEventListener('click', () => void doClear());
  el('clear-cancel').addEventListener('click', () => {
    pendingScope = null;
    el('clear-confirm').classList.add('hidden');
    clearStatus('');
  });

  el('original-toggle').addEventListener('click', () => {
    const body = el('original-body');
    const hidden = body.classList.toggle('hidden');
    el('original-toggle').textContent = hidden ? 'Show' : 'Hide';
  });
}
