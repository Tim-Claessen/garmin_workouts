# Garmin Workout Builder — Development Plan

A single-page tool that turns a pasted running session into a structured workout on Zoe's Garmin, with a mandatory human review step in between.

---

## Status — 27 July 2026

**Phases 0 through 5 are built and deployed.** Live at `run.timclaessen.com` behind Cloudflare Access. 40 offline tests pass; the golden suite measures 5/6 (83%).

This plan is kept as the original reasoning. Where the build disagrees with it, **the build is right** — several assumptions here were disproved by the live API. Current truth lives in [README.md](README.md), [DECISIONS.md](DECISIONS.md) and [docs/intervals-syntax.md](docs/intervals-syntax.md); outstanding work is the TODO section of the README.

### What the plan got wrong

| Plan said | Reality |
| --- | --- |
| Duration is one of time, distance, **or lap-press** | Lap-press is a **flag** on a step that still carries a placeholder duration. Not mutually exclusive |
| `to-intervals.ts` emits an event payload | It emits a **description string**. The API does not accept a structured step tree; it parses text server-side |
| Anthropic API for parsing | **Workers AI** (`llama-3.3-70b`, JSON-schema mode). No model provider key stored at all |
| Astro + Cloudflare **Pages** | **Workers with static assets**. Pages entered maintenance mode in March 2026 |
| Three secrets incl. `ANTHROPIC_API_KEY` | Two. Workers AI is a binding |

### What was skipped

**Test 0.5 — collecting 5–8 real sessions.** The fixtures are synthetic, so the 83% measures the failure modes we *predicted*, not necessarily the ones that occur. Replacing them is the highest-value quality task outstanding.

### What was added beyond the plan

- **Step cues** carrying the athlete's own wording ("threshold", "jog back") through to the watch, since Intervals.icu has no notes field
- **Bulk clearing** of planned workouts — upcoming, past or all — because the Intervals.icu interface makes tidying painful
- **Access JWT verification** inside the Worker, on top of edge Access
- **CI deployment** via Cloudflare Workers Builds on push to `main`

---

## 0. Decisions locked in

| Decision          | Choice                                              | Why                                                                   |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| Users             | Zoe (primary), Tim (setup/admin)                    | Two people, no user management needed                                 |
| Frequency         | One session at a time, ~weekly                      | Stateless app, no history, no database                                |
| Targets           | Time and distance only. No pace or HR targets       | Removes threshold-pace setup and the biggest AI hallucination surface |
| Open-ended steps  | Lap-button-press for warm-up and cool-down          | Matches how Zoe already runs. ⚠ Implemented as a *flag* plus a placeholder duration, not a duration type — see the status section |
| Delivery to watch | Intervals.icu API → Garmin Connect sync             | Sanctioned API, free, supports the press-lap flag                     |
| Auth              | Cloudflare Access, email OTP, two-address allowlist | Protects the credentials. No code, no password reset flow             |
| Stack             | Astro + Cloudflare **Workers** (static assets)      | Pages entered maintenance mode; Workers reached parity                |
| Parsing           | **Workers AI**, not the Anthropic API               | No model provider key stored anywhere; consistent with the other projects on the account |
| Review model      | Nothing reaches Garmin without an explicit confirm  | Core requirement                                                      |

**Not building:** accounts, history, multi-week programs, pace zones, editing after push, mobile app, offline mode.

---

## 1. Phase 0 — Testing before any code

The point of this phase is to fail cheaply. Every test below is manual and none of it requires a repository. Budget one evening.

### Test 0.1 — Confirm the watch model

**Owner:** you · **Time:** 2 min

Check the exact Forerunner model in Garmin Connect → Devices. Structured workouts need a 255/265/955/965-class device or newer. A Forerunner 235 or Vivoactive 3 will not accept them.

**Gate:** if the watch doesn't support structured workouts, stop. There is no software fix.

### Test 0.2 — Manual end-to-end dry run

**Owner:** you and Zoe · **Time:** 20 min setup, then one run

1. Create an Intervals.icu account for Zoe (free)
2. Settings → Connections → Garmin Connect → authorise → tick **Upload planned workouts**
3. Hand-build one representative session on tomorrow's calendar. Use the shape you actually expect:
   - Warm-up, press lap
   - 6 × 800m, 90s recovery
   - Cool-down, press lap
