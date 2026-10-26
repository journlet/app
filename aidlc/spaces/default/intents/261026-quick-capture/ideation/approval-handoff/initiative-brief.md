# Initiative Brief: Quick Task Entry

## Intent and Problem

With Journlet already open, adding a task takes too long. You tap the bar, wait for a full-screen form, check the page and type, then log, and tasks slip as a result. The target is one tap, type, Log (or Enter), with the task saved within about 5 seconds, on phone and desktop alike. (Sources: `intent-statement.md`, `stakeholder-map.md`.)

## Market Validation

Not run. This is a personal journalling app with no market to size; the plan skipped market research.

## Feasibility and Risk Highlights

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| A phone does not raise the keyboard when the tap opens the line in an installed web app | Medium | High | Prove it on a real phone first, before building the rest (approval Q3) |
| The open line or its button row ends up hidden behind the keyboard for lower sections (month, year) or a long collection | Medium | Medium | Part of the same real-phone check (`wireframes.md`, assumptions) |
| The tap area under each section is invisible, so people may not discover it | Medium | Low | Today's "Log an entry…" bar stays as is (approval Q2); the tap area shades on hover and is a labelled button for keyboard and screen-reader users (`wireframes.md`) |
| A tap meant as a scroll opens the line by accident | Low | Low | Requirements to settle how a tap is told apart from a scroll (`wireframes.md`) |

## Scope Boundary

In scope (`scope-document.md`, `intent-backlog.md`):
- Quick entry on the home page's day, week, month and year sections, landing in the period each section is showing, and on collection pages (IB-2 to IB-5).
- Enter or Log saves a task and closes; Cancel discards; more opens the full form with the text kept.
- Always a task; a highlight and a "Logged" message with Undo after saving.

Out of scope: faster ways into the app (such as home-screen shortcuts); start-by-typing or shortcut keys on desktop (`rough-mockups-questions.md` Q8).

## Concept Visuals

**Chosen: option A, add in place** (approval Q1). See `wireframes.md` and the prototype `spec/journlet-prototype-v29-quick-capture.html`.

```
|  • Book dentist                |   tap the space   |  • Book dentist                |
|  ............................  |   under the last  |  • [Buy milk|               ]  |
| This week ...      <prev next> |   entry  ----->   |    Cancel          more  [Log] |
```

Today's "Log an entry…" bar stays exactly as it is, alongside (approval Q2, IB-6).

## Team Plan

Solo: you decide, and I build and test the change. No other team is involved (`stakeholder-map.md`).

## Go / No-Go Recommendation

**Go.** The option is chosen, the scope is clear, and the one real risk (the keyboard on a phone) is checked first. Requirements analysis comes next and should settle:
- the measuring points for the 5-second target and a baseline of today's speed;
- how long the "Logged" message with Undo stays;
- what happens to typed text if you leave the line without Log or Cancel;
- the tap area's minimum height, its behaviour on an empty section, and how a tap is told apart from a scroll;
- after Log or Cancel the line closes and the tap area returns, while content below the open line moves down by the height of the button row (review points on `wireframes.md`).

## Assumptions & Open Questions

- The keyboard behaviour on a real phone is unproven until the first check. [assumption]
