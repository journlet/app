// @vitest-environment jsdom
//
// Whether the journal key has been saved, as far as one device can tell.
//
// A one-flag module, and the tests are about the two decisions in it rather than the
// storage: that not knowing means not nagging for ever, and that the flag is local
// on purpose. The rest of phase 5 hangs off it — first run forces nothing, and the
// Sync line is what makes that safe — so a flag that answered wrong in either
// direction would either nag somebody who has saved it or fall silent for somebody
// who has not.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { keySaved, markKeySaved } from "../src/lib/keySaved";

beforeEach(() => {
  // Unstub first: a test that replaced localStorage with a throwing object leaves it
  // in place, and clearing that one is what fails rather than the test that meant to.
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("what it answers", () => {
  test("not saved, on a device where nobody has said so", () => {
    expect(keySaved()).toBe(false);
  });

  test("saved, once something has", () => {
    markKeySaved();

    expect(keySaved()).toBe(true);
  });

  test("and it survives a reload, which is the whole point of storing it", () => {
    // The reminder has to persist across launches, or it is not a reminder.
    markKeySaved();
    const carried = localStorage.getItem("journlet-journal-key-saved");

    localStorage.clear();
    localStorage.setItem("journlet-journal-key-saved", carried as string);

    expect(keySaved()).toBe(true);
  });
});

describe("storage that will not answer", () => {
  test("reads as saved rather than nagging for ever", () => {
    // A device that cannot read storage cannot read the flag it wrote either, so
    // treating the failure as "not saved" would mean a line nobody could ever
    // clear. The other direction loses a reminder; this one loses trust in every
    // reminder the app gives.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    });

    expect(keySaved()).toBe(true);
  });

  test("and a write that fails is not an error anybody has to see", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
    });

    expect(() => markKeySaved()).not.toThrow();
  });
});
