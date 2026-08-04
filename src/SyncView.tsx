// Sync screen: emailed-code sign in, sync status, journal key save/entry,
// sign out. Every action plainly labelled (spec §4.1 no-guessing rule).

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  acceptJournalKey,
  canRemoveDevices,
  deleteAccount,
  DeviceNotClearedError,
  getJournalKeyCode,
  getSessionEmail,
  getSyncError,
  getSyncStatus,
  isConfigured,
  onSyncStatus,
  provideJournalKey,
  removeDevice,
  signIn,
  signOutAndWipe,
  verifyEmailCode,
} from "./store/sync";
import type { SyncStatus } from "./store/sync";
import { listDevices, onDevicesChange } from "./store/devices";
import type { DeviceRecord } from "./store/devices";
import { pendingJournalKey } from "./lib/pendingKey";

// For a moment we know exactly, like when a device was added.
const relativeTime = (ms: number): string => {
  if (!ms) return "never";
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * For last-synced, which the register records at most once an hour to keep it
 * from writing to the append-only log on every launch (see store/devices.ts).
 *
 * So the stored moment can be an hour behind the truth, and a figure like "19
 * minutes ago" claims a precision that does not exist — it read as wrong on a
 * device that was syncing at that moment. This says only what is actually
 * known, which is also all the question needs: do I recognise this device, and
 * is it still in use?
 */
const coarseTime = (ms: number): string => {
  if (!ms) return "never";
  const now = Date.now();
  if (now - ms < 60 * 60 * 1000) return "within the last hour";
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? "a month ago" : `${months} months ago`;
};

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
  const [codeSent, setCodeSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [signOutOpen, setSignOutOpen] = useState(false);
  // Acknowledgement that unsynced entries will be lost. Only asked for when
  // there are any: see the sign-out box.
  const [lossAck, setLossAck] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [keyCode, setKeyCode] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [keyEntry, setKeyEntry] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onSyncStatus(setStatus), []);

  const [deviceList, setDeviceList] = useState<DeviceRecord[]>(() =>
    listDevices()
  );
  useEffect(() => {
    const refresh = () => setDeviceList(listDevices());
    refresh();
    return onDevicesChange(refresh);
  }, []);

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

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim());
      setCodeSent(true);
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

  // Which device the remove confirmation is open for, if any.
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const confirmRemove = async (id: string) => {
    setError(null);
    setRemoveBusy(true);
    try {
      await removeDevice(id);
      setRemoving(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That device was not removed");
    } finally {
      setRemoveBusy(false);
    }
  };

  const [noKeyHere, setNoKeyHere] = useState(false);

  const showKey = async () => {
    const code = await getJournalKeyCode();
    // Null on a device that was added by approval: it was handed the data key
    // alone and never held the recovery key. Saying so is important, because the
    // alternative is a button that appears to do nothing.
    setNoKeyHere(code === null);
    setKeyCode(code);
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
      // The camera is only offered once signed in, so this links immediately.
      // acceptJournalKey still handles the signed-out case by holding the key,
      // which is the path a #jk= link takes.
      acceptJournalKey(code)
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

  // Shared by the needs-key and revoked screens. Both need the camera for the
  // same reason — the key is on another device's screen — and duplicating the
  // <video> wiring would risk the two drifting apart.
  const scanner = (label: string) =>
    scanning ? (
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
        {label}
      </button>
    );

  const signedIn =
    status !== "signed-out" && status !== "disabled" && getSessionEmail();

  /**
   * Might this device be holding writing the server has never seen?
   *
   * Anything other than "synced" could be: "pending" says so outright, and
   * "offline" or "connecting" mean nothing has confirmed. Treating only
   * "pending" as risky would miss the case that matters most, which is signing
   * out on a device that has been offline for a while.
   */
  const unsynced = status !== "synced";

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

      {/* At the top, not the bottom. It used to sit below Delete account, which
          meant the one thing worth reading on a device that could not load was
          the last thing anyone would find (reported 29 Jul). */}
      {getSyncError() && (
        <p style={ST.error}>Last sync problem: {getSyncError()}</p>
      )}

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
          {codeSent ? (
            <>
              {/* One instruction, not two. The email held a link as well
                  until 4 August 2026, so this had to explain which of the two
                  to use and when — and the branch it described was itself the
                  bug, since tapping the link in the home-screen app signs you
                  in inside the default browser instead. The email now carries
                  the code alone, so there is one thing to do and it works the
                  same everywhere. */}
              <p style={ST.p}>
                We have emailed a 6-digit code to{" "}
                <strong>{email.trim()}</strong>. Type it in here to sign in:
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
              {/* Without these this step was a dead end: no way back to the
                  address field, so a typo, an email that never arrives or an
                  expired code left the only route back a force-quit. Tolerable
                  while sign-in was a once-per-device event; not once reporting
                  a lost device drops every surviving device into this flow at
                  the same time. */}
              <div style={{ ...ST.row, marginTop: 8 }}>
                <button className="miniBtn" disabled={busy} onClick={sendCode}>
                  send a new code
                </button>
                <button
                  className="miniBtn"
                  onClick={() => {
                    setCodeSent(false);
                    setOtpCode("");
                    setError(null);
                  }}
                >
                  use a different email address
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
                onKeyDown={(ev) => ev.key === "Enter" && sendCode()}
                aria-label="Email address"
              />
              <button
                className="addBtn"
                disabled={busy || !email.includes("@")}
                onClick={sendCode}
              >
                Email me a sign-in code
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
          {scanner("Scan journal key with the camera")}
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
            ) : noKeyHere ? (
              <p style={{ ...ST.p, marginBottom: 0 }}>
                This device does not hold the journal key. It was added by
                another device, which gave it what it needs to read your journal
                and nothing more — that is what makes it possible to remove this
                device on its own later. The key can be shown on the device that
                created the journal.
              </p>
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
            <div style={ST.keyLabel}>Devices holding this journal</div>
            <p style={{ ...ST.p, marginTop: 0 }}>
              This list is stored inside your encrypted journal, so the server
              never sees it. It is here so you can spot a device you do not
              recognise, and remove one you no longer want to have access.
            </p>
            {deviceList.length === 0 ? (
              <p style={ST.p}>No devices recorded yet.</p>
            ) : (
              <ul style={ST.devList}>
                {deviceList.map((d) => (
                  <li key={d.id} style={ST.devRow}>
                    <div>
                      {/* A signed-out device is drawn back rather than dressed
                          up: the name loses its weight and its full contrast, so
                          the devices that actually hold your journal are the ones
                          that stand out. The state was previously said only in
                          the small print underneath, which Gary read straight
                          past on 31 Jul — true, and invisible. */}
                      <div
                        style={{
                          fontWeight: d.signedOutAt || d.removedAt ? 400 : 600,
                          color:
                            d.signedOutAt || d.removedAt
                              ? "var(--ink-soft)"
                              : "var(--ink)",
                        }}
                      >
                        {d.name}
                        {d.removedAt ? (
                          <span style={ST.devGone}>removed</span>
                        ) : (
                          d.signedOutAt && (
                            <span style={ST.devGone}>signed out</span>
                          )
                        )}
                        {d.isThisDevice && (
                          <span style={ST.devHere}> this device</span>
                        )}
                      </div>
                      <div style={ST.devMeta}>
                        {/* Three cases, in order of what is actually known. A
                            device that said it was leaving is reported as
                            leaving, because "last synced" would imply it still
                            holds a copy it has erased. This device's state is
                            known live, so it is said rather than read back from
                            a timestamp recorded up to an hour ago. Everything
                            else falls to the recorded time. Added is written
                            once and is exact, so it keeps its finer wording. */}
                        {d.removedAt
                          ? `removed ${coarseTime(d.removedAt)}`
                          : d.signedOutAt
                            ? `signed out ${coarseTime(d.signedOutAt)}`
                            : d.isThisDevice && status === "synced"
                              ? "syncing now"
                              : `last synced ${coarseTime(d.lastSeen)}`}
                        {d.firstSeen
                          ? ` · added ${relativeTime(d.firstSeen)}`
                          : ""}
                      </div>
                      {/* Offered only where it can actually be carried out.
                          Removing means rotating the data key, and the new key
                          has to be published under the recovery key first, so a
                          device linked by approval cannot do it. A disabled
                          button with an explanation would be worse than no
                          button: the honest version is that the action lives on
                          the device that holds your recovery code. */}
                      {removing === d.id ? (
                        <div style={{ marginTop: 6, maxWidth: 420 }}>
                          <p style={{ ...ST.p, marginTop: 0 }}>
                            Remove {d.name}? It will not be able to read anything
                            written from now on, and it cannot be added back
                            without approving it again. What it has already synced
                            stays on that device — only signing out or wiping
                            there removes that.
                          </p>
                          <div style={ST.row}>
                            <button
                              className="miniBtn"
                              disabled={removeBusy}
                              onClick={() => void confirmRemove(d.id)}
                            >
                              {removeBusy ? "removing…" : "remove it"}
                            </button>
                            <button
                              className="miniBtn"
                              disabled={removeBusy}
                              onClick={() => setRemoving(null)}
                            >
                              keep it
                            </button>
                          </div>
                        </div>
                      ) : (
                        !d.isThisDevice &&
                        !d.removedAt &&
                        canRemoveDevices() && (
                          <button
                            className="miniBtn"
                            style={{ marginTop: 6 }}
                            onClick={() => setRemoving(d.id)}
                          >
                            remove this device
                          </button>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={ST.keyBox}>
            <div style={ST.keyLabel}>Sign out</div>
            {signOutOpen ? (
              <>
                <p style={{ ...ST.p, marginTop: 0 }}>
                  Signing out removes this journal from this device. What
                  reached the server comes back when you sign in and unlock it
                  again.
                </p>
                {/* The two risks are different in kind and only one of them is
                    conditional. The journal key is recoverable from any other
                    signed-in device, so it is stated rather than gated. Unsynced
                    entries exist nowhere else, so that is what the tick-box is
                    for — and only when there are some. */}
                <p style={ST.p}>
                  Your journal key can be read from another device you are
                  signed in on, under Sync → show journal key. If this is your
                  only device, save it first: the server holds ciphertext only,
                  so nobody can reissue it, including whoever runs Journlet.
                </p>
                {unsynced ? (
                  <>
                    <p style={{ ...ST.p, fontWeight: 600 }}>
                      This device has not finished syncing ({STATUS_LABEL[status]}).
                      Anything written here that has not reached the server will
                      be lost, and nothing can bring it back.
                    </p>
                    <p style={ST.p}>
                      If you can, wait until this says synced and sign out then.
                      It happens on its own once you are back online.
                    </p>
                    <label style={ST.ackLabel}>
                      <input
                        type="checkbox"
                        checked={lossAck}
                        onChange={(ev) => setLossAck(ev.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        I understand entries not yet synced from this device will
                        be lost.
                      </span>
                    </label>
                  </>
                ) : (
                  <p style={ST.p}>
                    Everything written here has synced, so signing out loses
                    nothing.
                  </p>
                )}
                <div style={ST.row}>
                  <button
                    className="sheetBtn isDanger"
                    style={{ width: "auto" }}
                    disabled={busy || (unsynced && !lossAck)}
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
                      setLossAck(false);
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
                        // Two very different failures. Before the server call
                        // succeeds nothing is destroyed and saying so is the
                        // reassurance that matters. After it, the account is
                        // gone for good and only the local clear-up failed —
                        // claiming the journal is untouched would be a lie at
                        // the one moment it would do real harm.
                        if (e instanceof DeviceNotClearedError) {
                          setError(
                            `Your account and everything the server held are deleted. This device could not be cleared automatically (${e.message}). The journal is still on this device: sign out, or clear this site's data in your browser settings, to remove it.`
                          );
                        } else {
                          setError(
                            e instanceof Error
                              ? `Could not delete the account: ${e.message}. Nothing has been deleted — your journal is untouched.`
                              : "Could not delete the account. Nothing has been deleted — your journal is untouched."
                          );
                        }
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
  // Matches the inline checkbox label used by the sign-out confirmation, so the
  // two irreversible actions look and read the same way.
  ackLabel: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 13.5,
    lineHeight: 1.5,
    color: INK,
    maxWidth: 480,
    margin: "6px 0 10px",
  },
  devList: { listStyle: "none", padding: 0, margin: "6px 0 0" },
  devRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    padding: "8px 0",
    borderTop: `1px solid ${LINE}`,
    fontSize: 13.5,
  },
  devHere: {
    fontWeight: 400,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    marginLeft: 6,
  },
  // A filled pill rather than the bare uppercase label used for "this device".
  // The two say different kinds of thing — where you are, versus what a device
  // is no longer doing — and the second one needs to be seen without being read.
  devGone: {
    display: "inline-block",
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    background: "var(--track)",
    border: `1px solid ${LINE}`,
    borderRadius: 999,
    padding: "1px 7px",
    marginLeft: 7,
    verticalAlign: "1px",
  },
  devMeta: { fontSize: 12, color: INK_SOFT, marginTop: 2 },
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
