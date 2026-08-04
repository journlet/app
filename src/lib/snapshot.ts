// Backup and restore of the journal itself, as opposed to a rendering of it.
//
// exportMd.ts renders the journal in Carroll notation for a person to read. Its
// own comment called that a "belt-and-braces backup" and it is not one: it drops
// createdAt, signifiers, migration chains, recurrence rules, reminders and habit
// marks, and nothing in the app can read it back. There was no import path of any
// kind, so the only real restore routes were another device's local copy, or the
// server's ciphertext plus the journal key code. A journal with a decent number of
// entries in it deserves a third.
//
// So this exports the document, not a view of it: the same bytes the sync engine
// already ships, via the same function metrics.ts already calls. Lossless by
// construction rather than by keeping a writer and a reader in step.
//
// Restore is a CRDT merge, which is the property worth leaning on. Applying a
// snapshot is additive and idempotent: into a journal that already holds those
// entries it changes nothing, into an empty one it restores everything, and into
// one that has moved on since it adds what is missing without reverting what is
// newer. Yjs resolves per key by clock, so a snapshot taken before a device was
// removed cannot un-remove it. There is no destructive-restore mode to protect
// people from, which is unusual and worth exploiting rather than hiding behind a
// confirmation.
//
// The file is unencrypted. It is the journal in plain bytes, sitting wherever the
// browser puts downloads, and the UI says so.

import * as Y from "yjs";
import { doc } from "../store/journal";

/** Extension chosen so the file is obviously ours and obviously not Markdown. */
export const SNAPSHOT_EXT = "journlet";

/**
 * Every structure a Journlet document is expected to have.
 *
 * Used to tell a snapshot from some other application's Yjs update, which would
 * otherwise merge cleanly and silently put foreign data in the journal. Arrays
 * only: `devices` is deliberately not required, because a journal exported before
 * the device register existed has none and is still a journal.
 */
const REQUIRED = ["entries", "collections", "habits", "recurrences"] as const;

export interface RestoreReport {
  /** Entries in the journal before the snapshot was applied. */
  before: number;
  /** Entries after. Equal to `before` when the snapshot held nothing new. */
  after: number;
}

export class NotASnapshotError extends Error {
  constructor(why: string) {
    super(why);
    this.name = "NotASnapshotError";
  }
}

/** The whole journal as one update. */
export const snapshotBytes = (): Uint8Array => Y.encodeStateAsUpdate(doc);

/**
 * Date and time, not just the date.
 *
 * Two devices backed up on the same day produced the same name, and the browser
 * disambiguated silently with "(1)". A folder of backups you cannot tell apart is
 * most of the way to not having backups, and the moment you need them is the worst
 * moment to be guessing which is which.
 *
 * Local time rather than UTC, because the person reading the filename is the one
 * who clicked the button.
 */
export const snapshotFilename = (now: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    p(now.getMonth() + 1),
    p(now.getDate()),
  ].join("-");
  return `journlet-backup-${stamp}-${p(now.getHours())}${p(
    now.getMinutes()
  )}.${SNAPSHOT_EXT}`;
};

/**
 * Apply a snapshot to the live journal.
 *
 * Decoded into a throwaway document first, and only applied to the real one once
 * that has succeeded. Y.applyUpdate on bytes that are not an update throws part
 * way through, so probing first is what keeps a wrong file from leaving the
 * journal half merged. The cost is decoding twice, on an operation that happens
 * approximately never.
 */
export const restoreSnapshot = (bytes: Uint8Array): RestoreReport => {
  if (bytes.byteLength === 0) throw new NotASnapshotError("That file is empty.");

  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, bytes);
  } catch {
    throw new NotASnapshotError(
      "That file is not a Journlet backup, or it is damaged."
    );
  }

  // A valid Yjs update from something else would merge without complaint, so
  // check it looks like a journal before letting it near one.
  const present = REQUIRED.filter((name) => probe.share.has(name));
  if (present.length === 0)
    throw new NotASnapshotError(
      "That file is a valid document but not a Journlet journal."
    );

  const before = doc.getArray("entries").length;
  Y.applyUpdate(doc, bytes);
  return { before, after: doc.getArray("entries").length };
};
