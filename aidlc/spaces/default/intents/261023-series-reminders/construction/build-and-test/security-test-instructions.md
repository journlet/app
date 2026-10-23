> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Security Test Instructions: Reminders on Repeating Items

## Applicability

Security test instructions are generated only under the Comprehensive strategy, when NFR security requirements exist. This run is **Minimal**, so no SAST, DAST or dependency-scan suite is generated or run here.

From the security engineer's side, the change opens no new attack surface:

| Concern | Finding |
|---|---|
| New data leaving the device (NFR7) | None. D1 in `code-generation-plan.md` reuses the rule's existing `remindTime` key, and occurrence `remindAt` values already sync. Both travel inside the existing end-to-end-encrypted Yjs updates (`src/store/sync.ts`), and Supabase only ever receives ciphertext. |
| Input validation | `setRecurrenceRemindTime` accepts only `HH:MM` from 00:00 to 23:59 and throws `RangeError` otherwise. `tests/seriesReminders.test.ts` covers this. |
| Synced input from another device | Review finding R-01 (accepted at the Code Generation gate): the read side checks `remindTime` with a looser pattern than the write side. A malformed synced value such as `99:99` gives a wrong reminder time, not a crash or a data leak. |
| Notifications | The notification-permission prompt is unchanged. Tests stub `notificationPermission` and never call the real Notification API. |
| Dependencies | Neither `package.json` nor `package-lock.json` is touched by this change. |

## How to Check Locally

The existing CI-equivalent checks act as the security floor for this strategy. Run them in the `dev` container:

```bash
docker compose run --rm --no-deps -T dev sh -c "npm ci --no-audit --no-fund && npm run lint && npm run typecheck"
```

## Sources

`code-generation-plan.md` (D1), `code-summary.md` (Decisions as Implemented) and `unit-test-instructions.md` (Mocking and Stubbing), all under `construction/code-generation/`.
