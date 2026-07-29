# Standing instructions

Read [docs/intervals-syntax.md](docs/intervals-syntax.md) before touching
anything that produces an Intervals.icu payload. It records behaviour captured
from the live API that cannot be derived from first principles.

## Rules that do not bend

- **No heart-rate, power or effort targets. Ever.** There are no fields for them
  and none should be added. Intervals.icu also cannot sync two target types to
  Garmin at once, so adding one would break pace as well as itself.
- **Pace is the one target, and the model can never supply it.** It is optional,
  per step, km-only, and reachable solely from the edit sheet.
  `MODEL_JSON_SCHEMA` has no field for it, the system prompt forbids inventing
  one, and `normaliseStep` builds its steps field by field rather than spreading
  the model's object — there is a test in `parse.test.ts` asserting a pace in
  model output is discarded, and a single spread would undo it.

  This rule replaced a blanket "no pace targets, ever". The value in that rule
  was never the missing field; it was that a language model could not invent
  something prescriptive and have it reach a watch. Hand-entered-only keeps that
  property exactly, which is why a pace is never `inferred` and never wears
  `--infer`: there is nothing to confirm about a number the athlete typed.
- **A pace range is written slower-end-first, and `validate.ts` is the only thing
  that checks it.** Intervals.icu takes the two ends in written order and does
  not sort them, so a swapped pair syncs an inverted band to the watch without a
  murmur from anything in between. The sheet labels them "Slower than" and
  "Faster than" for the same reason — a faster pace is a *smaller* number, so
  min/max reads backwards, which is the m-means-minutes trap in a new costume.
- **Sending a pace target writes a threshold pace when the athlete has none.**
  Intervals.icu silently drops pace from the Garmin export without one, and the
  workout still arrives — looking complete, with no targets on it. Threshold
  gates that export rather than scaling it, verified on a watch, so the 5:00/km
  placeholder is safe and does not need to be a real figure. The write still only
  ever fills an empty field: the value drives the athlete's pace zones and load
  history inside Intervals.icu, so overwriting a real one is destructive for no
  gain.
- **Distances emit as `km`, never a bare number followed by `m`.** In
  Intervals.icu syntax `m` means minutes. This is confined to
  [src/lib/to-intervals.ts](src/lib/to-intervals.ts) so the failure is
  structurally unreachable rather than merely tested for.
- **Nothing reaches Garmin without passing through the confirmed state.** Every
  inferred value is acknowledged individually. Never add a confirm-all — that
  turns review into rubber-stamping, which is the failure the review step exists
  to prevent.
- **All colour, type and spacing decisions come from
  [docs/style-guide.md](docs/style-guide.md).** `--infer` is reserved exclusively
  for AI-inferred values awaiting confirmation and appears nowhere else — not on
  hover, not on focus, not as an accent.
- **The app is called Sessionise.** The `localStorage` key stays
  `garmin-builder:athlete` — renaming it would silently forget everyone's athlete
  choice and default them to someone else's calendar.
- **One page. No database. No accounts. No history.**
- **Step cues carry the athlete's wording, never digits.** `sanitiseCue()` strips
  every number before a note reaches the description. A cue is worth having, but
  not at the price of reintroducing the unit trap through the back door.
  The cue is editable on the review screen, which makes it the only free-text
  field besides the workout name. It is allowed to be one because
  `sanitiseCueInput()` runs on **every keystroke**, so a digit never survives long
  enough to be stored. Keep those two functions in agreement — the property the
  screen relies on is that what the field shows is what reaches the watch, and
  there is a test asserting exactly that.
- **Bulk deletion only ever touches `category: "WORKOUT"`, and never recorded
  activities.** The calendar holds season markers, notes and races this app did
  not create, and completed runs are training history. Both are off limits.
- **API keys never reach the browser.** `/api/athletes` returns ids and labels
  only. The client sends an id; credentials are resolved server-side. An unknown
  id is an error, never a fallback to the default — silently writing to the wrong
  person's calendar is the worst thing this app could do.

## Shape of the code

- `parse.ts` takes an **injected** AI runner and must not import
  `cloudflare:workers`, or it stops being importable under Node and the golden
  suite stops working. `ai.ts` is the only file that touches the binding, and the
  only one to change if this moves to AI Gateway.
- `to-intervals.ts` emits a **string**, not a JSON step tree. Intervals.icu parses
  the description server-side.
- `to-plain-english.ts` must never be model-generated. Its whole value is that it
  reflects exactly what will be sent.
- Lap-press is a **boolean flag on a step**, not a duration variant. The step
  still carries a placeholder duration that Intervals.icu requires.
- `intervals-admin.ts` and `athletes.ts` take their inputs as arguments rather
  than reading bindings, for the same reason as `parse.ts`: it keeps the logic
  that decides *what gets deleted* and *whose calendar is written to* unit
  testable under Node. `roster.ts` is the thin binding-backed wrapper.
