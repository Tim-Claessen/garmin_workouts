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

## Gotchas

- Deploy with `npm run deploy`, never `wrangler deploy` alone — the adapter
  generates a second config during the build and wrangler deploys that one.
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
