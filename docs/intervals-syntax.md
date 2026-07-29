# Intervals.icu API — payload reference

Captured from the Test 0.4 spike on 2026-07-25 against a real account, verified against a
hand-built workout that had already synced to a watch. This is empirical, not documentation —
Intervals.icu's API is only lightly documented and the details below were confirmed by
observation.

## Auth

HTTP Basic. The username is the **literal string `API_KEY`**; the password is the athlete's
API key from their Intervals.icu settings page.

```
curl -u "API_KEY:$ICU_API_KEY" https://intervals.icu/api/v1/athlete/$ICU_ATHLETE_ID
```

Athlete IDs look like `i652699` — the leading `i` is part of the ID.

## Endpoints used

| Method   | Path                                | Purpose                     |
| -------- | ----------------------------------- | --------------------------- |
| `GET`    | `/api/v1/athlete/{id}`              | Verify credentials          |
| `GET`    | `/api/v1/athlete/{id}/events`       | List calendar events        |
| `POST`   | `/api/v1/athlete/{id}/events`       | Create a planned workout    |
| `DELETE` | `/api/v1/athlete/{id}/events/{eid}` | Remove one                  |

`GET /events` requires `oldest` and `newest` query params as `YYYY-MM-DD`.

## The central fact: you post text, not structure

**We do not build the workout structure ourselves.** The `POST` body carries a
`description` string in Intervals.icu's plain-text workout syntax, and the server parses it
into a structured `workout_doc` on save. That parsed doc is what syncs to Garmin.

A minimal create looks like:

```json
{
  "category": "WORKOUT",
  "type": "Run",
  "name": "Tuesday intervals",
  "start_date_local": "2026-07-28T00:00:00",
  "description": "Warmup\n- Press lap 2km\n\nMain set 6x\n- 800mtr\n- 90s\n\nCooldown\n- Press lap 2km"
}
```

This has a direct consequence for `to-intervals.ts`: **its job is to emit a correct
description string, not a JSON step tree.** Verified that a workout POSTed this way produces
a `workout_doc` byte-identical to one built by hand in the web UI.

### Description syntax rules

- Each step is a line beginning with `- `.
- A bare line (no `- `) is a section header. A header ending in `Nx` creates a repeat block
  over the steps beneath it.
- Leave a blank line before and after each repeat block.

## ⚠ The unit trap

**`m` means minutes. Metres are `mtr`.**

This was tested deliberately. `- 400m` inside a `4x` block produced:

```json
{ "reps": 4, "steps": [ { "duration": 24000 }, { "duration": 60 } ],
  "distance": 0, "duration": 96240 }
```

400 minutes per rep — a 26.7-hour workout, with `distance: 0`. **The API accepted it with
HTTP 200 and no warning of any kind.** Nothing downstream of us catches this; it would sync
to the watch as-is.

Correct forms:

| Intent   | Write                              | Not                |
| -------- | ---------------------------------- | ------------------ |
| Distance | `800mtr`, `2km`, `1mi`             | `800m`             |
| Time     | `10m`, `90s`, `1h2m30s`, `5'30"`   | —                  |

Emitting `km` (`0.8km`) is equally safe and sidesteps the trap entirely by never producing a
bare `m` after a number. **Prefer `km`.**

## Press-lap representation

Putting the literal text `Press lap` in a step sets `until_lap_press: true` in the parsed doc:

```json
{ "text": "Press lap", "warmup": true, "distance": 2000,
  "duration": 720, "until_lap_press": true }
```

Two things to understand:

1. **A duration or distance is still required.** `Press lap` is a flag layered on top of a
   normal step, not a duration type of its own. The `2km` above is a placeholder that the lap
   press overrides at run time.
2. **`warmup: true` / `cooldown: true` are derived from the section header text**, not from
   the step line. A header reading `Warmup` sets the flag.

The placeholder value does still feed the totals (`distance: 8800` for the workout above), so
it affects planned-load figures even though it isn't the real duration. Keep placeholders
plausible rather than minimal.

## Step type: `intensity=` ⚠ not yet confirmed against the live API

Everything else on this page was captured from real responses. **This section was
not** — it comes from the Intervals.icu forum, and needs one real send to confirm.

