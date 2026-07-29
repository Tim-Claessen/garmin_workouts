# Style guide

The single source of truth for colour, type and spacing.
[src/styles/tokens.css](../src/styles/tokens.css) is generated from this file —
change this first, then bring the CSS into line. Never edit token values ad hoc.

The stylesheet is in two files, and the split matters:

| File | Holds | Edit when |
| --- | --- | --- |
| [src/styles/tokens.css](../src/styles/tokens.css) | The design export: tokens and the named classes below | This guide changes. Replaced wholesale, so keep it identical to the export |
| [src/styles/app.css](../src/styles/app.css) | Composition above the tokens — step-row internals, the editing sheet, the spine, the stat row | The markup needs structure the export does not ship CSS for |

`app.css` never invents a colour, a size or a spacing value; it only arranges
what `tokens.css` defines.

## Name and mark

The app is **Sessionise**. One session at a time, turned into something the watch
understands.

The mark is three horizontal bars of unequal length inside a rounded square — a
session's steps, nothing more. It is three `<rect>`s, reads at 16px, and has a
mono variant on light for the Cloudflare Access login page.

| Asset | File | Use |
| --- | --- | --- |
| Icon | `public/favicon.svg` | Browser tab, PWA |
| Icon (raster) | `public/favicon-32.png`, `public/favicon-192.png` | Fallback, Android |
| Icon (iOS) | `public/apple-touch-icon.png` | Square, no rounding — iOS masks it |
| Mono | `public/icon-mono.svg` | Light backgrounds, Access login page |
| Lockup | `public/logo.svg` | Access login page header |

## Direction

The tool is used once a week, on a phone, in the ninety seconds before someone
gets changed for a run — and occasionally at a desk, where fifteen steps should
be readable without scrolling.

So it is a **calm dark app**, in the register of the phone app the workout ends
up in: an app bar, a three-step spine, cards on a cool near-black ground, one
cyan accent. Nothing decorative. Nothing animates.

**Signature element: the step table.** On desktop the workout is a table — index,
step, amount, how it ends — so the whole session is one read. Below 960px each
row becomes a card. Repeat blocks are a count pill and an indented group. Editing
happens in a sheet rather than inline, so the review page never turns into a wall
of form controls.

## Colour

Dark ground, because that is the ecosystem's register and because it is legible
on a phone in low morning light. The palette does one unusual thing: **colour
encodes trust, not hierarchy.**

| Token | Hex | Use |
| --- | --- | --- |
| `--ground` | `#0C1013` | Page background |
| `--surface` | `#14191F` | App bar, cards |
| `--raised` | `#1B222A` | Table header, chips, inputs, nested steps |
| `--line` | `#232B34` | Dividers, card borders |
| `--line-strong` | `#303A45` | Control borders, dashed name underline |
| `--text` | `#EAF0F5` | Primary text |
| `--muted` | `#93A1AE` | Labels, units, secondary text |
| `--faint` | `#5D6874` | Placeholder text and disabled button labels only |
| `--accent` | `#0BB5DD` | Confirmed structure, primary action, work steps |
| `--infer` | `#F0A83C` | **Reserved exclusively for AI-inferred values awaiting confirmation** |
| `--danger` | `#E8555C` | Validation failures, deletion, and a send that may not have carried what was asked |

`--infer` appears nowhere else. Not on hover, not on focus, not as an accent. Its
only job is to mean "the model made this up and you haven't agreed to it yet."
When the last inferred value is acknowledged the amber disappears, the ready
banner turns cyan, and Send enables. That state change is the interaction the
whole design is built around.

Confirming is a **primary-weight amber button** — the one thing the review screen
exists to make happen should look like the thing to do. It is still one value at
a time. There is no confirm-all and there never will be.

A **pace target is never amber**, and this is the rule working rather than an
exception to it. A pace can only have been typed by hand — the model has no field
for one — so amber would claim a provenance the value does not have and put a
confirmation prompt on something with nothing to confirm. It sits in `--muted`,
in the data face, like the amount beside it.

The third use of `--danger` is the caveat on an otherwise successful send: the
workout reached the calendar but its pace targets may not have reached the watch.
Amber is the instinctive colour there and is not available, and danger is the
honest reading anyway — something the athlete asked for may be missing from the
session, and only they can check.

## Type

| Role | Face | Notes |
| --- | --- | --- |
| Data | Archivo Narrow 600/700 | Durations, distances, repeat counts, headings, dates |
| Body / UI | Instrument Sans 400/500/600 | Labels, buttons, the restatement |
| Pasted text & payload | System mono | The athlete's text and the emitted syntax are shown as code |
| Numerals | `tabular-nums` everywhere | Amounts must align down the table |

```
--text-2xs: 11px    uppercase micro-labels only
--text-xs:  12px    notices, units
--text-sm:  13px    secondary body, links
--text-base:15px    body, buttons
--text-md:  17px    plain-English restatement
--text-lg:  21px    step amount on phone
--text-xl:  27px    phone page heading
--text-2xl: 32px    desktop page heading ("Session Plan")
```

Data face at `letter-spacing: 0.01em`, body at `line-height: 1.5`. Uppercase is
used for one thing only — the micro-label above a value (`WARM UP`, `SEND TO`,
`DO IT ON`) at 11px and `0.1em` — because that mirrors the watch.

## Layout

4px base with an 8px rhythm. Cards at `border-radius: 12px`, controls at 8px,
chips fully round. App bar 60px desktop, 56px mobile.

Single column, max-width 46rem, centred. Above 960px it becomes
`1fr 320px`: the pasted text and the outgoing payload sit in a sticky right-hand
column. Below that they collapse behind a "Show original" toggle.

On phones the date and Send sit in a bar at the foot of the view, so the action
is reachable with fifteen steps above it.

## Motion

None. The amber-to-cyan change on the last confirmation is a colour swap, not a
transition. `prefers-reduced-motion` disables everything anyway.

## Voice

Second person, sentence case, no exclamation. Buttons name the outcome
("Read it", "That's right", "Send to watch"), never the mechanism.

| Instead of | Say |
| --- | --- |
| Convert | Read it |
| Guessed. Confirm | That's right / Change it |
| Send to Garmin ▸ | Send to watch |
| 2 values still need confirming before this can be sent. | 2 of 15 steps were guessed. Confirm each one — there is no confirm-all on purpose. |
| You pasted | What you entered |
| Payload / output | Goes out as |
| Sent | On Zoe's calendar for Tuesday |
| Clear Intervals.icu workouts | Tidy up Zoe's calendar |

Success says what happens next, not that something succeeded: *"On Zoe's
calendar for Tuesday"*, then *"Open Garmin Connect to sync it to the watch."*
Two short lines, not a paragraph.

Errors say what broke, in the athlete's terms, and what to do. Global failures
are headed **Won't send**: *"Step 4 is 42 km. That's longer than anything this
tool will send — check the units."*

Destructive copy always names the person and states the limit: *"Delete 12
planned workouts from Zoe's calendar? This can't be undone. Recorded runs are
never touched."*

## Quality floor

Works down to 360px wide. Visible keyboard focus rings in `--accent`. Every
interactive target at least 44px. Contrast 4.5:1 minimum for body text against
`--surface` — check `--muted` specifically. `--faint` is deliberately below the
floor: it is for placeholder text and disabled button labels only, never for an
affordance and never for the only copy of an instruction. Affordances ("Edit",
"Hide", "Show original") use `--muted`.
