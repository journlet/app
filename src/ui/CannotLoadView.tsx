// A signed-in device that has never managed to fetch the journal.
//
// Reported 29 July: a transient clock error on the server stopped the first
// reconcile, and the app rendered four empty sections with a small "waiting"
// badge. Nothing was lost, but nothing on screen said so, and an empty journal
// where a full one should be is the most alarming thing this app can show.
//
// So: say what is happening, say the journal is safe, show the error, and offer
// to try again rather than requiring the app to be restarted.

import { S } from "./styles";

interface CannotLoadViewProps {
  error: string | null;
  offline: boolean;
  busy: boolean;
  onRetry: () => void;
}

export default function CannotLoadView({
  error,
  offline,
  busy,
  onRetry,
}: CannotLoadViewProps) {
  return (
    <section style={{ maxWidth: 480 }}>
      <h2
        style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 24,
          fontWeight: 600,
          margin: "8px 0 10px",
          color: "var(--ink)",
        }}
      >
        Cannot load your journal yet
      </h2>
      {/* First, and unhedged. This screen exists because its absence read as
          data loss. */}
      <p style={S.onboardLede}>
        Your journal is safe. It is on the server and on your other devices;
        this one has not been able to fetch it yet.
      </p>
      <p style={S.onboardLede}>
        {offline
          ? "This device is offline. It will load as soon as it is back on the network."
          : "It keeps trying on its own, and usually this clears in a moment."}
      </p>
      {error && (
        <p style={S.onboardNote}>
          What the server said: <span style={{ color: "var(--danger)" }}>{error}</span>
        </p>
      )}
      <button
        className="addBtn"
        style={{ width: "auto" }}
        disabled={busy}
        onClick={onRetry}
      >
        {busy ? "Trying…" : "Try again now"}
      </button>
      <p style={{ ...S.onboardNote, marginTop: 14 }}>
        Nothing you write is lost while this is on screen, but hold off until it
        clears: this device has no copy of the journal to add to yet.
      </p>
    </section>
  );
}
