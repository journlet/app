> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Code Quality Assessment — Journlet app

## Tests

- **Layout**: `tests/` (store and lib, Node environment), `tests/ui/` (components, jsdom via per-file docblock); `tests/setup.ts` installs fake-indexeddb.
- **Volume**: 96 test files, 1,295 tests.
- **Coverage**: no coverage provider or threshold configured in `vitest.config.ts`.
- **Intent-relevant tests**: `tests/reminders.test.ts` (6: per-occurrence fired keys, stale recurring suppression, one-off late firing, permission gate); `tests/recurrence.test.ts` (14); `tests/recurrenceEnd.test.ts` (38); `tests/ui/EntryActionsSheet.test.tsx` (67, including "reminder mode writes the time the field was left on", "repeat mode starts the rule and tags the entry with it", "an occurrence of a repeat says only this one changes"); `tests/ui/RuleActionsSheet.test.tsx` (12).
- **Gaps**: no test changes a rule's reminder time (no such mutator exists), and none asserts that `remindTime` rides onto a materialised occurrence's `remindAt`.

### Local Test Baseline (must be resolved before Construction)

Running the suite on Node v26.11.1 (the scanning machine's default) gave **297 failures of 1,295**, including all 6 in `tests/reminders.test.ts` (`localStorage.clear` on an undefined global). The repository pins Node `~22` (`.nvmrc`, `engines`, CI), so this is most likely environmental, but it is unconfirmed. Take the baseline with `nvm use` (Node 22) then `npm test` before any code change; treat a Node 22 failure as a genuine regression baseline.

## Linting, Types and CI

- **Lint**: oxlint with `.oxlintrc.json` (restricted-globals rules, otherwise defaults); `npm run lint`.
- **Types**: `npm run typecheck` checks `src` and `tests`.
- **CI** (`.github/workflows/deploy.yaml`): on PR and push to `main` runs `npm ci --ignore-scripts`, lint, typecheck, test, build; deploys to GitHub Pages from `main` only. Actions pinned by SHA, least-privilege job permissions, Dependabot enabled.

## Documentation

`README.md` is current. Source is heavily commented with dated rationale and spec references. One TODO/FIXME/HACK marker in `src/`.

## Technical Debt and Intent-Relevant Findings

| ID | Finding | Location | Impact on active intent |
|---|---|---|---|
| TD-1 | Large multi-responsibility files | `store/sync.ts` 1,882; `App.tsx` 1,855; `ui/EntryActionsSheet.tsx` 1,442; `SyncView.tsx` 1,224 lines | Changes to the entry sheet land in a large file; keep edits contained |
| TD-2 | Rule `remindTime` is write-once: set only by `addRecurrence` at creation; no `setRecurrenceRemindTime` | `store/journal.ts` ~768 | A series reminder cannot be added, changed or removed after creation without a new mutator |
| TD-3 | Rule reminder applied only at materialisation | `store/recurrence.ts` `materialiseRecurrences`, `remindAtFor` | Existing occurrences never pick up a rule change; a series edit needs an explicit pass over existing occurrences from the chosen page onward |
| TD-4 | No way to tell an occurrence's own reminder from a rule-derived one | `Entry` has no provenance field | "Keeps its own reminder" can only be inferred by comparing with the rule-derived time; a hand-set reminder equal to the old series time is indistinguishable |
| TD-5 | Reminders on repeats only for day-page rules | `EntryActionsSheet.tsx` `saveRepeat`; `materialiseRecurrences` (`pageScope === "day"`) | Week/month/year repeats have no reminder; the intent does not say whether the series choice should extend to them (open question for requirements) |
| TD-6 | Duplicate `remindAt` arithmetic | `saveRepeat` inlines what private `remindAtFor` does | Risk of the two drifting; share one helper |
| TD-7 | Dedupe keeps both twins when `remindAt` differs | `store/recurrence.ts` `carriesItsOwn` | A bulk series update on one device racing materialisation on another can leave a visible duplicate occurrence |
| TD-8 | Sync is per-key last-writer-wins and older clients ignore unknown keys | Yjs `Y.Map`; `toRecurrence` | Concurrent series edits converge on one value per key; a new rule key (for example an effective-from boundary) is invisible to older clients, which keep materialising from `remindTime` alone |
| TD-9 | Fired tracking per device in `localStorage`, keyed by rule and page with the fired time | `store/reminders.ts` | A changed series time re-fires once per occurrence — intended behaviour, keep it |
| TD-10 | Node 22 pin vs Node 26 local failures | `.nvmrc`, `engines`, CI | See Local Test Baseline above |

## Security

No auth bypass found in the scanned areas. No hard-coded secrets: the committed Supabase anon key is public by design (see `dependencies.md`).

## Overall

Healthy, well-tested, well-commented codebase with disciplined CI. The active intent touches at-risk areas (TD-2 to TD-8) whose behaviour is subtle across devices; the design stages should decide how "this occurrence onward" is represented (rule split versus an effective-from boundary) and how reminder provenance is recorded.
