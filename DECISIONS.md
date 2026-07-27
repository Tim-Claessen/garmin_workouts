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

## Notes on the watch

- **Step cues rather than a notes field.** Intervals.icu has no separate notes
  field — `description` is the only free text and it doubles as the workout
  syntax, so the pasted session cannot be shipped verbatim without its numbers
  being parsed as durations. Text placed before the duration on a step line
  becomes the step's `text`, which is what shows on the watch. Verified against
  the live API.
- **Cues are stripped of every digit.** Not a cautious default — a number in a
  cue is the 400m-becomes-400-minutes failure by another route. The cue is worth
  having, but never at that price.
- **The model copies the athlete's phrasing rather than paraphrasing.** "jog
  back", "threshold", "comfortably hard". If the text says nothing about how a
  step should feel, the note is omitted rather than invented.

## Clearing the calendar

- **Only planned workouts are deleted, never recorded activities.** Completed
  runs are training history and live on a different endpoint. Deleting them was
  never the intent behind "clear all activities" — the clutter this app creates
  is planned workouts.
- **Only `category: "WORKOUT"`.** The calendar also holds season markers, notes
  and races. A real `SEASON_START` event on the calendar during development made
  this concrete rather than theoretical.
- **Today counts as upcoming, not past.** Keeps the two scopes disjoint and stops
  a workout planned for this morning being swept up by "past".
- **Count first, then confirm.** The confirmation states a number and the client
  must echo the scope back to the endpoint. There is no undo, so a stray POST
  should not be enough.

## Athletes

- **A roster in one JSON secret, not a pair of bindings per person.** Adding
  someone is one `wrangler secret put` and no code change, and there is still
  nothing persisted — the roster is configuration, so the no-database decision
  holds.
- **Cloudflare Access is the wrong layer for this.** Access controls who can open
  the app. Which Intervals.icu calendar receives a workout is a different
  question, and conflating them would mean a network policy change every time
  someone new is added.
- **API keys never reach the browser.** The client sees ids and labels; the
  Worker resolves credentials.
- **An unknown athlete id is an error, not a fallback to the default.** Failing a
  request is recoverable. Silently writing to the wrong person's calendar is not.
- **The picker is hidden with a single athlete**, rather than presenting a menu
  of one.
- **Both the send confirmation and the delete confirmation name the athlete.**
  With several configured, that wording is the only thing between a mis-set
  picker and someone else's training plan.

## Known characteristics

- **A lap-press step carries a 2km placeholder**, because Intervals.icu requires
  a duration alongside the flag. The placeholder feeds planned-load totals even
  though the lap press is what actually ends the step, so figures for a session
  with open-ended warm-up and cool-down read slightly high. Accepted: the
  alternative is a placeholder so small it looks wrong on the watch.
- **The roster is re-read on every request.** No caching. Fine at one session a
  week, and it means a secret change takes effect immediately.
- **A clear deletes at most 200 workouts per press.** Intervals.icu has no bulk
  delete, so a clear costs one subrequest per workout and a full season's
  calendar can exceed what one Worker invocation is allowed — where it would die
  part-way with no record of how far it got. Oldest first, so a capped run always
  clears a prefix and pressing again resumes exactly where it stopped. The status
  line says how many are left.
- **The browser tells the Worker what day it is, within a day.** A Worker's clock
  is UTC, which in Australia is still yesterday for the first ten hours of every
  local day — long enough for "upcoming" to sweep up a session already run this
  morning. `resolveToday()` honours the browser's date only when it is well-formed
  and within one day of UTC: the exact span real timezone offsets cover, so a
  wrong or crafted clock cannot widen an irreversible deletion beyond it.