4. Open Garmin Connect on the Pixel, let it sync
5. Confirm the workout appears on the watch under Training → Workouts
6. Have Zoe run it

**Gate — all four must pass:**

- Workout reaches the watch
- Press-lap steps show as "until lap press", not a fixed duration
- Distance steps are correct (800m, not 800 minutes or 0.8 minutes)
- Zoe finds the on-watch experience usable

If this fails, the app cannot fix it — the app only automates this exact path.

### Test 0.3 — Lap button behaviour check

**Owner:** Zoe, during the 0.2 run · **Time:** free

Confirm she understands that pressing lap **always advances to the next step**. If she presses it out of habit mid-interval, she skips that interval. Note whether this is a problem in practice or a non-issue.

**Outcome:** either "fine" or "we need fewer lap-press steps". Feeds directly into the schema defaults.

### Test 0.4 — API spike with curl

**Owner:** you · **Time:** 15 min

Before writing an app, prove the API call works from your terminal.

1. Get Zoe's athlete ID and API key from her Intervals.icu settings page
2. POST a workout event to her calendar for tomorrow
3. Confirm it appears in Intervals.icu, then syncs to Garmin

```bash
curl -X POST \
  -u API_KEY:$ICU_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "category": "WORKOUT",
    "type": "Run",
    "name": "API test session",
    "start_date_local": "2026-07-27T06:00:00",
    "description": "Warmup\n- 10m\n\nMain 6x\n- 0.8km\n- 90s\n\nCooldown\n- 10m"
  }' \
  "https://intervals.icu/api/v1/athlete/$ICU_ATHLETE_ID/events"
```

**Gate:** the event appears on the calendar and reaches the watch. Also note exactly how the press-lap flag is represented in the payload — capture that in `docs/intervals-syntax.md`, because it is the one thing you cannot guess.

### Test 0.5 — LLM parse dry run

**Owner:** you · **Time:** 20 min

Collect 5–8 **real** sessions from Zoe's actual program, verbatim, in whatever messy form they arrive. Paste each into a chat with your intended prompt and check the JSON output by hand.

You are looking for:

- Distance vs duration confusion ("6 x 400m" → 400 minutes)
- Recovery expressed as "jog back" or "same as effort" with no number
- Sessions where warm-up and cool-down are implied but not written
- Anything the model silently invents

**Gate:** 80% correct on first pass is good enough — the review screen catches the rest. Below 50%, the prompt needs work before any UI exists.

**These 5–8 sessions become your test fixtures.** Save them.

---

## 2. Phase 1–5 — Build script

Steps are tagged **[YOU]** for human work and **[CC]** for Claude Code. The [CC] prompts are written to be pasted more or less as-is.

### Phase 1 — Scaffold and gate the front door

| #   | Who   | Step                                                                                                                                                                                                                                                                     |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | [YOU] | Create empty GitHub repo `garmin-workout-builder`, private                                                                                                                                                                                                               |
| 1.2 | [YOU] | Create Cloudflare Pages project, connect the repo                                                                                                                                                                                                                        |
| 1.3 | [YOU] | Cloudflare Zero Trust → Access → add application → email OTP policy → allowlist your address and Zoe's                                                                                                                                                                   |
| 1.4 | [YOU] | Add secrets to the Pages project: `ANTHROPIC_API_KEY`, `ICU_ATHLETE_ID`, `ICU_API_KEY`                                                                                                                                                                                   |
| 1.5 | [CC]  | _"Scaffold a minimal Astro site deployed to Cloudflare Pages with a single route `/`. Add a `/api/health` Worker endpoint returning `{ok:true}`. No styling yet. Include a `.env.example` listing ANTHROPIC_API_KEY, ICU_ATHLETE_ID and ICU_API_KEY with dummy values."_ |
| 1.6 | [YOU] | Deploy. Confirm Access challenges you for email OTP before the page loads. **Gate: an incognito window must not reach `/api/health`.**                                                                                                                                   |

Do not proceed until 1.6 passes. This is the only thing standing between the open internet and your API credits.

### Phase 2 — Schema and validation first

Build the rules before the intelligence. It's much easier to trust a parser you can already test.

