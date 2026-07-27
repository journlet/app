// @vitest-environment jsdom
//
// Local reminder firing (src/store/reminders.ts). checkReminders reads the
// shared journal doc and calls the browser Notification API, so these tests
// reset the doc, pin the clock, and stub Notification to record what fired.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { Entry } from "../src/lib/types";
import { checkReminders } from "../src/store/reminders";
import {
  collections,
  doc,
  entries,
  habits,
  insertEntry,
  recurrences,
} from "../src/store/journal";

const NOW = new Date(2026, 6, 24, 12, 0, 0); // 24 Jul 2026, 12:00
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo, d, h, mi, 0, 0).getTime();

let fired: string[] = [];

class MockNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = async (): Promise<NotificationPermission> =>
    "granted";
  constructor(title: string) {
    fired.push(title);
  }
}

const reset = () =>
  doc.transact(() => {
    entries.delete(0, entries.length);
    collections.delete(0, collections.length);
    habits.delete(0, habits.length);
    recurrences.delete(0, recurrences.length);
  });

const entry = (over: Partial<Entry>): Entry => ({
  id: over.id ?? "e1",
  type: "task",
  text: "Standup",
  priority: false,
  state: "open",
  pageKey: "2026-07-24",
  createdAt: 0,
  ...over,
});

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal("Notification", MockNotification);
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  reset();
  fired = [];
  MockNotification.permission = "granted";
  localStorage.clear();
});
afterEach(reset);

describe("checkReminders — recurring occurrences", () => {
  test("fires a recurring occurrence due today exactly once", async () => {
    insertEntry(
      entry({
        remindAt: at(2026, 6, 24, 9, 0), // 09:00 today, already passed
        recurrenceId: "r1",
        pageKey: "2026-07-24",
      })
    );

    await checkReminders();
    await checkReminders(); // idempotent — already fired for this occurrence

    expect(fired).toEqual(["Standup"]);
  });

  test("suppresses missed earlier occurrences instead of storming on reopen", async () => {
    // Away for three days; the daily rule materialised one occurrence per day,
    // each still open with a past remindAt. Only today's should nudge.
    for (const [day, h] of [
      ["2026-07-21", 9],
      ["2026-07-22", 9],
      ["2026-07-23", 9],
      ["2026-07-24", 9],
    ] as const) {
      insertEntry(
        entry({
          id: `e-${day}`,
          remindAt: at(2026, 6, Number(day.slice(-2)), h, 0),
          recurrenceId: "r1",
          pageKey: day,
        })
      );
    }

    await checkReminders();

    expect(fired).toEqual(["Standup"]); // just today's, not four
  });

  test("does not fire a completed or struck occurrence", async () => {
    insertEntry(
      entry({
        state: "done",
        remindAt: at(2026, 6, 24, 9, 0),
        recurrenceId: "r1",
      })
    );

    await checkReminders();

    expect(fired).toEqual([]);
  });

  test("a re-materialised twin (new id, same rule+page) never re-fires", async () => {
    insertEntry(
      entry({
        id: "twin-a",
        remindAt: at(2026, 6, 24, 9, 0),
        recurrenceId: "r1",
        pageKey: "2026-07-24",
      })
    );
    await checkReminders();
    expect(fired).toEqual(["Standup"]);

    // Simulate the occurrence being recreated with a fresh entry id.
    insertEntry(
      entry({
        id: "twin-b",
        remindAt: at(2026, 6, 24, 9, 0),
        recurrenceId: "r1",
        pageKey: "2026-07-24",
      })
    );
    await checkReminders();

    expect(fired).toEqual(["Standup"]); // still just one
  });
});

describe("checkReminders — one-off reminders", () => {
  test("still fires a late one-off reminder set for an earlier day", async () => {
    insertEntry(
      entry({
        id: "oneoff",
        text: "Call dentist",
        remindAt: at(2026, 6, 23, 15, 0), // yesterday — but no recurrenceId
      })
    );

    await checkReminders();

    expect(fired).toEqual(["Call dentist"]);
  });

  test("does nothing when notification permission is not granted", async () => {
    MockNotification.permission = "denied";
    insertEntry(entry({ remindAt: at(2026, 6, 24, 9, 0) }));

    await checkReminders();

    expect(fired).toEqual([]);
  });
});
