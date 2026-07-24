// Lightweight, non-user-facing instrumentation for sizing the volume-close
// nudge (remediation item 15; see docs/volume-schema-design.md). We do not yet
// know the threshold at which a journal is "full" — these numbers, gathered as
// a real journal grows, are what we will set it from. Pure measurement: it is
// logged to the console and exposed on `window.__journletMetrics` for
// inspection, with no UI and no effect on data or sync.

import * as Y from "yjs";
import { collections, doc, entries, habits, recurrences } from "./journal";

export interface VolumeMetrics {
  /** Encoded CRDT state size — the real proxy for load time and memory. */
  docBytes: number;
  entries: number;
  recurrences: number;
  collections: number;
  habits: number;
  /** journal_updates rows for the active volume — the initial-sync cost. */
  updateLogRows?: number;
}

export const measureVolume = (): Omit<VolumeMetrics, "updateLogRows"> => ({
  docBytes: Y.encodeStateAsUpdate(doc).length,
  entries: entries.length,
  recurrences: recurrences.length,
  collections: collections.length,
  habits: habits.length,
});

export const logVolumeMetrics = (updateLogRows?: number): VolumeMetrics => {
  const m = { ...measureVolume(), updateLogRows };
  const readable = { ...m, docKB: Math.round(m.docBytes / 102.4) / 10 };
  console.info("journlet volume metrics", readable);
  (window as unknown as { __journletMetrics?: unknown }).__journletMetrics =
    readable;
  return m;
};