| #   | Who   | Step                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | [CC]  | _"Create `src/lib/schema.ts` defining a Zod schema for a running workout: a name, and an ordered list of steps. Each step has: type (warmup, run, recover, rest, cooldown), duration (one of: time in seconds, distance in metres, or lap-press), an optional note, and a `source` field of either 'parsed' or 'inferred'. Support a repeat block containing child steps and a repeat count. No pace or HR targets."_ |
| 2.2 | [CC]  | _"Create `src/lib/validate.ts` with hard validation rules that run after parsing and before display. Reject or flag: any time step over 90 minutes; any distance step over 42km or under 50m; any repeat count over 30; a workout with zero steps; a workout whose total duration exceeds 3 hours. Return structured errors, not exceptions. Write vitest tests covering each rule."_                                 |
| 2.3 | [CC]  | _"Create `src/lib/to-intervals.ts` converting a validated workout into Intervals.icu event payload format. Distance in metres must be emitted as kilometres (400m → 0.4km) because `m` means minutes in their syntax. Include unit tests asserting exactly this conversion."_                                                                                                                                         |
| 2.4 | [YOU] | Review the conversion output against what you captured in Test 0.4. This is where silent unit bugs hide.                                                                                                                                                                                                                                                                                                              |

### Phase 3 — Parsing

| #   | Who   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | [YOU] | Drop your Test 0.5 sessions into `tests/fixtures/` as individual `.txt` files, plus a hand-written expected JSON for each                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3.2 | [CC]  | _"Create `src/lib/parse.ts` with a Worker-side function that sends pasted text to the Anthropic API and returns JSON matching the schema in schema.ts. The system prompt must: require JSON only with no prose or markdown fences; forbid inventing paces or HR targets; mark any value not explicitly stated in the source text as `source: 'inferred'`; default warm-up and cool-down to lap-press when they are mentioned without a duration. Parse the response defensively and validate against the Zod schema before returning."_ |
| 3.3 | [CC]  | _"Write a golden test suite running every fixture in tests/fixtures through parse.ts and diffing against the expected JSON. Report a pass rate rather than failing the build on any single mismatch."_                                                                                                                                                                                                                                                                                                                                  |
| 3.4 | [YOU] | Run it. Iterate on the prompt until the pass rate is acceptable. **Gate: no fixture may produce a validation error that isn't caught.**                                                                                                                                                                                                                                                                                                                                                                                                 |

### Phase 4 — Review screen

This is the heart of the product. Build it last so the data is already trustworthy, and give it the most attention.

| #   | Who   | Step                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | [CC]  | _"Build the single-page flow in Astro: a paste textarea, a Convert button, then a review view. Follow `docs/style-guide.md` exactly for all colour, type and spacing decisions. The review view shows the parsed workout as a vertical stack of step cards mirroring how the workout appears on a Garmin watch, with the original pasted text visible alongside on desktop and behind a toggle on mobile."_ |
| 4.2 | [CC]  | _"Add editing to the review view. Every field is a constrained control — step type is a select, duration is a number input with a unit toggle, repeat count is a stepper. No free text except the workout name and step notes. Any step with `source: 'inferred'` is visually flagged and must be individually acknowledged before the send button enables."_                                               |
| 4.3 | [CC]  | _"Add a plain-English restatement above the step stack, generated client-side from the structured data, e.g. 'Warm up until you press lap, then 6 × 800m with 90s recovery, then cool down until you press lap.' This is what Zoe reads to check meaning."_                                                                                                                                                 |
| 4.4 | [CC]  | _"Add the send flow: a date picker defaulting to tomorrow, a Send to Garmin button, and a success state that tells the user to open Garmin Connect on their phone to sync. Handle API failure with a specific message and a retry, never a generic error."_                                                                                                                                                 |
| 4.5 | [YOU] | Test with Zoe on her actual Pixel, on mobile data, standing in the kitchen. Not on your laptop.                                                                                                                                                                                                                                                                                                             |

### Phase 5 — Hardening and handover

| #   | Who   | Step                                                                                                                                                                                  |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | [CC]  | _"Add rate limiting to the parse endpoint: max 10 requests per hour per authenticated user, using Cloudflare KV. Return a clear message when exceeded."_                              |
| 5.2 | [CC]  | _"Write README.md covering what the app does, the one-time Intervals.icu and Garmin setup, how to run locally, and how to rotate each secret."_                                       |
| 5.3 | [YOU] | Write a short note for Zoe — three sentences, in the repo as `docs/for-zoe.md` — covering: create it the night before, open Garmin Connect to sync, lap button skips to the next step |
| 5.4 | [YOU] | Live for four weeks before changing anything                                                                                                                                          |

