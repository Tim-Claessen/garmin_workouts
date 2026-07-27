# Test fixtures

**These are synthetic.** They were written to cover the failure modes the plan
identifies, not taken from a real training program — Test 0.5 (collecting 5–8 real
sessions from Zoe's program) was skipped.

That matters for how much the pass rate is worth. These fixtures test whether the
parser handles the *categories* of mess we predicted. They cannot tell us whether
those are the categories that actually turn up, or how often. Replace them with
real sessions as they arrive; the golden suite picks up any `.txt` with a matching
`.expected.json` automatically, so adding one is a two-file change.

Each expected file carries a `_why` field explaining what that fixture is for.
The golden suite ignores it.

| Fixture | Covers |
| --- | --- |
| `01-classic-intervals` | Baseline shape; a pace target that must be discarded |
| `02-jog-back-recovery` | Bare WU/CD → lap-press; a recovery with no number |
| `03-tempo-only` | Restraint — no warm-up should be invented |
| `04-time-intervals` | Everything is time; nothing should become a distance |
| `05-messy-prose` | Conversational input; genuinely ambiguous cool-down |
| `06-long-run` | HR target discarded; 90min exactly on the validation boundary |
