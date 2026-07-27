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

## Durations are inferred for distance steps

A step written purely as distance comes back with a `duration` the server estimated from
threshold pace:

```json
{ "distance": 800, "duration": 288 }
```

We never asked for a pace target and none is stored — this is a derived estimate for planning
totals only. **Do not read `duration` back as though we set it**, and do not treat its
presence as evidence a pace target leaked in.

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
