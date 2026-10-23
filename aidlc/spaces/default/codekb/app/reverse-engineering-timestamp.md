> **Confidentiality:** Internal | **Status:** DRAFT - UNREVIEWED

# Reverse Engineering Timestamp — Journlet app

- **Performed**: 2026-10-23T09:23Z
- **Commit**: `8bca07f7ad4e642b0e40416f05a83bdac967c9d0` (`main`, "Added Node version lock (#123)")
- **Intent**: `261023-series-reminders`
- **Store decision**: NO_STORE (first scan); breadth requested: full; depth: Minimal
- **Pipeline**: developer scan (link 1) → architect synthesis (link 2)

## Coverage Note

The scan surveyed the whole repository, but deep reading covered only the reminder, recurrence and entry/rule action-sheet area that the active intent touches, plus the build, test and CI configuration. Everything else was skimmed at API, header or file-name level. The block below therefore records `kind: partial` with the developer's deep list, not `kind: full`.

## Scope of Analysis

```yaml
scope_version: 1
kind: partial
intent: 261023-series-reminders
fingerprint: a71762e81a545fe0758a8bab5d840feb02a819bb
analyzed:
  paths:
    - src/lib/types.ts
    - src/store/reminders.ts
    - src/store/recurrence.ts
    - src/store/journal.ts
    - src/ui/EntryActionsSheet.tsx
    - src/ui/RuleActionsSheet.tsx
    - src/App.tsx
    - src/ui/spreadData.ts
    - src/main.tsx
    - tests/reminders.test.ts
    - tests/ui/EntryActionsSheet.test.tsx
    - tests/ui/RuleActionsSheet.test.tsx
    - package.json
    - vitest.config.ts
    - .github/workflows/deploy.yaml
  components:
    - Domain Model
    - Journal Store
    - Recurrence Engine
    - Reminder Loop
    - Entry Actions Sheet
    - Rule Actions Sheet
    - App Shell
    - Spread Data
    - App Bootstrap
shallow:
  paths:
    - src/store/sync.ts
    - src/store/
    - src/lib/
    - src/ui/
    - src/CollectionView.tsx
    - src/IndexView.tsx
    - src/MenuView.tsx
    - src/SyncView.tsx
    - src/sw.ts
    - supabase/
    - tests/
    - build/
    - scripts/
    - public/
    - Dockerfile
    - docker-compose.yml
    - nginx.conf
    - Makefile
    - tsconfig.json
    - tsconfig.app.json
    - tsconfig.node.json
    - tsconfig.test.json
    - vite.config.ts
    - .oxlintrc.json
    - README.md
```
