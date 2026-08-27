// The header's left slot (src/lib/syncSlot.ts, spec §4.5, §11 Q20). The middle
// of three tiers: nothing while sync works, a word here for what is true but
// has nothing to be done about it, a banner for what needs an action.

import { describe, expect, test } from "vitest";
import { syncSlotWord } from "../src/lib/syncSlot";
import { isNotSyncing, notSyncingReason } from "../src/ui/NotSyncingBanner";
import type { SyncStatus } from "../src/store/sync";

const ALL: SyncStatus[] = [
  "disabled",
  "starting",
  "signed-out",
  "connecting",
  "needs-key",
  "synced",
  "pending",
  "offline",
];

describe("syncSlotWord", () => {
  test("offline is the one state this tier speaks for", () => {
    expect(syncSlotWord("offline")).toBe("offline");
  });

  test("a working journal says nothing at all", () => {
    expect(syncSlotWord("synced")).toBe("");
    expect(syncSlotWord("starting")).toBe("");
  });

  // Left out by choice rather than by width, and the reasons differ: "waiting"
  // clears itself within seconds and would flicker on every capture;
  // "connecting…" has never been visible in the app at all, so showing it here
  // would be new information on every cold launch rather than information this
  // change took away.
  test("waiting and connecting are silent on purpose", () => {
    expect(syncSlotWord("pending")).toBe("");
    expect(syncSlotWord("connecting")).toBe("");
  });

  test("a build without sync does not nag about it forever", () => {
    expect(syncSlotWord("disabled")).toBe("");
  });

  // The tiers must not both speak. Anything the banner warns about is silent
  // here, or the same fact would be on the screen twice in two registers.
  test("nothing the banner warns about also takes the slot", () => {
    for (const s of ALL) {
      if (isNotSyncing(s) || notSyncingReason(s, "server said no")) {
        expect(syncSlotWord(s)).toBe("");
      }
    }
  });

  // needs-key never shares a screen with the journal — needsJournalKey() has
  // already given that device UnlockView — so a word here would be a word on a
  // page that does not exist.
  test("key needed is handled by a whole screen, not a word", () => {
    expect(syncSlotWord("needs-key")).toBe("");
  });

  test("every status has an answer, and only one has a word", () => {
    const spoken = ALL.filter((s) => syncSlotWord(s) !== "");
    expect(spoken).toEqual(["offline"]);
  });
});
