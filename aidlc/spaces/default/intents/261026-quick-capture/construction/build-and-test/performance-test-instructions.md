# Performance Test Instructions: Quick Task Entry

## Targets

| Target | Source | Check |
|---|---|---|
| NFR1 (in-app): tap to text box focused within 0.5 s | `requirements.md` NFR1 | Timing test in `tests/ui/AppQuickLine.test.tsx` |
| NFR1 (on device): keyboard up within 0.5 s of the tap | `requirements.md` NFR1 | Real-phone check, below |
| NFR2: Log to the task showing on the page within 0.5 s | `requirements.md` NFR2 | Timing test in `tests/ui/AppQuickLine.test.tsx` |

No load or throughput testing applies: the change is local to the browser and adds no server work.

## How to Run the Automated Timing Tests

```bash
docker compose run --rm dev npx vitest run tests/ui/AppQuickLine.test.tsx
```

## Real-Phone Check (manual)

This needs the deployed HTTPS site, or a local-only dev build. It has not been run yet: code-generation Step 5 was skipped because the dev build needs sign-in.

1. Open Journlet on a phone (installed home-screen app and browser tab) and go to today.
2. Tap once in the empty space under the day's last entry. **Pass:** the text box is focused and the keyboard is up, with no second tap, within about half a second.
3. With the keyboard up, check that the line and its Cancel, more and Log row are visible above it. Repeat on the month and year sections and on a long list collection (NFR4).
4. Close the line, then start a scroll with your finger on the empty space. **Pass:** the page scrolls and no line opens.
