# Style guide

The single source of truth for colour, type and spacing.
[src/styles/tokens.css](../src/styles/tokens.css) is generated from this file —
change this first, then bring the CSS into line. Never edit token values ad hoc.

## Direction

The tool is used once a week, on a phone, in the ninety seconds before someone
gets changed for a run. It is not a dashboard and should not look like one. The
design borrows the vernacular of the watch itself — a stack of steps, condensed
data type, high contrast for a bright morning outside — so that what Zoe sees on
the phone reads as a preview of what she'll see on her wrist.

**Signature element: the step stack.** The review screen renders the workout as a
vertical column of step cards with a left rail. Open-ended lap-press steps break
the rail into a dashed segment, making "this runs until you decide" visible rather
than merely stated. This is the one place to spend design effort.

## Colour

Dark ground, because that's the ecosystem's register and because it is legible on
a phone screen in low morning light. The palette does one unusual thing: **colour
encodes trust, not hierarchy.**

| Token | Hex | Use |
| --- | --- | --- |
| `--ink` | `#0B0F14` | Page background |
| `--surface` | `#161D25` | Step cards, panels |
| `--line` | `#26313D` | Dividers, card borders |
| `--text` | `#E8EEF4` | Primary text |
| `--muted` | `#8895A3` | Labels, units, secondary text |
| `--signal` | `#00B2E3` | Confirmed structure, primary action, the rail when confirmed |
| `--infer` | `#FFB020` | **Reserved exclusively for AI-inferred values awaiting confirmation** |
| `--danger` | `#E5484D` | Validation failures only |

`--infer` appears nowhere else. Not on hover, not on focus, not as an accent. Its
only job is to mean "the AI made this up and you haven't agreed to it yet." When
every inferred value is acknowledged the amber disappears and the stack turns
fully cyan, which is the signal that the workout is ready to send. That state
change is the interaction the whole design is built around.

## Type

| Role | Face | Notes |
| --- | --- | --- |
| Data | Barlow Condensed 600 | Durations, distances, repeat counts |
| Body / UI | Inter 400/500 | Labels, buttons, the restatement |
| Numerals | `tabular-nums` everywhere | Durations must align down the stack |

```
--text-xs:   0.75rem    labels, units
--text-sm:   0.875rem   body, buttons
--text-base: 1rem       plain-English restatement
--text-lg:   1.375rem   step duration in a card
--text-xl:   2rem       workout name
```

Data face at `letter-spacing: 0.01em`, body at `line-height: 1.5`. Uppercase is
used for one thing only — the step type label on each card (WARM UP, RUN,
RECOVER) — because that mirrors the watch.

## Layout

8px base unit. Cards at `border-radius: 6px`. Single column, max-width 34rem,
centred. Above 900px the original pasted text sits in a second column at 40%
width; below that it collapses behind a "Show original" toggle.

## Motion

One animated moment only: when the last inferred value is confirmed, the rail
transitions from amber to `--signal` over 400ms. Nothing else animates. Respect
`prefers-reduced-motion` by swapping the colour instantly.

## Voice

Sentence case everywhere. Buttons name the outcome: "Send to Garmin", not
"Submit". The success state says what happens next, not that something succeeded:
*"On the calendar for Tuesday. Open Garmin Connect on your phone to sync it to
your watch."* Errors say what broke and what to do.

## Quality floor

Works down to 360px wide. Visible keyboard focus rings in `--signal`. Every
interactive target at least 44px. Contrast 4.5:1 minimum for body text against
`--surface` — check `--muted` specifically, it's the one at risk.