---

## 3. Repository structure

```
garmin-workout-builder/
├── README.md                    # What it is, setup, secret rotation
├── CLAUDE.md                    # Standing instructions for Claude Code
├── DECISIONS.md                 # Running log of choices and their reasons
├── .env.example
├── astro.config.mjs
├── package.json
├── docs/
│   ├── style-guide.md           # Design tokens — the single source of truth
│   ├── intervals-syntax.md      # API payload reference incl. the unit trap
│   ├── workout-schema.md        # Human-readable schema explanation
│   └── for-zoe.md               # Three-sentence user guide
├── src/
│   ├── pages/
│   │   ├── index.astro
│   │   └── api/
│   │       ├── parse.ts         # Anthropic call, server-side only
│   │       ├── send.ts          # Intervals.icu call, server-side only
│   │       └── health.ts
│   ├── components/
│   │   ├── PasteInput.astro
│   │   ├── StepStack.astro      # The signature component
│   │   ├── StepCard.astro
│   │   ├── PlainEnglish.astro
│   │   └── SendPanel.astro
│   ├── lib/
│   │   ├── schema.ts
│   │   ├── validate.ts
│   │   ├── parse.ts
│   │   ├── to-intervals.ts
│   │   └── to-plain-english.ts
│   └── styles/
│       └── tokens.css           # Generated from style-guide.md, never edited ad hoc
└── tests/
    ├── fixtures/                # Real sessions from Zoe's program
    │   ├── 01-intervals.txt
    │   ├── 01-intervals.expected.json
    │   └── ...
    ├── validate.test.ts
    ├── to-intervals.test.ts
    └── parse.golden.test.ts
```

### The three files that matter most

**`CLAUDE.md`** — keeps Claude Code from drifting across sessions. Should state: no pace or HR targets ever; distances convert to km before hitting the API; nothing reaches Garmin without passing through the confirmed state; all colour and type decisions come from `docs/style-guide.md`; keep it to one page and no database.

**`docs/intervals-syntax.md`** — the payload format captured from your Test 0.4 spike, especially the press-lap representation. This is knowledge you can't derive from first principles and will forget in three months.

**`DECISIONS.md`** — one line per decision with the reason. Six months from now the question "why not just use the Garmin API directly?" will come back, and you'll want the answer written down rather than re-researched.

---

## 4. Style guide

_This section is the content of `docs/style-guide.md`._

### Direction

The tool is used once a week, on a phone, in the ninety seconds before someone gets changed for a run. It is not a dashboard and should not look like one. The design borrows the vernacular of the watch itself — a stack of steps, condensed data type, high contrast for a bright morning outside — so that what Zoe sees on the phone reads as a preview of what she'll see on her wrist.

**Signature element: the step stack.** The review screen renders the workout as a vertical column of step cards laid out like a Garmin workout step list, with a left rail whose height is proportional to each step's duration. Open-ended lap-press steps break the rail into a dashed segment with no fixed height, making "this runs until you decide" visible rather than merely stated. This is the one place to spend design effort.

### Colour

Dark ground, because that's the ecosystem's register and because it is legible on a phone screen in low morning light. The palette does one unusual thing: **colour encodes trust, not hierarchy.**

| Token       | Hex       | Use                                                                   |
| ----------- | --------- | --------------------------------------------------------------------- |
| `--ink`     | `#0B0F14` | Page background                                                       |
| `--surface` | `#161D25` | Step cards, panels                                                    |
| `--line`    | `#26313D` | Dividers, card borders, the step rail                                 |
| `--text`    | `#E8EEF4` | Primary text                                                          |
| `--muted`   | `#8895A3` | Labels, units, secondary text                                         |
| `--signal`  | `#00B2E3` | Confirmed structure, primary action, the step rail when confirmed     |
| `--infer`   | `#FFB020` | **Reserved exclusively for AI-inferred values awaiting confirmation** |
| `--danger`  | `#E5484D` | Validation failures only                                              |

`--infer` appears nowhere else. Not on hover, not on focus, not as an accent. Its only job is to mean "the AI made this up and you haven't agreed to it yet." When every inferred value is acknowledged, the amber disappears from the screen entirely and the stack turns fully cyan — which becomes the visual signal that the workout is ready to send. That state change is the interaction the whole design is built around.