Section headers set `warmup: true` / `cooldown: true`, but there is no header for a
step inside a repeat, so a recovery emitted as a bare `- 90s` carried nothing to
distinguish it from work. It reached the watch labelled as a run. Headers are
otherwise only cue text, so `Recovery` and `Rest` headers on top-level steps did
not set a type either.

The mechanism is a trailing `intensity=` attribute on the step line:

```
- 90s intensity=recovery
- 5m intensity=rest
- 60m intensity=active
```

Values are the Garmin FIT step-intensity field: `active`, `rest`, `warmup`,
`cooldown`, `recovery`, `interval`, `other`.

Two things to note:

1. **It goes after the duration.** Anything before the first duration is read as
   the step's cue, so an attribute placed there becomes the literal text
   "intensity=rest" on the watch instead of setting the type.
2. **A target is not required alongside it.** The forum example `60m
   intensity=active` carries no power, pace or HR, which is what makes this usable
   here — this app emits no targets by design.

`intensity=` is a step *classification*, not an effort target. It carries no
number and prescribes nothing, so it does not breach the no-targets rule; it is
`step.type` written in the vocabulary Garmin reads.

`to-intervals.ts` emits it for `recover` and `rest` only. Warm-up and cool-down
already arrive correctly via their headers — verified below — and `run` is
Garmin's default.

**To confirm:** send a session with a recovery inside a repeat, then
`GET /api/v1/athlete/{id}/events/{eid}` and check the parsed `workout_doc` marks
that step as recovery rather than work. Delete the check-quote below when done.

