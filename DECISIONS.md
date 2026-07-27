# Decisions

One line per decision, with the reason. Newest at the bottom.

## Product

- **Two users, no user management.** Zoe uses it, Tim maintains it. Accounts,
  roles and invitations would be more code than the app.
- **One session at a time, no history, no database.** Used roughly weekly. State
  would be the largest part of the system and buy nothing.
- **Time and distance targets only — no pace or heart rate.** Removes the
  threshold-pace setup entirely and cuts out the biggest surface for the model to
  invent something plausible and wrong.
- **Lap-button press for warm-up and cool-down.** A native Garmin duration type,
  and it matches how the sessions are already run.
- **Nothing reaches Garmin without an explicit confirm.** The core requirement.
  Inferred values are acknowledged individually — a confirm-all would make review
  a formality.

## Delivery

- **Intervals.icu → Garmin Connect, not the Garmin API directly.** Garmin's
  Training API needs a commercial developer agreement. Intervals.icu is free, is
  a sanctioned path, and supports the press-lap flag. Verified end to end to a
  real watch before any code was written.
- **`to-intervals.ts` is isolated behind the schema** so that if Intervals.icu
  changes or disappears, only the delivery layer is rewritten.
- **The emitter produces a description *string*, not a JSON step tree.** Not a
  choice — the API does not accept structured steps. It parses the description
  server-side into `workout_doc`. Established in the Test 0.4 spike.
- **Lap-press modelled as a boolean flag on a step, not a third duration type.**
  Also not a choice: Intervals.icu sets `until_lap_press` alongside a real
  distance that acts as a placeholder. The plan originally assumed the three were
  mutually exclusive; the live API says otherwise.
- **Distances always emit as kilometres.** In Intervals.icu syntax a bare `m`
  means minutes, and `- 400m` produced a 26-hour workout that the API accepted
  with HTTP 200 and no warning. Confining unit formatting to one function makes
  the failure structurally unreachable.

## Platform

- **Cloudflare Workers with static assets, not Pages.** The project began on
  Pages, but Pages went into maintenance mode in March 2026 while Workers reached
  feature parity. Workers also allows the free `workers.dev` subdomain to be
  switched off outright, which is a cleaner answer to the exposed-hostname problem
  than trying to bolt Access onto it.
- **`workers_dev` and `preview_urls` false in config, not just the dashboard.**
  Wrangler re-enables `workers.dev` on deploy unless the config says otherwise, so
  a dashboard toggle alone silently regresses.
- **Access JWT verified in the Worker as well as at the edge.** Access is the real
  gate; the JWT check means a request arriving by any other route is still
  rejected by the application.
- **`ICU_ATHLETE_ID` is a plain var, not a secret.** It is an account identifier,
  useless without the API key, and keeping it in config makes the binding
  explicit. It also cannot be both — Cloudflare rejects a secret whose name
  collides with a var.

## Parsing

- **Workers AI rather than the Anthropic API.** Chosen for consistency with the
  other projects on this account and because it removes the need to hold a model
  provider key at all. The trade is a weaker parser.
- **`@cf/meta/llama-3.3-70b-instruct-fp8-fast`.** The strongest model on the
  Workers AI JSON-mode list.
- **The weaker model is acceptable because of what sits under it.** Zod rejects
  anything structurally wrong, the range rules catch the 400-minute class of
  error, and inferred values need individual acknowledgement. Three nets. The cost
  is more amber on screen, which is annoying rather than dangerous.
- **The model-facing JSON schema is not the internal one.** Every block has the
  same shape — a repeat count and a list of steps, where a plain step is `reps: 1`
  — because a discriminated union is harder for a smaller model to fill in
  reliably. Normalisation back is one pass.
- **`parse.ts` takes an injected AI runner.** Keeps it importable under Node so
  the golden suite runs in plain vitest, and isolates the swap to AI Gateway to a
  single file.
- **The golden suite reports a pass rate rather than failing the build.** The
  parser is a language model; an occasional miss is expected and the review screen
  is the real safety net. Only a floor of 50% fails.
- **Fixtures are synthetic.** Plan step 0.5 — collecting real sessions — was
  skipped. They test the failure modes we predicted, not necessarily the ones that
  occur. Replace as real sessions arrive.

## Open

- **Whether the watch shows "until lap press" or a countdown from the
  placeholder** for a lap-press step. If it shows the countdown, the dashed-rail
  open-ended treatment on the review screen is telling Zoe something her watch
  will contradict. Needs eyes on the device.
