// @vitest-environment jsdom
//
// The "this device owes you a look at the recovery code" flag (decision 4).
//
// Local rather than in the journal on purpose: it records that something was
// shown on this screen, not a fact about the journal. Syncing it would let one
// device's acknowledgement silence the prompt on another that had shown nobody
// anything.

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  acknowledgeRecovery,
  markRecoveryPending,
  recoveryPending,
} from "../src/lib/recoveryAck";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the pending flag", () => {
  test("is not set on a device that has done nothing", () => {
    expect(recoveryPending()).toBe(false);
  });

  test("survives a reload once set", () => {
    // The gap between creating a journal and reading the code off the screen
    // includes any number of ways to close a tab. In memory it would be lost
    // there, leaving a journal whose only recovery credential was never shown.
    markRecoveryPending();

    expect(localStorage.getItem("journlet-recovery-pending")).toBe("1");
    expect(recoveryPending()).toBe(true);
  });

  test("clears when acknowledged, and stays clear", () => {
    markRecoveryPending();
    acknowledgeRecovery();

    expect(recoveryPending()).toBe(false);
    expect(recoveryPending()).toBe(false);
  });

  test("marking twice is not cumulative", () => {
    markRecoveryPending();
    markRecoveryPending();
    acknowledgeRecovery();

    expect(recoveryPending()).toBe(false);
  });
});

describe("when storage is unavailable", () => {
  test("marking fails quietly rather than throwing into a connect", () => {
    // This runs inside the sync engine's key check. Throwing there would turn
    // "private browsing" into "cannot sign in".
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => markRecoveryPending()).not.toThrow();
  });

  test("reading reports nothing pending rather than throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(recoveryPending()).toBe(false);
  });

  test("acknowledging fails quietly", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => acknowledgeRecovery()).not.toThrow();
  });
});