> Sources: [Workout Builder — Garmin — Recovery/Rest Interval step](https://forum.intervals.icu/t/workout-builder-garmin-recovery-rest-interval-step/19540),
> [Different syntax on workout builder](https://forum.intervals.icu/t/different-syntax-on-workout-builder/125491)

## Pace targets

The one target this app sends. Captured from a real send against Tim's account on
2026-07-29, using the exact string `to-intervals.ts` emits:

```
Main set 6x
- 0.8km 4:15-3:55/km Pace
- 90s intensity=recovery

→ { "distance": 800, "duration": 196,
    "pace": { "start": 255, "end": 235, "units": "secs/km" } }
  { "duration": 90, "pace": null, "intensity": "recovery" }
```

4:15 is 255 seconds and became `start`; 3:55 is 235 and became `end`. The
recovery beside it carries `pace: null`, so a target on one step in a set does
not leak onto its neighbour.

Four things that decision follows from:

1. **The slower end is written first.** Intervals.icu takes the two in written
   order and does not sort them, so a swapped pair produces an inverted band with
   no complaint from anything downstream. `validate.ts` has the only check.
2. **The target goes after the duration.** Same rule as `intensity=`: anything
   before the first duration is read as the step's cue, so a pace placed there
   arrives on the watch as the literal words `4:15-3:55/km Pace`.
3. **Always write the unit.** Omitting `/km` makes Intervals.icu fall back to the
   athlete's sport-settings default, which can differ per person. The other
   accepted units are `/mi`, `/100m`, `/100y`, `/400m`, `/250m` and `/500m`.
4. **The trailing `Pace` keyword is required**, or the value is not read as a
   target.

Absolute paces are preferred over `%`-of-threshold and zone forms (`78-82% Pace`,
`Z2 Pace`), which exist but are the ones reported as unreliable on export.

### ⚠ Threshold pace is a prerequisite, and its absence fails silently

**Intervals.icu drops pace targets from the Garmin export when the athlete has no
run threshold pace set.** The workout still syncs. The targets are simply not on
it, and nothing anywhere says so — the reporter above saw correct `pace` values
in `workout_doc` and "No Target" on the watch. Setting a threshold and recreating
the workout fixed it.

`sport-settings.ts` therefore writes a default of 5:00/km before sending any
workout that carries a pace, and **only when the field is empty** — a real value
is never touched, because overwriting one rewrites the athlete's pace zones and
shifts their load history.

Both calls confirmed against Tim's account on 2026-07-29:

```
GET  /api/v1/athlete/{id}/sport-settings           → array of groups
PUT  /api/v1/athlete/{id}/sport-settings/{groupId} → {"threshold_pace": 3.3333333}
```

The Run group is the one whose `types` contains `"Run"` — on that account
`["Run", "VirtualRun", "TrailRun"]`, id `2699161`. `threshold_pace` is a speed in
**metres per second**, so 5:00/km is `1000/300`. **Unset reads as `null`**, not
`0` and not an absent key; `sport-settings.ts` accepts all three as unset anyway.

The same group carries `pace_zones`, `pace_zone_names` and `pace_load_type`,
which is why the write only ever fills an empty field — a threshold is the anchor
those are derived from.

### Threshold gates the export, it does not scale it — confirmed

The open question was whether a placeholder threshold would put *wrong* paces on
the watch: if the Garmin export expressed targets relative to threshold, an
arbitrary 5:00/km would scale everything silently.

**It does not.** Confirmed on 2026-07-29 by sending `0.8km 4:15-3:55/km Pace`
with the threshold set to the 5:00/km placeholder and reading the watch: the reps
showed **4:15–3:55/km**, the values as typed. Threshold acts as a gate on whether
the targets are exported at all, not as a multiplier on them.

Two other observations consistent with that: the stored `pace` is absolute
(`secs/km`, not a percentage), and the server's own duration estimate for the
step — 196 s for 800 m — is 4:05/km, the midpoint of the *target*, not anything
derived from the threshold.

So the placeholder is safe, and `DEFAULT_THRESHOLD_SECONDS_PER_KM` does not need
to be a real per-athlete figure. It still only ever fills an empty field, because
the value drives the athlete's pace zones and load figures inside Intervals.icu
even though nothing downstream of it reads the number.

### Other known limits

- **One target type per workout.** HR and pace together do not sync; steps arrive
  as "No targets". Only pace is emitted here, so this does not bite, but it rules
  out ever adding a second target type alongside it.
- Garmin Connect's phone UI has been reported not to display a pace range that
  did reach the watch. Check the device, not the app.

> Sources: [Pace targets lost in Garmin export for API-created running workouts](https://forum.intervals.icu/t/pace-targets-lost-in-garmin-export-for-api-created-running-workouts-steps-arrive-on-watch-as-no-target-parsed-correctly-in-workout-doc/130706),
> [Workout Builder Syntax Quick Guide](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701),
> [Specify workouts using absolute pace](https://forum.intervals.icu/t/specify-workouts-using-absolute-pace/115846),
> [Syncing Pace & HR targets to Garmin](https://forum.intervals.icu/t/syncing-pace-hr-targets-to-garmin/130238)

## Durations are inferred for distance steps

A step written purely as distance comes back with a `duration` the server estimated from
threshold pace:

```json
{ "distance": 800, "duration": 288 }
```

This is a derived estimate for planning totals only, and it appears whether or not the step
carries a pace target — the estimate comes from the athlete's threshold pace, not from
anything we sent. **Do not read `duration` back as though we set it**, and in particular do
not treat its presence on a target-less step as evidence a pace leaked in.

## Sync to the watch

Intervals.icu pushes roughly **one week ahead** of the current date. Workouts further out sit
on the Intervals calendar and reach Garmin only once they come inside that window. Fine for
the night-before use case, but it means a test event dated three weeks out will never appear
and that is not a bug.

Requires **Settings → Connections → Garmin Connect → "Upload planned workouts"** ticked. The
Garmin connection alone only pulls activities in; without that checkbox nothing goes out.

## Step cues

Text placed before the duration on a step line becomes the step's `text`, and is what shows
on the watch mid-run:

```
- threshold effort 0.8km   →   { text: "threshold effort", distance: 800 }
- Press lap easy jog 2km   →   { text: "Press lap easy jog", until_lap_press: true, distance: 2000 }
```

This is how the athlete's own wording reaches the watch — Intervals.icu has no separate notes
field, and `description` is the only free text.

**Cues must contain no digits.** A number in a cue can be read as a duration by the parser,
which is the unit trap by another route. `sanitiseCue()` in `to-intervals.ts` strips them.

## Notes

- Placeholders on press-lap steps feed planned-load totals even though the lap press is what
  ends the step, so a session with open-ended warm-up and cool-down reads slightly high.
- Forum reports exist of press-lap steps not rendering in the workout overview on Edge
  devices. Forerunners are the target here and are unaffected.
