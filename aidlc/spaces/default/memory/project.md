# Project-Level Rules

> Project-specific specialisation and corrections. Loaded after `org.md` and
> `team.md` as strict-additive guidance; contradictions with broader policy
> are rejected. Populated by practices-discovery and the self-learning loop.
>
> Use sparingly: most teams don't need a project layer. Reach for it
> only when this specific project needs stable, durable guidance beyond the
> team practice (for example, package-specific release checks or an additional
> regression suite for a legacy component).

## Way of Working

<!-- Project-specific specialisation. Example: -->
<!-- This monorepo requires package-scoped branch names and a package owner -->
<!-- review in addition to the team's normal merge policy. -->

## Walking Skeleton

<!-- Project-specific specialisation. Example: -->
<!-- The walking skeleton must exercise the legacy service adapter as well -->
<!-- as the new service boundary. -->

## Testing Posture

<!-- Project-specific specialisation. -->

## Guard Policy

<!-- Project-specific. Mode: strict, relaxed, or off. Strict here holds for every intent and cannot be changed from chat. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment

<!-- Project-specific specialisation. -->

## Code Style

<!-- Project-specific specialisation. -->

## Tech Stack

<!-- Technology choices locked for this project. -->

## Decided

<!-- Decisions made in earlier stages that should not be re-asked. -->
<!-- Format: DECIDED: [decision] (Stage [slug], [date]) -->

## Scope Overrides

<!-- Custom scope rules for this project. -->

## Forbidden

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: NEVER [behavior] (affirmed [date]) -->
<!-- Example: NEVER throw exceptions across service layer boundaries (affirmed 2026-05-17) -->

## Mandated

<!-- Populated by practices-discovery affirmation gate. -->
<!-- Format: ALWAYS [behavior] (affirmed [date]) -->
<!-- Example: ALWAYS use Result<T,E> for fallible operations in service layer (affirmed 2026-05-17) -->

## Corrections

<!-- Project-specific corrections from human feedback. -->
<!-- Format: NEVER/ALWAYS [behavior] (learned [date]) -->
- read "ask each time" (Q1, Q3) together with "this and future" (Q7) as a two-way choice: this entry only, or this occurrence onward (learned 2026-10-23) <!-- cid:261023-series-reminders:intent-capture:9db88ebb7631bad5f1370f3188456580b8ddbd96b0b2db7128e7321c810b32ff -->
- first scan with no existing code map, so ran a full scan rather than a focused one (learned 2026-10-23) <!-- cid:261023-series-reminders:reverse-engineering:462e2e62d58ef16d63b38c384c3dbee03c28d802110527590e8de0e7deae5306 -->
- an entry reminder set for a different day (e.g. the evening before) becomes a series reminder at that time of day on each occurrence's own day (learned 2026-10-23) <!-- cid:261023-series-reminders:requirements-analysis:5791229f92c43306dd211d20dd15828a3697fae2c422bee13bacd23354a61dd9 -->
- own-reminder detection by comparison (no new data) chosen over an explicit marker (learned 2026-10-23) <!-- cid:261023-series-reminders:requirements-analysis:12b774d54ec9b6687886d136d0ac2f7a1eef2f516765e0e088ebc5c5a8e5b50a -->
- reused the rule's existing remindTime key with a pass over existing occurrences, over splitting the rule or adding an effective-from key (learned 2026-10-23) <!-- cid:261023-series-reminders:code-generation:d0211614b52cb77b5fdfd71b2da2016a511e7668b3d80717970b72c07f91f838 -->
- ran every build and test command in the Docker dev service (node:22-alpine, separate node_modules volume) instead of host Node, because the person said to use Docker and never run anything locally (learned 2026-10-23) <!-- cid:261023-series-reminders:build-and-test:fd08fea48f5b9917c7a39e0cd55ab8ad8197ab8b3d1231f30c17cf25ec0d3e85 -->
- FR IDs have no direct rows in traceability.json, so the strict cross-unit check reports them uncovered even though each is tested through its ACs (learned 2026-10-23) <!-- cid:261023-series-reminders:build-and-test:e8f9b376af9438a146e524f35ff54d0252fd66e1d1571a168e166120c7a1b6e7 -->
