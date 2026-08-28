// The subscribe/notify pair, written once.
//
// Three modules had grown their own: store/appUpdate.ts, lib/install.ts and
// store/syncStatus.ts each held a `Set<Listener>` and a `const emit = () =>
// listeners.forEach((l) => l())`. store/syncStatus.ts keeps its own, deliberately
// and permanently, because its snapshot has to change identity for
// useSyncExternalStore to see an error arrive with no status change, and that
// reasoning is written up there. The other two were the same eight lines twice.
//
// The more useful half of this file is `version`. Both of those modules are stores
// whose interesting state is *computed* rather than stored: whether the install
// banner should show depends on the display mode, a localStorage flag and whether
// a deferred prompt event exists, none of which is a value anybody holds. A
// component reading that with useSyncExternalStore needs a snapshot that changes
// whenever anything behind it might have, and a count of notifications is exactly
// that. It is why the hand-rolled versions used a tick counter in the component,
// and moving the counter into the store is what lets the component stop keeping
// state about somebody else's data.
//
// Which matters beyond neatness. `useState` plus `useEffect` has a window: state
// read during render, listener attached after it, and anything that fires in
// between is lost. App.tsx read `getUpdateReady()` into state and then subscribed,
// so a service worker that finished precaching in that gap raised no banner until
// the next reload. useSyncExternalStore closes it by re-reading the snapshot after
// subscribing, which is the whole reason React added it.

export interface Emitter {
  /** Subscribe, and get an unsubscribe back. Shaped for useSyncExternalStore. */
  subscribe: (fn: () => void) => () => void;
  /** Notify every subscriber, and move `version` on. */
  emit: () => void;
  /**
   * How many times `emit` has been called.
   *
   * A snapshot for a store with nothing stored to snapshot. Monotonic, so it can
   * only ever compare unequal to a stale read, and a number, so the equality
   * useSyncExternalStore does is the right one.
   */
  version: () => number;
}

export const createEmitter = (): Emitter => {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit: () => {
      version += 1;
      // Notify the set as it stood when this started. Iterating it live is safe
      // for a listener that removes *itself*, which a Set handles, but not for one
      // whose work removes another: a listener not yet reached and then deleted is
      // skipped, and it never learns about a change it was subscribed for. In React
      // that is two components unmounting together, the first one's notification
      // unmounting the second, and the second keeping stale state.
      const notifying = [...listeners];
      for (const fn of notifying) fn();
    },
    version: () => version,
  };
};
