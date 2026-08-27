import { useEffect, useState } from "react";
import type { Collection, Entry, Habit, Recurrence } from "../lib/types";
import { groupByPage } from "./pageOrder";
import {
  collections as collectionsArr,
  entries,
  habits as habitsArr,
  persistence,
  readAll,
  readCollections,
  readHabits,
  readRecurrences,
  recurrences as recurrencesArr,
} from "./journal";

// There was a `saveState` here, and a "saving…" cue in the header driven by
// it. Both are gone (spec §11 Q20, 27 August 2026): it was set on any Yjs
// document update and cleared on a fixed 400ms timer, so it never waited for
// the IndexedDB write, never noticed one failing, and fired for updates arriving
// from another device — which meant incoming sync was labelled "saving". The
// entry appearing on the page is the confirmation, and writing that never
// reaches the server is what NotSyncingBanner is for.

export interface JournalSnapshot {
  loaded: boolean;
  /** entries grouped by pageKey, ordered by creation time */
  days: Record<string, Entry[]>;
  collections: Collection[];
  habits: Habit[];
  recurrences: Recurrence[];
}

export function useJournal(): JournalSnapshot {
  const [days, setDays] = useState<Record<string, Entry[]>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [recurrences, setRecurrences] = useState<Recurrence[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setDays(groupByPage(readAll()));
      setCollections(readCollections());
      setHabits(readHabits());
      setRecurrences(readRecurrences());
    };

    entries.observeDeep(refresh);
    collectionsArr.observeDeep(refresh);
    habitsArr.observeDeep(refresh);
    recurrencesArr.observeDeep(refresh);
    persistence.whenSynced.then(() => {
      refresh();
      setLoaded(true);
    });

    return () => {
      entries.unobserveDeep(refresh);
      collectionsArr.unobserveDeep(refresh);
      habitsArr.unobserveDeep(refresh);
      recurrencesArr.unobserveDeep(refresh);
    };
  }, []);

  return { loaded, days, collections, habits, recurrences };
}
