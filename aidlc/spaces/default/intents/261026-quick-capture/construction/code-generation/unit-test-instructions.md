# Unit Test Instructions: Quick Task Entry

## Framework and Setup

- **Runner:** vitest, configured in `vitest.config.ts`. Tests in `tests/` run in Node. UI tests in `tests/ui/` opt into jsdom through their per-file docblock. `tests/setup.ts` installs `fake-indexeddb`.
- **Runtime:** always run inside the Docker `dev` service (`node:22-alpine`, with its own `node_modules` volume), never on host Node. Install dependencies in the container once before the first run:

```bash
docker compose run --rm dev npm ci
```

- **Strategy:** Standard, which means 5 to 8 tests per component. It covers unit tests for the tap check plus integration-style tests at the App boundary. About 39 new tests in all.

## How to Run This Change's Tests

Every command is scoped to this change's test files. Never use a bare `npm test` here; Build and Test runs the full suite separately.

Tap check (new):

```bash
docker compose run --rm dev npx vitest run tests/quickTap.test.ts
```

Quick line component (new):

```bash
docker compose run --rm dev npx vitest run tests/ui/QuickLine.test.tsx
```

Home sections, collections and the Undo message (existing files, extended):

```bash
docker compose run --rm dev npx vitest run tests/ui/SpreadView.test.tsx tests/ui/CollectionView.test.tsx tests/ui/UndoToast.test.tsx
```

App wiring and timing (new):

```bash
docker compose run --rm dev npx vitest run tests/ui/AppQuickLine.test.tsx
```

All of this change's tests together:

```bash
docker compose run --rm dev npx vitest run tests/quickTap.test.ts tests/ui/QuickLine.test.tsx tests/ui/SpreadView.test.tsx tests/ui/CollectionView.test.tsx tests/ui/UndoToast.test.tsx tests/ui/AppQuickLine.test.tsx
```

## Planned Tests

| File | Tests | Covers |
|---|---|---|
| `tests/quickTap.test.ts` | 6: still short press; 9 px; 10 px; 499 ms; 500 ms; diagonal distance | FR1.4, FR1.5 |
| `tests/ui/QuickLine.test.tsx` | 8: opens with focus on the input; bullet "•" and aligned input; Cancel, more and Log order; Log saves a task; Enter saves; Cancel discards; Escape discards; empty Log saves nothing | FR1.7, FR2.1–FR2.3, FR3.1–FR3.3 |
| `tests/ui/SpreadView.test.tsx` | 7: tap area under own entries and above "Later this month"; "nothing logged" is the button; filter-hidden text is the button; no tap area on a past period; previous and next disabled while open; labels "Add a task to …"; minimum 33 px | FR1.1, FR1.3, FR1.5, FR1.6, FR5.5, NFR5 |
| `tests/ui/CollectionView.test.tsx` | 5: list has a tap area; habits has none; empty list text is the button; logs into the collection; label | FR1.2, FR1.3 |
| `tests/ui/UndoToast.test.tsx` | 3: label prop shown; existing labels unchanged; Undo callback | FR4.2, FR4.6 |
| `tests/ui/AppQuickLine.test.tsx` | 10, as listed below | FR3.5, FR3.6, FR4.1–FR4.5, FR5.1–FR5.4, NFR1, NFR2 |

The `AppQuickLine.test.tsx` tests:
- one line at a time while it has text;
- an empty line moves to the new spot;
- text survives a tap elsewhere and a hide-then-show of the page;
- "more" moves the text and leaves remembered choices;
- "Logged" wording and 40-character cut;
- a newer message replaces an older one;
- Undo removes the entry after an edit;
- a filter hiding the task still shows the message;
- open under 500 ms;
- save under 500 ms.

## Coverage Expectations

No coverage provider or threshold is configured, and none is added, relaxed or disabled by this change. Coverage is measured requirement by requirement through the table above and `traceability.json`. Every test that already exists in the extended files must stay green.

## Mocking and Stubbing

- **UI component tests** mock `../../src/store/journal` with `vi.mock`, following each file's existing `setup()` helper, and assert calls to `addEntry` and `removeEntry`.
- **App-level tests** use the real journal store with `fake-indexeddb`, as `tests/ui/AppMount.test.tsx` does, so a logged entry really renders.
- **Pointer events:** fire `pointerdown` and `pointerup` with `clientX`, `clientY` and `vi.useFakeTimers()` controlling the time between them.
- **Timing tests** use `performance.now()` around the event and the awaited render, with real timers.
- **Visibility:** set `document.visibilityState` through `Object.defineProperty` and dispatch `visibilitychange`.

## Test Data

Entries, pages and collections are built inline with small factory helpers in each test file. There are no shared fixtures and no network access, and every test creates and discards its own data.
