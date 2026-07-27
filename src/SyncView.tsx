// Sync screen: magic-link sign in, sync status, journal key save/entry,
// sign out. Every action plainly labelled (spec §4.1 no-guessing rule).

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  deleteAccount,
  getJournalKeyCode,
  getSessionEmail,
  getSyncError,
  getSyncStatus,
  lostDevice,
  isConfigured,
  onSyncStatus,
  provideJournalKey,
  signIn,
  signOutAndWipe,
  verifyEmailCode,
} from "./store/sync";
import type { SyncStatus } from "./store/sync";
import { pendingJournalKey } from "./lib/pendingKey";

const STATUS_LABEL: Record<SyncStatus, string> = {
  disabled: "sync not configured in this build",
  "signed-out": "not signed in",
  connecting: "connecting…",
  "needs-key": "journal key needed",
  synced: "synced",
  pending: "changes waiting to sync",
  offline: "offline — will sync when back online",
};

export default function SyncView() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [lostOpen, setLostOpen] = useState(false);
  const [lostDone, setLostDone] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
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
      const msg = e instanceof Error ? e.message : "";
      setError(
        msg && msg !== "{}"
          ? msg
          : "The sign-in email could not be sent — the server gave no detail. Usually an SMTP configuration problem; check the Supabase Auth logs."
      );
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

  // ---- in-app QR scanning (the only linking path that works inside an
  // iOS home-screen app, where external links open in the browser) ----
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopScan = useCallback(() => {
    if (scanTimer.current) clearInterval(scanTimer.current);
    scanTimer.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stopScan, [stopScan]);

  const extractKey = (s: string): string | null => {
    const m = s.match(/jk=([A-Za-z0-9-]+)/);
    if (m) return m[1];
    const t = s.trim();
    return /^J1-/i.test(t) ? t : null;
  };

  const startScan = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setScanning(true); // the effect below wires the stream up post-render
    } catch {
      setError(
        "Camera unavailable or blocked — you can type the key in instead."
      );
      setScanning(false);
    }
  };

  // Attach the stream and start decoding only after the <video> element is
  // definitely in the DOM (a first-time permission grant races an rAF here)
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    scanTimer.current = setInterval(() => {
      if (!ctx || video.readyState < 2) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (canvas.width === 0) return;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(img.data, img.width, img.height);
      if (!found) return;
      const code = extractKey(found.data);
      if (!code) return;
      stopScan();
      setBusy(true);
      provideJournalKey(code)
        .catch((e) =>
          setError(e instanceof Error ? e.message : "That key did not work")
        )
        .finally(() => setBusy(false));
    }, 300);
    return () => {
      if (scanTimer.current) clearInterval(scanTimer.current);
      scanTimer.current = null;
    };
  }, [scanning, stopScan]);

  const signedIn =
    status !== "signed-out" && status !== "disabled" && getSessionEmail();

  // Deleting an account is the one genuinely irreversible action in the app,
  // so it is the documented exception to the undo-toast rule (spec §4.1a):
  // typing the account's own email is the gate. Compared case-insensitively
  // and trimmed, because the friction should come from having to read which
  // account is being destroyed, not from a stray space.
  const accountEmail = getSessionEmail();
  const deleteArmed =
    Boolean(accountEmail) &&
    deleteConfirm.trim().toLowerCase() === accountEmail?.trim().toLowerCase();

  const closeDelete = () => {
    setDeleteOpen(false);
    setDeleteConfirm("");
  };

  return (
    <section style={{ marginBottom: 18 }}>
      <div style={ST.head}>
        <h2 style={ST.title}>Sync</h2>
        <span style={ST.sub}>{STATUS_LABEL[status]}</span>
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
            Linking this device to an existing journal also happens after you
            sign in: enter your journal key when asked.
          </p>
          {pendingJournalKey() && (
            <p style={{ ...ST.p, fontWeight: 600 }}>
              Journal key received from the QR scan — sign in below and this
              device links itself.
            </p>
          )}
          {linkSent ? (
            <>
              <p style={ST.p}>
                Check your email. In a normal browser, tapping the link signs
                you in. In the home-screen app, type the 6-digit code from
                the same email here instead:
              </p>
              <div style={ST.row}>
                <input
                  style={{ ...ST.input, minWidth: 120, maxWidth: 160 }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  placeholder="123456"
                  onChange={(ev) => setOtpCode(ev.target.value)}
                  aria-label="Sign-in code from the email"
                />
                <button
                  className="addBtn"
                  disabled={busy || otpCode.trim().length < 6}
                  onClick={async () => {
                    setError(null);
                    setBusy(true);
                    try {
                      await verifyEmailCode(email, otpCode);
                      setOtpCode("");
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Code not accepted"
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Sign in with code
                </button>
              </div>
            </>
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
            journal key, then scan its QR with the camera button below. Or
            type the key in.
          </p>
          {scanning ? (
            <div style={{ marginBottom: 10 }}>
              <video
                ref={videoRef}
                playsInline
                muted
                style={{
                  width: "100%",
                  maxWidth: 320,
                  borderRadius: 10,
                  border: `1px solid ${LINE}`,
                  display: "block",
                }}
              />
              <button
                className="sheetBtn isQuiet"
                style={{ maxWidth: 320 }}
                onClick={stopScan}
              >
                Cancel scanning
              </button>
            </div>
          ) : (
            <button
              className="sheetBtn"
              style={{ maxWidth: 320, marginBottom: 10 }}
              onClick={() => void startScan()}
            >
              Scan journal key with the camera
            </button>
          )}
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
                    <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                      on your new device: sign in, then Sync → "Scan journal
                      key with the camera" and point it here
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
          <div style={ST.keyBox}>
            <div style={ST.keyLabel}>Lost a device?</div>
            {lostDone ? (
              <p style={{ ...ST.p, marginTop: 0 }}>
                Done. Every other device has been signed out and your journal
                key has changed — the new one is shown above. Save it, and
                use it to re-link the devices you still have.
              </p>
            ) : lostOpen ? (
              <>
                <p style={{ ...ST.p, marginTop: 0 }}>
                  This signs out every device except this one and issues a
                  new journal key. The lost device keeps what it already
                  holds — no one can remotely erase it — but it can never
                  download anything new, and the old key stops working.
                  Afterwards, re-link your remaining devices with the new
                  key.
                </p>
                <div style={ST.row}>
                  <button
                    className="sheetBtn isDanger"
                    style={{ width: "auto" }}
                    disabled={busy}
                    onClick={async () => {
                      setError(null);
                      setBusy(true);
                      try {
                        const newCode = await lostDevice();
                        setKeyCode(newCode);
                        setLostDone(true);
                        setLostOpen(false);
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not complete the lost-device steps"
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Sign out other devices and issue a new journal key
                  </button>
                  <button
                    className="sheetBtn isQuiet"
                    style={{ width: "auto" }}
                    onClick={() => setLostOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="miniBtn" onClick={() => setLostOpen(true)}>
                lost a device? sign it out
              </button>
            )}
          </div>
          <div style={ST.keyBox}>
            <div style={ST.keyLabel}>Sign out</div>
            {signOutOpen ? (
              <>
                <p style={{ ...ST.p, marginTop: 0 }}>
                  Signing out removes this journal and its key from this
                  device. Anything not yet synced, and the journal key itself,
                  cannot be recovered afterwards — the server holds ciphertext
                  only. You can sign back in and re-enter your journal key to
                  restore what did sync.
                </p>
                <label
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    color: INK,
                    maxWidth: 480,
                    margin: "6px 0 10px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={keySaved}
                    onChange={(ev) => setKeySaved(ev.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>I have saved my journal key somewhere safe.</span>
                </label>
                <div style={ST.row}>
                  <button
                    className="sheetBtn isDanger"
                    style={{ width: "auto" }}
                    disabled={busy || !keySaved}
                    onClick={async () => {
                      setError(null);
                      setBusy(true);
                      try {
                        await signOutAndWipe();
                        window.location.reload();
                      } catch (e) {
                        setBusy(false);
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not sign out cleanly"
                        );
                      }
                    }}
                  >
                    Sign out and remove journal from this device
                  </button>
                  <button
                    className="sheetBtn isQuiet"
                    style={{ width: "auto" }}
                    disabled={busy}
                    onClick={() => {
                      setSignOutOpen(false);
                      setKeySaved(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="miniBtn" onClick={() => setSignOutOpen(true)}>
                sign out of this device
              </button>
            )}
          </div>

          <div style={ST.keyBox}>
            <div style={ST.keyLabel}>Delete account</div>
            {deleteOpen ? (
              <>
                <p style={{ ...ST.p, marginTop: 0 }}>
                  This deletes your account, every encrypted update the server
                  holds for it, and your email address. It cannot be undone and
                  there is no grace period — once it is gone, nobody can bring
                  it back, including whoever runs Journlet.
                </p>
                <p style={ST.p}>
                  This journal will also be removed from this device. Other
                  devices you are signed in on keep the copy they already have
                  until you sign out or delete the app there — nothing can erase
                  a device remotely. Export first from the menu if you want to
                  keep a readable copy.
                </p>
                <label
                  style={{
                    display: "block",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    color: INK,
                    maxWidth: 480,
                    margin: "10px 0 6px",
                  }}
                >
                  Type <strong>{accountEmail}</strong> to confirm.
                  <input
                    value={deleteConfirm}
                    onChange={(ev) => setDeleteConfirm(ev.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-label="Type your email address to confirm account deletion"
                    style={{ ...ST.input, width: "100%", margin: "6px 0 4px" }}
                  />
                </label>
                <div style={ST.row}>
                  <button
                    className="sheetBtn isDanger"
                    style={{ width: "auto" }}
                    disabled={busy || !deleteArmed}
                    onClick={async () => {
                      setError(null);
                      setBusy(true);
                      try {
                        await deleteAccount();
                        window.location.reload();
                      } catch (e) {
                        setBusy(false);
                        setError(
                          e instanceof Error
                            ? `Could not delete the account: ${e.message}. Nothing has been deleted — your journal is untouched.`
                            : "Could not delete the account. Nothing has been deleted — your journal is untouched."
                        );
                      }
                    }}
                  >
                    Delete account and all synced data
                  </button>
                  <button
                    className="sheetBtn isQuiet"
                    style={{ width: "auto" }}
                    disabled={busy}
                    onClick={closeDelete}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="miniBtn" onClick={() => setDeleteOpen(true)}>
                delete account and all synced data
              </button>
            )}
          </div>
        </>
      )}

      {error && <p style={ST.error}>{error}</p>}
      {getSyncError() && (
        <p style={ST.error}>Last sync problem: {getSyncError()}</p>
      )}
      <p style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 16 }}>
        build {__BUILD_TIME__}
      </p>
    </section>
  );
}

const INK = "var(--ink)";
const INK_SOFT = "var(--ink-soft)";
const LINE = "var(--line)";

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
    background: "var(--surface)",
    color: INK,
    fontFamily: "inherit",
    minWidth: 200,
  },
  keyBox: {
    background: "var(--surface)",
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
    background: "var(--surface)",
    border: `1px solid ${LINE}`,
    borderRadius: 8,
    padding: "8px 10px",
  },
  error: { fontSize: 13, color: "var(--danger)" },
};
