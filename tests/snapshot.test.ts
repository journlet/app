// Backup and restore of the document (src/lib/snapshot.ts).
//
// The assertion that matters is the last block: a journal restored from a
// snapshot holds the fields the Markdown export drops. That is the whole reason
// this exists, and a version of it that round-tripped only text would pass every
// obvious test while losing the things you would miss.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";

let doc = new Y.Doc();
vi.mock("../src/store/journal", () => ({
  get doc() {
    return doc;
  },
}));

const {
  snapshotBytes,
  restoreSnapshot,
  snapshotFilename,
  NotASnapshotError,
} = await import("../src/lib/snapshot");

/** A journal with one entry carrying every field the renderer throws away. */
const seed = (d: Y.Doc, id: string) => {
  const e = new Y.Map<unknown>();
  d.getArray<Y.Map<unknown>>("entries").push([e]);
  e.set("id", id);
  e.set("type", "task");
  e.set("state", "open");
  e.set("text", "book the dentist");
  e.set("createdAt", 1_700_000_000_000);
  e.set("signifiers", ["priority"]);
  e.set("migrationChain", ["older-id"]);
  e.set("periodKey", "2026-08-04");
  d.getArray<Y.Map<unknown>>("collections");
  d.getArray<Y.Map<unknown>>("habits");
  d.getArray<Y.Map<unknown>>("recurrences");
  return e;
};

beforeEach(() => {
  doc = new Y.Doc();
});

describe("taking a snapshot", () => {
  test("names the file after the day it was taken", () => {
    expect(snapshotFilename("2026-08-04")).toBe(
      "journlet-backup-2026-08-04.journlet"
    );
  });

  test("an empty journal still produces something restorable", () => {
    // Not a special case worth branching on, but worth knowing it does not throw:
    // the first backup someone takes may well be of very little.
    doc.getArray("entries");
    const bytes = snapshotBytes();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("restoring", () => {
  test("brings back a journal from nothing", () => {
    const source = new Y.Doc();
    seed(source, "a");
    const bytes = Y.encodeStateAsUpdate(source);

    const report = restoreSnapshot(bytes);

    expect(report).toEqual({ before: 0, after: 1 });
    expect(doc.getArray("entries").length).toBe(1);
  });

  test("keeps the fields the Markdown export drops", () => {
    // The point of the feature. exportMd writes type, state, text, details,
    // threads, id and parentId, and nothing else.
    const source = new Y.Doc();
    seed(source, "a");
    restoreSnapshot(Y.encodeStateAsUpdate(source));

    const e = doc.getArray<Y.Map<unknown>>("entries").get(0);
    expect(e.get("createdAt")).toBe(1_700_000_000_000);
    expect(e.get("signifiers")).toEqual(["priority"]);
    expect(e.get("migrationChain")).toEqual(["older-id"]);
    expect(e.get("periodKey")).toBe("2026-08-04");
  });

  test("is idempotent: restoring twice is restoring once", () => {
    const source = new Y.Doc();
    seed(source, "a");
    const bytes = Y.encodeStateAsUpdate(source);

    restoreSnapshot(bytes);
    const second = restoreSnapshot(bytes);

    expect(second).toEqual({ before: 1, after: 1 });
    expect(doc.getArray("entries").length).toBe(1);
  });

  test("adds what is missing without removing what is newer", () => {
    // The reason restore needs no "are you sure" and no replace mode. A snapshot
    // is not a rollback.
    const source = new Y.Doc();
    seed(source, "old");
    const bytes = Y.encodeStateAsUpdate(source);
    seed(doc, "written-since");

    const report = restoreSnapshot(bytes);

    expect(report).toEqual({ before: 1, after: 2 });
    const ids = doc
      .getArray<Y.Map<unknown>>("entries")
      .toArray()
      .map((e) => e.get("id"));
    expect(ids).toContain("written-since");
    expect(ids).toContain("old");
  });

  test("cannot un-remove a device removed after the snapshot was taken", () => {
    // Yjs resolves a map key by clock, so the later write wins. Worth pinning,
    // because a restore that resurrected a removed device would be a security
    // regression rather than an inconvenience.
    const source = new Y.Doc();
    seed(source, "a");
    const rec = new Y.Map<unknown>();
    source.getMap<Y.Map<unknown>>("devices").set("phone", rec);
    rec.set("id", "phone");
    const bytes = Y.encodeStateAsUpdate(source);

    Y.applyUpdate(doc, bytes);
    const live = doc.getMap<Y.Map<unknown>>("devices").get("phone");
    live?.set("removedAt", 999);

    restoreSnapshot(bytes);

    expect(
      doc.getMap<Y.Map<unknown>>("devices").get("phone")?.get("removedAt")
    ).toBe(999);
  });
});

describe("refusing a file that is not a backup", () => {
  test("an empty file", () => {
    expect(() => restoreSnapshot(new Uint8Array(0))).toThrow(NotASnapshotError);
  });

  test("something that is not an update at all", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 200, 255, 128]);
    expect(() => restoreSnapshot(junk)).toThrow(/not a Journlet backup/i);
  });

  test("a valid document from something else", () => {
    // This is the one a shape check is for. It merges perfectly cleanly, so
    // nothing would complain, and the journal would quietly contain a stranger's
    // data.
    const foreign = new Y.Doc();
    foreign.getArray("shopping-list").push(["milk"]);

    expect(() => restoreSnapshot(Y.encodeStateAsUpdate(foreign))).toThrow(
      /not a Journlet journal/i
    );
  });

  test("and the journal is untouched when a file is refused", () => {
    // The reason it decodes into a throwaway document first. applyUpdate throws
    // part way through on bad bytes, so applying straight to the real journal
    // could leave it half merged.
    seed(doc, "mine");
    const junk = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 200, 255]);

    expect(() => restoreSnapshot(junk)).toThrow();
    expect(doc.getArray("entries").length).toBe(1);
    expect(doc.getArray<Y.Map<unknown>>("entries").get(0).get("id")).toBe("mine");
  });
});
