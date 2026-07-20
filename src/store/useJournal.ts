import { useEffect, useRef, useState } from "react";
import type { Collection, Entry, Habit, Recurrence } from "../lib/types";
import {
  collections as collectionsArr,
  doc,
  entries,
  habits as habitsArr,
  persistence,
  readAll,
  readCollections,
  readHabits,
  readRecurrences,
  recurrences as recurrencesArr,
} from "./journal";

export type SaveState = "saved" | "saving";

export interface JournalSnapshot {
  loaded: boolean;
  saveState: SaveState;
  /** entries grouped by pageKey, ordered by creation time */
  days: Record<string, Entry[]>;
  collections: Collection[];
  habits: Habit[];
  recurrences: Recurrence[];
}

// Order a page: top-level entries by creation time, each followed by its
// children (one level deep). Orphans — children whose parent left the page —
// are promoted to top level.
const orderPage = (list: Entry[]): Entry[] => {
  list.sort((a, b) => a.createdAt - b.createdAt);
  const ids = new Set(list.map((e) => e.id));
  const ordered: Entry[] = [];
  for (const e of list) {
    if (e.parentId && ids.has(e.parentId)) continue; // placed under parent
    if (e.parentId) e.parentId = undefined; // orphan → promote
    ordered.push(e);
    for (const child of list)
      if (child.parentId === e.id) ordered.push(child);
  }
  return ordered;
};

const group = (list: Entry[]): Record<string, Entry[]> => {
  const days: Record<string, Entry[]> = {};
  for (const e of list) (days[e.pageKey] ??= []).push(e);
  for (const k of Object.keys(days)) days[k] = orderPage(days[k]);
  return days;
};

export function useJournal(): JournalSnapshot {
  const [days, setDays] = useState<Record<string, Entry[]>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [recurrences, setRecurrences] = useState<Recurrence[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      setDays(group(readAll()));
      setCollections(readCollections());
      setHabits(readHabits());
      setRecurrences(readRecurrences());
    };

    // y-indexeddb writes every update; surface a brief "saving…" cue
    const onUpdate = () => {
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState("saved"), 400);
    };

    entries.observeDeep(refresh);
    collectionsArr.observeDeep(refresh);
    habitsArr.observeDeep(refresh);
    recurrencesArr.observeDeep(refresh);
    doc.on("update", onUpdate);
    persistence.whenSynced.then(() => {
      refresh();
      setLoaded(true);
    });

    return () => {
      entries.unobserveDeep(refresh);
      collectionsArr.unobserveDeep(refresh);
      habitsArr.unobserveDeep(refresh);
      recurrencesArr.unobserveDeep(refresh);
      doc.off("update", onUpdate);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return { loaded, saveState, days, collections, habits, recurrences };
}
