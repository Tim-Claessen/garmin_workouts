# Standing instructions

Read [docs/intervals-syntax.md](docs/intervals-syntax.md) before touching
anything that produces an Intervals.icu payload. It records behaviour captured
from the live API that cannot be derived from first principles.

## Rules that do not bend

- **No pace, heart-rate, power or effort targets. Ever.** There are no fields for
  them and none should be added. Their absence is the single biggest reduction in
  what the model can get wrong.
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
- **One page. No database. No accounts. No history.**
- **Step cues carry the athlete's wording, never digits.** `sanitiseCue()` strips
  every number before a note reaches the description. A cue is worth having, but
  not at the price of reintroducing the unit trap through the back door.
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
  what left the send button stranded on "Sending…" after a view change.

## Gotchas

- **Do not deploy from the CLI.** Deployment is Cloudflare Workers Builds on push
  to `main`. `npm run deploy` is for emergencies only, and even then never bare
  `wrangler deploy` — the adapter generates a second config during the build and
  wrangler deploys that one, so an unrebuilt deploy ships stale configuration.
- CI runs the Node version in `.nvmrc`. Regenerate `package-lock.json` on that
  same version or `npm ci` fails the build.
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
  build fails with EPERM.

## Testing

`npm test` stays offline and instant. The golden suite is opt-in via `PARSE_URL`
and reports a pass rate rather than failing on a single mismatch, because the
parser is a language model and the review screen is the real safety net.

The fixtures are **synthetic** — plan step 0.5 was skipped, so no real sessions
from Zoe's program exist yet. Replace them as real ones arrive.
