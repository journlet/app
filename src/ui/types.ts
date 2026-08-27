import type { Entry, Recurrence, RecurrenceUnit } from "../lib/types";
import type { Scope } from "../lib/dates";

// A row in the "scheduled ahead" / Future log lists: either a real
// future-dated entry, or a display-only preview of a recurrence rule's next
// occurrence (the real entry is materialised when its day arrives).
export type ScheduledRow =
  | { kind: "entry"; sort: string; pk: string; entry: Entry }
  | { kind: "rule"; sort: string; dayKey: string; rule: Recurrence };

// The entry-actions sheet target: which entry, on which page/scope.
export interface SheetTarget {
  scope: Scope | null;
  pk: string;
  id: string;
}

/** Draft state for the "when it ends" control (spec §11 Q17). The two values
 *  are kept while the mode changes, so switching between the forms to see what
 *  each one means does not throw away what was typed in the other. Both are
 *  strings for the same reason EditRepeat.n is: they are what is in the field,
 *  parsed at the point of use. */
export interface EditEnds {
  mode: "never" | "date" | "count";
  /** the day picked, YYYY-MM-DD */
  date: string;
  count: string;
}

// Draft state for the "Repeat this entry" sub-form in the sheet.
export interface EditRepeat {
  n: string;
  unit: RecurrenceUnit;
  time: string;
  /** an end set at the same moment as the repeat (spec §11 Q17) */
  ends: EditEnds;
}