### Type

| Role      | Face                                            | Notes                                                                               |
| --------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Data      | Barlow Condensed, 600                           | Durations, distances, repeat counts. Condensed, tabular, evokes a watch data screen |
| Body / UI | Inter, 400/500                                  | Labels, buttons, the plain-English restatement                                      |
| Numerals  | `font-variant-numeric: tabular-nums` everywhere | Step durations must align vertically down the stack                                 |

Scale (mobile-first, rem):

```
--text-xs:   0.75    labels, units
--text-sm:   0.875   body, buttons
--text-base: 1.0     plain-English restatement
--text-lg:   1.375   step duration in a card
--text-xl:   2.0     workout name
```

Set the data face with `letter-spacing: 0.01em` and the body face at `line-height: 1.5`. Uppercase is used for one thing only — the step type label on each card (WARM UP, RUN, RECOVER) — because that mirrors the watch.

### Layout and spacing

8px base unit. Cards at `border-radius: 6px` — enough to feel like software, not so much that it reads as a consumer app. Single column throughout, max-width 34rem, centred. On screens above 900px the original pasted text sits in a second column at 40% width; below that it collapses behind a "Show original" toggle.

```
┌──────────────────────────────┐
│  Tuesday intervals      ✎    │  ← workout name, editable
├──────────────────────────────┤
│  Warm up until you press     │  ← plain English restatement
│  lap, then 6 × 800m with     │
│  90s recovery, then cool     │
│  down until you press lap.   │
├──────────────────────────────┤
│ ┆ WARM UP                    │  ← dashed rail = open ended
│ ┆ until lap press            │
│ │ ─────────────────────────  │
│ │ 6 ×                        │  ← repeat block, rail continues
│ │   RUN        800 m         │
│ │   RECOVER     90 s   ⚠     │  ← amber: inferred, tap to confirm
│ │ ─────────────────────────  │
│ ┆ COOL DOWN                  │
│ ┆ until lap press            │
├──────────────────────────────┤
│  Send to Garmin  ▸           │  ← disabled while any ⚠ remains
└──────────────────────────────┘
```

### Motion

One animated moment only: when the last inferred value is confirmed, the step rail transitions from amber to `--signal` over 400ms, top to bottom. Nothing else animates. Respect `prefers-reduced-motion` by swapping the colour instantly.

### Voice

Sentence case everywhere. Buttons name the outcome: "Send to Garmin", not "Submit". The success state says what happens next, not that something succeeded: _"On the calendar for Tuesday. Open Garmin Connect on your phone to sync it to your watch."_ Errors say what broke and what to do: _"Intervals.icu didn't accept this. The 800m step came through as 800 minutes — check the unit and try again."_

### Quality floor

Works down to 360px wide. Visible keyboard focus rings in `--signal`. Every interactive target at least 44px. Contrast ratio 4.5:1 minimum for body text against `--surface` — check `--muted` specifically, it's the one at risk.

---

## 5. Risk register

| Risk                                | Likelihood | Impact                 | Mitigation                                                                       |
| ----------------------------------- | ---------- | ---------------------- | -------------------------------------------------------------------------------- |
| Distance parsed as duration         | High       | Bad run                | Hard validation rule + explicit unit test + review screen                        |
| Workout doesn't sync before the run | Medium     | Frustrating            | Default the date to tomorrow; success message tells her to sync                  |
| Intervals.icu changes or disappears | Low        | Rebuild delivery layer | Keep `to-intervals.ts` isolated behind the schema                                |
| Zoe presses lap mid-interval        | Medium     | Skipped step           | Covered in `for-zoe.md`; reduce lap-press steps if Test 0.3 shows it's a problem |
| API key leaked                      | Low        | Cost                   | Cloudflare Access + rate limiting + rotation documented in README                |
| Review becomes rubber-stamping      | Medium     | Defeats the purpose    | Inferred values require individual acknowledgement, not a single confirm-all     |

---

## 6. What I'd cut if this takes longer than a weekend

In order: the plain-English restatement (nice, not essential), the desktop two-column layout, the rail-height proportionality, editing anything other than duration values. The parse, the validation rules, the review gate, and Cloudflare Access are the irreducible core.
