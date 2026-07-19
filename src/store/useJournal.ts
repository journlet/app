import { useEffect, useRef, useState } from "react";
import type { Entry } from "../lib/types";
import { doc, entries, persistence, readAll } from "./journal";

export type SaveState = "saved" | "saving";

export interface JournalSnapshot {
  loaded: boolean;
  saveState: SaveState;
  /** entries grouped by pageKey, ordered by creation time */
  days: Record<string, Entry[]>;
}

const group = (list: Entry[]): Record<string, Entry[]> => {
  const days: Record<string, Entry[]> = {};
  for (const e of list) (days[e.pageKey] ??= []).push(e);
  for (const k of Object.keys(days))
    days[k].sort((a, b) => a.createdAt - b.createdAt);
  return days;
};

export function useJournal(): JournalSnapshot {
  const [days, setDays] = useState<Record<string, Entry[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => setDays(group(readAll()));

    // y-indexeddb writes every update; surface a brief "saving…" cue
    const onUpdate = () => {
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState("saved"), 400);
    };

    entries.observeDeep(refresh);
    doc.on("update", onUpdate);
    persistence.whenSynced.then(() => {
      refresh();
      setLoaded(true);
    });

    return () => {
      entries.unobserveDeep(refresh);
      doc.off("update", onUpdate);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return { loaded, saveState, days };
}
