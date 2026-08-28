// Two lists that look like duplicates and are not.
//
// A `Scope` (lib/dates.ts) is a kind of page the journal has. A `RecurrenceUnit`
// (lib/types.ts) is what a repeat counts in. They have the same four members
// today, and a note in types.ts used to say they should therefore be unified.
// They should not: the relationship is a subset rather than an equality, and it
// runs one way. Every scope must be a usable cadence, because on a week, month or
// year page the cadence is locked to that page's scope and the value is assigned
// straight across (saveRepeat in ui/EntryActionsSheet.tsx). The reverse is not
// required, and the obvious counter-example is already imaginable: "every
// fortnight" is an ordinary thing to want from a repeat and there is no fortnight
// page.
//
// Written 28 August 2026, when `pageScope` was retyped from RecurrenceUnit to
// Scope. It had been the wrong one of the two since the field existed, and it
// compiled only because the members happened to line up.

import { describe, expect, test } from "vitest";
import { SCOPES } from "../src/lib/dates";
import { RECURRENCE_UNITS } from "../src/lib/types";

describe("the page scopes and the repeat cadences", () => {
  // Two lists that look like duplicates and are not (see lib/types.ts). A `Scope`
  // is a kind of page the journal has; a `RecurrenceUnit` is what a repeat counts
  // in. Every scope has to be a usable cadence, because on a week, month or year
  // page the cadence is locked to that page's scope and the value is assigned
  // straight across. The reverse is not required: "every fortnight" is an ordinary
  // thing to want and there is no fortnight page.

  test("every page scope is a cadence a repeat can use", () => {
    for (const scope of SCOPES)
      expect(RECURRENCE_UNITS as readonly string[]).toContain(scope);
  });

  test("the lists are checked in one direction only, deliberately", () => {
    // Stated as a test rather than a comment so that adding a cadence which is not
    // a page does not read as a failure. Today they match; tomorrow they need not.
    expect(RECURRENCE_UNITS.length).toBeGreaterThanOrEqual(SCOPES.length);
  });
});
