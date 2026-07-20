// Sync screen: magic-link sign in, sync status, journal key save/entry,
// sign out. Every action plainly labelled (spec §4.1 no-guessing rule).

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import {
  getJournalKeyCode,
  getSessionEmail,
  getSyncError,
  getSyncStatus,
  isConfigured,
  onSyncStatus,
  pendingJournalKey,
  provideJournalKey,
  signIn,
  signOut,
} from "./store/sync";
import type { SyncStatus } from "./store/sync";

const STATUS_LABEL: Record<SyncStatus, string> = {
  disabled: "sync not configured in this build",
  "signed-out": "not signed in",
  connecting: "connecting…",
  "needs-key": "journal key needed",
  synced: "synced",
  pending: "changes waiting to sync",
  offline: "offline — will sync when back online",
};

interface Props {
  onBack: () => void;
}

export default function SyncView({ onBack }: Props) {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [keyCode, setKeyCode] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [keyEntry, setKeyEntry] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onSyncStatus(setStatus), []);

  useEffect(() => {
    if (!keyCode) {
      setQrUrl(null);
      return;
    }
    void QRCode.toDataURL(`${window.location.origin}/#jk=${keyCode}`, {
      width: 220,
      margin: 1,
      color: { dark: "#26323E", light: "#F5F4EF" },
    }).then(setQrUrl);
  }, [keyCode]);

  const sendLink = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim());
      setLinkSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the link");
    } finally {
      setBusy(false);
    }
  };

  const showKey = async () => {
    setKeyCode(await getJournalKeyCode());
    setCopied(false);
  };

  const copyKey = async () => {
    if (!keyCode) return;
    await navigator.clipboard.writeText(keyCode);
    setCopied(true);
  };

  const downloadKey = () => {
    if (!keyCode) return;
    const blob = new Blob(
      [
        "Journlet journal key\n\n" +
          keyCode +
          "\n\nKeep this safe. It unlocks your journal on new devices.\n" +
          "If you lose every signed-in device and this key, your journal cannot be recovered.\n",
      ],
      { type: "text/plain" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "journlet-journal-key.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const submitKey = async () => {
    setError(null);
    setBusy(true);
    try {
      await provideJournalKey(keyEntry);
      setKeyEntry("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That key did not work");
    } finally {
      setBusy(false);
    }
  };

  const signedIn =
    status !== "signed-out" && status !== "disabled" && getSessionEmail();

  return (
    <section style={{ marginBottom: 18 }}>
      <div style={ST.head}>
        <h2 style={ST.title}>Sync</h2>
        <span style={ST.sub}>{STATUS_LABEL[status]}</span>
        <span style={ST.nav}>
          <button className="miniBtn" onClick={onBack}>
            ‹ back to journal
          </button>
        </span>
      </div>

      {status === "disabled" && (
        <p style={ST.p}>
          This build has no Supabase configuration, so the journal is
          local-only. Add the project URL and anon key to
          src/lib/supabaseConfig.ts and redeploy to enable sync.
        </p>
      )}

      {status === "signed-out" && isConfigured() && (
        <>
          <p style={ST.p}>
            Sign in to sync your journal across devices. Everything is
            end-to-end encrypted — the server only ever stores ciphertext.
          </p>
          {pendingJournalKey() && (
            <p style={{ ...ST.p, fontWeight: 600 }}>
              Journal key received from the QR scan — sign in below and this
              device links itself.
            </p>
          )}
          {linkSent ? (
            <p style={ST.p}>
              Check your email — the sign-in link brings you straight back
              here.
            </p>
          ) : (
            <div style={ST.row}>
              <input
                style={ST.input}
                type="email"
                value={email}
                placeholder="you@example.com"
                onChange={(ev) => setEmail(ev.target.value)}
                onKeyDown={(ev) => ev.key === "Enter" && sendLink()}
                aria-label="Email address"
              />
              <button
                className="addBtn"
                disabled={busy || !email.includes("@")}
                onClick={sendLink}
              >
                Send sign-in link
              </button>
            </div>
          )}
        </>
      )}

      {status === "needs-key" && (
        <>
          <p style={ST.p}>
            This account already has a journal, encrypted with a different
            journal key. Quickest: on your other device open Sync → show
            journal key, and scan the QR there with this device's camera app.
            Or type the key in below.
          </p>
          <input
            style={{ ...ST.input, width: "100%", marginBottom: 8 }}
            value={keyEntry}
            placeholder="J1-XXXX-XXXX-…"
            onChange={(ev) => setKeyEntry(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Enter" && submitKey()}
            aria-label="Journal key"
          />
          <button
            className="addBtn"
            disabled={busy || keyEntry.trim().length < 10}
            onClick={submitKey}
          >
            Unlock with this journal key
          </button>
        </>
      )}

      {signedIn && status !== "needs-key" && (
        <>
          <p style={ST.p}>
            Signed in as <strong>{getSessionEmail()}</strong>.
          </p>
          <div style={ST.keyBox}>
            <div style={ST.keyLabel}>Journal key</div>
            <p style={{ ...ST.p, marginTop: 0 }}>
              Your journal is encrypted with this key. Save it somewhere safe
              — it is the only way to open your journal on a new device, and
              if you lose every device and this key, your journal cannot be
              recovered by anyone.
            </p>
            {keyCode ? (
              <>
                {qrUrl && (
                  <div style={{ textAlign: "center", margin: "4px 0 10px" }}>
                    <img
                      src={qrUrl}
                      alt="Journal key as a QR code"
                      style={{ width: 220, height: 220, borderRadius: 8 }}
                    />
                    <div style={{ fontSize: 12, color: "#6B7683" }}>
                      on your new device: scan this with the camera app, then
                      sign in — it links itself
                    </div>
                  </div>
                )}
                <code style={ST.code}>{keyCode}</code>
                <div style={{ ...ST.row, marginTop: 8 }}>
                  <button className="miniBtn" onClick={copyKey}>
                    {copied ? "copied" : "copy to clipboard"}
                  </button>
                  <button className="miniBtn" onClick={downloadKey}>
                    download as file
                  </button>
                  <button className="miniBtn" onClick={() => setKeyCode(null)}>
                    hide
                  </button>
                </div>
              </>
            ) : (
              <button className="miniBtn" onClick={showKey}>
                show journal key
              </button>
            )}
          </div>
          <p style={ST.p}>
            To link a new device: install Journlet there, sign in with the
            same email, then enter this journal key when asked.
          </p>
          <button
            className="sheetBtn"
            style={{ maxWidth: 260 }}
            onClick={() => void signOut()}
          >
            Sign out (journal stays on this device)
          </button>
        </>
      )}

      {error && <p style={ST.error}>{error}</p>}
      {getSyncError() && (
        <p style={ST.error}>Last sync problem: {getSyncError()}</p>
      )}
    </section>
  );
}

const INK = "#26323E";
const INK_SOFT = "#6B7683";
const LINE = "#DCDAD1";

const ST: Record<string, CSSProperties> = {
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 4,
    marginBottom: 4,
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    margin: 0,
    lineHeight: 1.15,
  },
  sub: { fontSize: 11.5, color: INK_SOFT },
  nav: { marginLeft: "auto", display: "flex", gap: 4, flexShrink: 0 },
  p: { fontSize: 13.5, lineHeight: 1.5, color: INK, maxWidth: 480 },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  input: {
    flex: 1,
    fontSize: 16,
    padding: "9px 12px",
    border: `1.5px solid ${INK}`,
    borderRadius: 10,
    background: "#FFFFFF",
    color: INK,
    fontFamily: "inherit",
    minWidth: 200,
  },
  keyBox: {
    background: "rgba(255,255,255,.65)",
    border: `1px solid ${LINE}`,
    borderRadius: 10,
    padding: "10px 14px",
    margin: "10px 0",
    maxWidth: 480,
  },
  keyLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    marginBottom: 4,
  },
  code: {
    display: "block",
    fontSize: 13,
    wordBreak: "break-all",
    background: "#FFFFFF",
    border: `1px solid ${LINE}`,
    borderRadius: 8,
    padding: "8px 10px",
  },
  error: { fontSize: 13, color: "#A33" },
};
