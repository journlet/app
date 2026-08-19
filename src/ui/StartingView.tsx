// The launch screen, from the first frame to the journal (19 August 2026).
//
// It continues the splash in index.html rather than replacing it. That one is
// pre-JS markup and can say nothing about why the wait is happening, on purpose:
// before the bundle runs there is no way to know. This one is rendered by an app
// that does know, so it says which of the two questions is still open, and the
// two share a class name and a layout so the handover is invisible.
//
// Why say anything at all. The state it covers used to be a flash and is now
// occasionally a wait: a cold start refreshes the account token over the network,
// and on a connection that half works Supabase retries that for seconds. A screen
// that spins for four seconds with no account of itself is the kind of thing
// people restart the app to escape. One plain line is what it costs to make the
// wait legible, and it is never a guess — each line names the step actually
// running.
//
// The lines stay in step with store/sync.ts: the wait ends at AUTH_WAIT_MS by
// opening the journal offline, so nothing here has to explain a wait that could
// last for ever, because it cannot.

interface StartingViewProps {
  /** Has the journal finished coming out of IndexedDB? */
  loaded: boolean;
  /** Is the account check still outstanding? */
  checkingAccount: boolean;
}

/**
 * What is happening, in the order it happens.
 *
 * The journal comes first because it is first: reading it from IndexedDB starts
 * at once, and until it lands nothing else on this screen is true yet. Being
 * offline is worth naming because it changes what the wait means — a device with
 * no network is not going to hear back, and it is about to open the journal
 * anyway rather than keep the reader here.
 */
const startingLabel = (loaded: boolean, offline: boolean): string => {
  if (!loaded) return "Opening your journal…";
  if (offline) return "Offline. Opening your journal…";
  return "Checking your account…";
};

export default function StartingView({
  loaded,
  checkingAccount,
}: StartingViewProps) {
  // Read at render rather than tracked: this screen lives for a moment or two,
  // and a device that goes offline within it still ends up in the same place a
  // moment later. Subscribing to it would be state kept for no decision.
  const offline = checkingAccount && !navigator.onLine;
  return (
    // role="status" with the polite live region on the line, so a screen reader
    // hears the wordmark once and then only the step that changed — the same
    // reasoning as the splash it continues, which is announced rather than
    // leaving the screen silent.
    <div className="boot" role="status">
      <p className="boot-mark">Journlet</p>
      <div className="boot-spinner" aria-hidden="true"></div>
      <p className="boot-status" aria-live="polite">
        {startingLabel(loaded, offline)}
      </p>
    </div>
  );
}
