import type { Entry, Recurrence } from "../lib/types";

// A row in the "scheduled ahead" / Future log lists: either a real
// future-dated entry, or a display-only preview of a recurrence rule's next
// occurrence (the real entry is materialised when its day arrives).
export type ScheduledRow =
  | { kind: "entry"; sort: string; pk: string; entry: Entry }
  | { kind: "rule"; sort: string; dayKey: string; rule: Recurrence };
