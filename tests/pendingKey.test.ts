// @vitest-environment jsdom
//
// The pending journal key is the master keeper key in plaintext, sitting in
// localStorage. These tests pin the two properties that keep that acceptable:
// it expires, and anything unreadable is discarded rather than kept.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_TTL_MS,
  clearPendingKey,
  pendingJournalKey,
  stashKey,
  stashKeyFromUrl,
  sweepPendingKey,
} from "../src/lib/pendingKey";

const STORAGE_KEY = "journlet-pending-journal-key";
const CODE = "J1-ABCDEFGH";

const setHash = (hash: string): void => {
  window.location.hash = hash;
};

beforeEach(() => {
  localStorage.clear();
  setHash("");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stashKeyFromUrl", () => {
  it("takes a key off the fragment and strips it from the address bar", () => {
    setHash(`#jk=${CODE}`);
    stashKeyFromUrl();
    expect(pendingJournalKey()).toBe(CODE);
    expect(window.location.hash).toBe("");
  });

  it("ignores a fragment with no key and stores nothing", () => {
    setHash("#somewhere-else");
    stashKeyFromUrl();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("never writes the key in bare form", () => {
    setHash(`#jk=${CODE}`);
    stashKeyFromUrl();
    // It must be the timestamped record, not the raw code — the timestamp is
    // what makes expiry possible at all.
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe(CODE);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
      k: CODE,
      t: expect.any(Number),
    });
  });
});

describe("expiry", () => {
  it("returns the key while it is inside the TTL", () => {
    vi.useFakeTimers();
    setHash(`#jk=${CODE}`);
    stashKeyFromUrl();
    vi.advanceTimersByTime(PENDING_TTL_MS - 1000);
    expect(pendingJournalKey()).toBe(CODE);
  });

  it("drops the key once the TTL has passed", () => {
    vi.useFakeTimers();
    setHash(`#jk=${CODE}`);
    stashKeyFromUrl();
    vi.advanceTimersByTime(PENDING_TTL_MS + 1000);
    expect(pendingJournalKey()).toBeNull();
  });

  it("erases the expired key from storage, not just from the read", () => {
    vi.useFakeTimers();
    setHash(`#jk=${CODE}`);
    stashKeyFromUrl();
    vi.advanceTimersByTime(PENDING_TTL_MS + 1000);
    pendingJournalKey();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("sweeps an expired key on launch without anything reading it", () => {
    vi.useFakeTimers();
    setHash(`#jk=${CODE}`);
    stashKeyFromUrl();
    vi.advanceTimersByTime(PENDING_TTL_MS + 1000);
    sweepPendingKey();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("leaves a fresh key alone when sweeping", () => {
    setHash(`#jk=${CODE}`);
    stashKeyFromUrl();
    sweepPendingKey();
    expect(pendingJournalKey()).toBe(CODE);
  });
});

describe("unreadable values", () => {
  it("discards a value written in the pre-expiry bare-string format", () => {
    // Anything we cannot age must be treated as expired, otherwise an upgrade
    // would leave old plaintext keys on disk forever.
    localStorage.setItem(STORAGE_KEY, CODE);
    expect(pendingJournalKey()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("discards a record with no timestamp", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ k: CODE }));
    expect(pendingJournalKey()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("discards outright rubbish", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(pendingJournalKey()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(pendingJournalKey()).toBeNull();
  });
});

describe("clearPendingKey", () => {
  it("removes a live key", () => {
    setHash(`#jk=${CODE}`);
    stashKeyFromUrl();
    clearPendingKey();
    expect(pendingJournalKey()).toBeNull();
  });
});

describe("stashKey", () => {
  // A device that has been signed out can scan a QR but cannot use it: reading
  // the wrapped data key needs a session. So the scan is held and applied after
  // sign-in, which is the order that suits someone holding two devices.
  it("holds a scanned key for after sign-in", () => {
    stashKey(CODE);
    expect(pendingJournalKey()).toBe(CODE);
  });

  it("expires like a key taken off the URL, since it is the same credential", () => {
    vi.useFakeTimers();
    stashKey(CODE);
    vi.advanceTimersByTime(PENDING_TTL_MS + 1000);

    expect(pendingJournalKey()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("replaces an earlier key rather than leaving two", () => {
    stashKey("J1-OLDOLDOLD");
    stashKey(CODE);
    expect(pendingJournalKey()).toBe(CODE);
  });
});