- Client state that gates a button (`sending`) lives in a variable and is applied
  in `render()`, never written straight onto the DOM node. Writing it directly is
  what left the send button stranded on "Sending…" after a view change. The same
  rule covers the "Won't send" card (`sendFailure`) and the sheet's own fields:
  anything `paintSheet()` rewrites must be mirrored into sheet state on input, or
  a repaint discards what was just typed.
- **Confirmations are keyed by step identity, not position.** `acknowledged` is a
  `WeakSet<Step>`. Positional keys were correct only while the workout's shape was
  fixed; now that steps can be added and removed, an index-keyed confirmation
  slides onto whichever step moves into that slot — marking an unreviewed guess
  as reviewed, which is the one thing the review screen exists to prevent.
- **The review screen re-derives its validation errors on every render**, rather
  than holding the list `/api/parse` returned. Every value on that screen is
  editable, so a list computed before the first edit describes a workout that no
  longer exists.
- **A step added by hand is `parsed`, not `inferred`.** `inferred` means the model
  supplied something the text did not. Asking someone to confirm their own typing
  is how confirmation becomes a reflex.
- The stylesheet is two files on purpose. `tokens.css` is the **design export**
  and is kept identical to it, so a new export can replace it wholesale;
  `app.css` is composition above the tokens and invents no values of its own.
  Put new component CSS in `app.css`.
- Editing a step happens in **one reusable sheet**, not inline on the row. The
  row is a table row so fifteen steps can be read in one pass; putting controls
  back on it is what made the old review screen a wall of forms. Committing an
  edit still calls `acknowledge()` — changing a value is an act of review.
- The step numbering in `review.ts` counts **repeats expanded**, and `validate.ts`
  never mentions a step number: only the client knows a step's position.

## Gotchas

- **Do not deploy from the CLI.** Deployment is Cloudflare Workers Builds on push
  to `main`. `npm run deploy` is for emergencies only, and even then never bare
  `wrangler deploy` — the adapter generates a second config during the build and
  wrangler deploys that one, so an unrebuilt deploy ships stale configuration.
- CI runs the Node version in `.nvmrc`. Regenerate `package-lock.json` on that
  same version or `npm ci` fails the build.
- **Never let a Windows `npm install` write `package-lock.json`.** npm 11 on
  Windows prunes optional dependencies that do not apply to the current platform
  out of the lock while leaving the *references* to them in place. Adding two
  devDependencies this way silently dropped `@emnapi/core` and `@emnapi/runtime`
  — Linux-only optional deps of `@img/sharp-wasm32` — and `npm ci` on the Linux
  builder failed with `Missing: @emnapi/runtime from lock file`. Nothing local
  catches it: the build, the tests and the typecheck all pass on the pruned lock,
  because Windows genuinely does not need those packages.
  Regenerate with CI's own npm instead, which resolves for every platform:

  ```
  npx npm@10.9.2 install --package-lock-only
  npx npm@10.9.2 ci --dry-run          # must not report EUSAGE
  ```

  CI reports its npm version in the first lines of the build log; match it.
- CI needs **Build command `npm run build`** set in the dashboard, separate from
  the deploy command. Do not try to move this into `wrangler.jsonc` as a `build`
  block — wrangler resolves `main` at config load, before that command runs, so
  the deploy fails on a missing entry point even though the build succeeded.
- `workers_dev` and `preview_urls` must stay `false`.
- `Astro.locals.runtime.env` was removed in Astro 7. Use
  `import { env } from 'cloudflare:workers'`.
- `Astro.clientAddress` is not implemented by the Cloudflare adapter. Use the
  `cf-connecting-ip` header.
- Stop `wrangler dev` before building — it holds `dist/` open on Windows and the
  build fails with EPERM. To check a build without stopping it, pass
  `astro build --outDir <somewhere else>`.
- **Browser code and Worker code cannot share a tsconfig.**
  `worker-configuration.d.ts` declares a global `interface Element` —
  HTMLRewriter's, not the DOM's. Same-named global interfaces merge, and a member
  declared directly on the merged interface shadows the one it would otherwise
  inherit, so workerd's `append(content: string | ReadableStream | Response)`
  hides `ParentNode.append(...nodes)` and its `remove(): Element` hides
  `ChildNode.remove(): void`. That is 33 errors in `review.ts` and an
  unsatisfiable `<T extends HTMLElement>`. No lib or ordering setting fixes it.
  `tsconfig.json` covers the Worker side and excludes `src/client`;
  `tsconfig.client.json` covers the browser side and excludes the generated
  types. `npm run typecheck` runs both. `tsconfig.client.json` lists only
  `src/client/**` and lets resolution pull the rest in — if it ever fails on
  `cloudflare:workers`, a binding-backed module has been imported into the
  browser, which is the boundary working.

## Testing

`npm test` stays offline and instant. The golden suite is opt-in via `PARSE_URL`
and reports a pass rate rather than failing on a single mismatch, because the
parser is a language model and the review screen is the real safety net.

The fixtures are **synthetic** — plan step 0.5 was skipped, so no real sessions
from Zoe's program exist yet. Replace them as real ones arrive.
