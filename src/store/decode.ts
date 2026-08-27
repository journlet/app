// Reading a Y.Map back into a typed record, without trusting what is in it.
//
// Everything in the journal doc arrives from somewhere this device does not
// control: another device on the account, a merge of two of them, or an update
// row written by a build that is not this one. The decoders read it back with
// about fifty `as string` and `as number` casts, which is TypeScript being told
// what is there rather than asked. A field of the wrong shape therefore reached
// the interface as itself: an entry with `id: undefined` cannot be found by
// findMap and so cannot be edited or deleted, an unknown `type` indexes GLYPH to
// undefined and draws no bullet at all, which is a notation failure the §4 rules
// forbid, and `toHabit` read `marks` with a bare cast and a `.forEach`, so a row
// without one threw rather than degraded.
//
// The realistic cause is version skew rather than corruption, and that decides
// the policy. An older build reading a newer journal will meet fields it has no
// name for, and the wrong answer then is to drop the record: the entry is still
// on the server and still on the device that wrote it, so hiding it here reads
// as data loss while nothing is lost. So a field whose value is unusable is
// repaired to the blandest safe default and counted, and only a record that
// cannot be placed at all is rejected.
//
//   rejected  no id, no page, or no created time. There is nowhere to draw it
//             and no way to act on it. A recurrence with no usable cadence is
//             rejected too, because repairing that one would spawn occurrences
//             on the wrong days, and writing wrong data is worse than stopping.
//
//   repaired  an unknown type, state or collection kind, missing text, a
//             nonsensical interval. The record keeps its place and says
//             something plain; the person can see it and correct it.
//
// Both are counted rather than swallowed. store/sync.ts states the rule this
// follows: a journal that quietly drops content while the badge reads "synced"
// is worse than one that admits a problem. The count reaches a human through the
// feedback diagnostics (lib/feedback.ts) and `window.__journletDecodeFaults`.

import * as Y from "yjs";

// ---------- field readers ----------

/** A non-empty string, or undefined. Empty is not a value here: every string
 *  field these records require is an id, a key or a name. */
export const readString = (
  m: Y.Map<unknown>,
  key: string
): string | undefined => {
  const v = m.get(key);
  return typeof v === "string" && v !== "" ? v : undefined;
};

/** A finite number, or undefined. Rejects NaN and Infinity, which arithmetic
 *  and sorting both propagate silently. */
export const readNumber = (
  m: Y.Map<unknown>,
  key: string
): number | undefined => {
  const v = m.get(key);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

/** A positive integer, or undefined. For intervals, where 0 and -1 would make
 *  the materialiser walk nowhere or backwards. */
export const readCount = (
  m: Y.Map<unknown>,
  key: string
): number | undefined => {
  const v = readNumber(m, key);
  return v !== undefined && Number.isInteger(v) && v > 0 ? v : undefined;
};

/**
 * One of a known set of strings, or undefined.
 *
 * The set is the app's own union, so anything outside it is either a typo this
 * build wrote or a value a later build understands. Either way this build must
 * not pretend to know it.
 */
export const readOneOf = <T extends string>(
  m: Y.Map<unknown>,
  key: string,
  allowed: readonly T[]
): T | undefined => {
  const v = m.get(key);
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
};

/** A nested Y.Map, or undefined. The cast this replaces was the one that threw. */
export const readMap = (
  m: Y.Map<unknown>,
  key: string
): Y.Map<unknown> | undefined => {
  const v = m.get(key);
  return v instanceof Y.Map ? v : undefined;
};

/**
 * The keys of a nested Y.Map used as a set, sorted.
 *
 * Sorted because render order has to be stable: these are threads and habit
 * marks, and a Y.Map iterates in whatever order the merge left it in, which can
 * differ between two devices holding the same journal.
 */
export const readKeys = (m: Y.Map<unknown>, key: string): string[] => {
  const inner = readMap(m, key);
  if (!inner) return [];
  const keys: string[] = [];
  inner.forEach((_v, k) => keys.push(k));
  return keys.sort();
};

// ---------- the tally ----------

export interface DecodeFaults {
  /** Records that could not be placed, by kind. */
  rejected: Record<string, number>;
  /** Fields replaced with a safe default, by `kind.field`. */
  repaired: Record<string, number>;
}

const faults: DecodeFaults = { rejected: {}, repaired: {} };

/**
 * Warned-about faults, so a fault is reported once rather than on every read.
 *
 * `readAll` runs on any change to the doc and on several renders after it, so a
 * warning per occurrence would bury the first one, which is the useful one.
 */
const warned = new Set<string>();

const publish = (): void => {
  if (typeof window === "undefined") return;
  (
    window as unknown as { __journletDecodeFaults?: DecodeFaults }
  ).__journletDecodeFaults = faults;
};

export const rejectRecord = (kind: string, why: string): null => {
  faults.rejected[kind] = (faults.rejected[kind] ?? 0) + 1;
  const tag = `reject:${kind}:${why}`;
  if (!warned.has(tag)) {
    warned.add(tag);
    console.warn(
      `journlet: a ${kind} in this journal could not be read (${why}) and is not being shown. It is still on the server and on the device that wrote it.`
    );
  }
  publish();
  return null;
};

/** Note a field that was replaced, and return the replacement. */
export const repairField = <T>(kind: string, field: string, fallback: T): T => {
  const tag = `${kind}.${field}`;
  faults.repaired[tag] = (faults.repaired[tag] ?? 0) + 1;
  if (!warned.has(tag)) {
    warned.add(tag);
    console.warn(
      `journlet: ${tag} was not a value this build understands, so it is being shown as ${JSON.stringify(fallback)}.`
    );
  }
  publish();
  return fallback;
};

export const decodeFaults = (): DecodeFaults => ({
  rejected: { ...faults.rejected },
  repaired: { ...faults.repaired },
});

const total = (r: Record<string, number>): number =>
  Object.values(r).reduce((a, b) => a + b, 0);

/**
 * The tally as one line for the feedback diagnostics, or "none".
 *
 * Always present, like `sync error: none`, because the diagnostics block is read
 * by the same person every time and a stable shape is quicker to scan than a
 * tidy one.
 */
export const decodeFaultLine = (f: DecodeFaults = faults): string => {
  const r = total(f.rejected);
  const p = total(f.repaired);
  if (r === 0 && p === 0) return "none";
  const parts: string[] = [];
  if (r > 0)
    parts.push(
      `${r} not shown (${Object.entries(f.rejected)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ")})`
    );
  if (p > 0)
    parts.push(
      `${p} field${p === 1 ? "" : "s"} defaulted (${Object.entries(f.repaired)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ")})`
    );
  return parts.join("; ");
};

/** Tests only: the tally is module state and outlives a test otherwise. */
export const resetDecodeFaults = (): void => {
  faults.rejected = {};
  faults.repaired = {};
  warned.clear();
};
