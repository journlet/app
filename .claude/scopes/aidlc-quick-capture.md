---
name: quick-capture
depth: Standard
keywords: []
description: Investigate and build the fastest way to enter a new task in the Journlet PWA
guard_policy: relaxed
---

# quick-capture scope

Composed for one intent: investigate how quickly someone can enter a new task
once the PWA is open, explore a few fast-entry options (for example inline add
on a day, week, month or year section that opens the keyboard in place), pick
one at the hand-off gate, then pin its behaviour and speed target and build it.

Guard Policy is relaxed: a changed input after approval is recorded once and
announced in one line, work continues, and the plan-approval and review-freeze
checks stand aside for undirected work. Every approval gate still asks the human.

## Why these stages, why skip those

Executes: intent-capture, scope-definition, rough-mockups, approval-handoff,
requirements-analysis, code-generation, build-and-test (plus initialization).
The capture flow already lives in a few existing components and CI already
gates lint, typecheck and tests, so code mapping, design, NFR, CI and
operation stages are skipped. Feasibility and refined-mockups are folded and
can be un-skipped if on-device keyboard behaviour or a high-fidelity design
needs proving first.

## Membership

No keyword triggers; resolves only by `--scope quick-capture`.
