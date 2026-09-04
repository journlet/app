// Menu (remediation item 13): one plainly labelled home for the controls
// that were scattered across the app — sync, export and notifications —
// plus the future home for preferences (item 12). Kept deliberately lean:
// a notebook has no settings, so every row here earns its place.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { SyncStatus } from "./store/syncStatus";
import { countUpdates } from "./store/sync";
import { serverUsage } from "./store/usage";
import type { ServerUsage } from "./store/usage";
import { measureVolume } from "./store/metrics";
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
} from "./store/reminders";
import { GRID } from "./lib/grid";
import { S } from "./ui/styles";
import type { ThemePref } from "./lib/theme";
import { checkForUpdate } from "./store/appUpdate";
import type { UpdateCheckResult } from "./store/appUpdate";
import type { InstallMode } from "./lib/install";

/**
 * Bytes as something a person can compare, in the same shape Postgres uses in
 * the quota's own refusal message so the two agree when read side by side.
 */
const size = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1048576
      ? `${Math.round(bytes / 102.4) / 10} KB`
      : `${Math.round(bytes / 104857.6) / 10} MB`;

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const SYNC_LABEL: Record<SyncStatus, string> = {
  disabled: "not configured in this build",
  starting: "checking your account…",
  "signed-out": "not signed in",
  connecting: "connecting…",
  "needs-key": "journal key needed",
  synced: "synced",
  pending: "changes waiting to sync",
  offline: "offline — will sync when back online",
};

interface Props {
  syncStatus: SyncStatus;
  theme: ThemePref;
  onSetTheme: (t: ThemePref) => void;
  installMode: InstallMode;
  canPromptInstall: boolean;
  onInstall: () => void;
  onOpenIndex: () => void;
  onOpenSearch: () => void;
  onOpenSync: () => void;
  onExport: () => void;
  onBackup: () => void;
  /** Returns what to tell the user, whether it worked or not. */
  onRestore: (file: File) => Promise<string>;
}

export default function MenuView({
  syncStatus,
  theme,
  onSetTheme,
  installMode,
  canPromptInstall,
  onInstall,
  onOpenIndex,
  onOpenSearch,
  onOpenSync,
  onExport,
  onBackup,
  onRestore,
}: Props) {
  // What the last restore said. Held here rather than in a toast because the
  // answer is the point of the action: "added 412 entries" and "that file is not
  // a Journlet backup" are both things to read rather than glance at.
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [perm, setPerm] = useState<NotificationPermission>(
    notificationPermission()
  );
  const supported = notificationsSupported();

  // Volume size (remediation item 15): a plain readout of how full this
  // notebook is. Doc size is measured on this device; the update-log count
  // comes from the server (null until it answers, or when signed out).
  const [vol] = useState(() => measureVolume());
  const [logRows, setLogRows] = useState<number | null>(null);
  useEffect(() => {
    void countUpdates().then(setLogRows);
  }, []);
  // Server usage against the account's cap. Null whenever it cannot be known,
  // including on a project where schema.sql has not been applied yet, in which
  // case this row simply says what it always said.
  const [usage, setUsage] = useState<ServerUsage | null>(null);
  useEffect(() => {
    void serverUsage().then(setUsage);
  }, []);
  // 80%, which sounds urgent and is not: the last fifth of the cap is close to a
  // year of writing at the rate this journal actually grows. That is the point of
  // saying it early rather than at the wall, where there is nothing to do about it
  // and no notice was given.
  const nearlyFull = usage !== null && usage.bytes > usage.quota * 0.8;
  const docKB = Math.round(vol.docBytes / 102.4) / 10;

  // Manual update check. The app already checks in the background, but this
  // lets you look straight away; a new build raises the Reload banner.
  const [checkState, setCheckState] = useState<"idle" | "checking" | UpdateCheckResult>(
    "idle"
  );
  const runUpdateCheck = async () => {
    setCheckState("checking");
    setCheckState(await checkForUpdate());
  };
  const updateDesc =
    checkState === "checking"
      ? "Checking…"
      : checkState === "found"
        ? "New version available — tap Reload on the banner at the top to apply it."
        : checkState === "current"
          ? "You’re on the latest version."
          : checkState === "offline"
            ? "You’re offline — reconnect to check for updates."
            : checkState === "unavailable"
              ? "Update checks aren’t available in this build."
              : "Journlet updates itself in the background.";

  const enableNotifications = async () => {
    const result = await requestNotificationPermission();
    setPerm(result);
  };

  // One complete sentence per permission state, rather than a status fragment
  // glued onto a lead-in. The granted state says the quiet part out loud:
  // delivery needs the app open or recently backgrounded (spec §4.6, and §11
  // open question 6 for closed-app push), so the Due list is the real safety
  // net and shouldn't be a surprise.
  const notifDesc =
    !supported
      ? "This browser can’t show notifications. Timed entries still appear " +
        "under Due on your daily page."
      : perm === "granted"
        ? "Notifications are allowed. Timed entries will nudge you while " +
          "Journlet is open or recently in the background. Anything missed " +
          "stays under Due on your daily page."
        : perm === "denied"
          ? "Notifications are blocked, so nothing will nudge you. Re-enable " +
            "them for journlet.com in your browser or system settings. Timed " +
            "entries still appear under Due on your daily page."
          : "Notifications are off. Turn them on and timed entries will nudge " +
            "you while Journlet is open or recently in the background.";

  // Install-to-home-screen row (spec §3, §12 step 9). Always available while
  // running in a browser; hidden once installed (mode "hidden").
  const installDesc =
    installMode === "prompt"
      ? "Add Journlet to your device for instant, full-screen access."
      : installMode === "ios-safari"
        ? "Tap the Share button below, then “Add to Home Screen”."
        : installMode === "ios-other"
          ? "Open journlet.com in Safari, then Share → “Add to Home Screen”."
          : // desktop: no scripted prompt, point at the browser's own control
            "In Chrome or Edge, click the install icon at the right of the " +
            "address bar. In Safari, choose File → Add to Dock.";

  return (
    <div>
      <div style={ST.head}>
        <h2 style={S.sectionTitle}>Menu</h2>
        <span style={S.sectionSub}>go to a page, or manage your journal</span>
      </div>

      <section style={S.section}>
        <div style={S.subGroupLabel}>Go to</div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Index</div>
            <div style={ST.rowDesc}>
              Every page with entries, plus collections and the future log.
            </div>
          </div>
          <div style={S.rowBtn}>
            <button className="miniBtn" onClick={onOpenIndex}>
              open index
            </button>
          </div>
        </div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Find</div>
            <div style={ST.rowDesc}>
              Look up any entry by its words, including completed and migrated
              ones. Also on the capture bar at the bottom of every journal
              page. Runs on this device — your journal is encrypted, so the
              server could not read it even if asked.
            </div>
          </div>
          <div style={S.rowBtn}>
            <button className="miniBtn" onClick={onOpenSearch}>
              find an entry
            </button>
          </div>
        </div>
      </section>

      <section style={S.section}>
        <div style={S.subGroupLabel}>Sync</div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Sync and account</div>
            <div style={ST.rowDesc}>{SYNC_LABEL[syncStatus]}</div>
          </div>
          <div style={S.rowBtn}>
            <button className="miniBtn" onClick={onOpenSync}>
              open sync
            </button>
          </div>
        </div>
      </section>

      <section style={S.section}>
        <div style={S.subGroupLabel}>Export and backup</div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Export journal</div>
            <div style={ST.rowDesc}>
              Download the whole journal as a Markdown file, in purist notation.
              For reading and keeping, not for restoring: it leaves out timestamps,
              signifiers, migration history, repeats and reminders, and Journlet
              cannot read it back in. Use a backup below for that.
            </div>
          </div>
          <div style={S.rowBtn}>
            <button className="miniBtn" onClick={onExport}>
              export journal
            </button>
          </div>
        </div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Back up journal</div>
            <div style={ST.rowDesc}>
              Download a backup file that Journlet can restore from, holding
              everything the export leaves out. The file is not encrypted, so keep
              it somewhere you would keep the journal itself.
            </div>
          </div>
          <div style={S.rowBtn}>
            <button className="miniBtn" onClick={onBackup}>
              back up journal
            </button>
          </div>
        </div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Restore from a backup</div>
            <div style={ST.rowDesc}>
              Adds anything the backup holds that this journal is missing. It never
              removes or overwrites: entries written since the backup was taken stay
              exactly as they are, so restoring twice does nothing the second time.
            </div>
            {restoreNote && <div style={ST.rowNote}>{restoreNote}</div>}
          </div>
          <div style={S.rowBtn}>
            <input
              ref={fileRef}
              type="file"
              accept=".journlet"
              style={{ display: "none" }}
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                // Cleared so choosing the same file twice fires again, which is
                // what someone retrying after an error will do.
                ev.target.value = "";
                if (!file) return;
                setRestoreNote("Reading…");
                void onRestore(file).then(setRestoreNote);
              }}
            />
            <button
              className="miniBtn"
              onClick={() => fileRef.current?.click()}
            >
              choose a backup file
            </button>
          </div>
        </div>
      </section>

      <section style={S.section}>
        <div style={S.subGroupLabel}>Notifications</div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Reminders</div>
            <div style={ST.rowDesc}>{notifDesc}</div>
          </div>
          {supported && perm === "default" && (
            <div style={S.rowBtn}>
              <button className="miniBtn" onClick={enableNotifications}>
                turn on
              </button>
            </div>
          )}
        </div>
      </section>

      {installMode !== "hidden" && (
        <section style={S.section}>
          <div style={S.subGroupLabel}>Install</div>
          <div style={ST.row}>
            <div style={S.rowText}>
              <div style={S.rowLabel}>Install app</div>
              <div style={ST.rowDesc}>{installDesc}</div>
            </div>
            {canPromptInstall && (
              <div style={S.rowBtn}>
                <button className="miniBtn" onClick={onInstall}>
                  install
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <section style={S.section}>
        <div style={S.subGroupLabel}>Updates</div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Check for updates</div>
            <div style={ST.rowDesc}>{updateDesc}</div>
            <div style={ST.rowDesc}>
              This build: {__BUILD_TIME__} · commit {__BUILD_COMMIT__}
            </div>
          </div>
          <div style={S.rowBtn}>
            <button
              className="miniBtn"
              onClick={() => void runUpdateCheck()}
              disabled={checkState === "checking"}
            >
              {checkState === "checking" ? "checking…" : "check now"}
            </button>
          </div>
        </div>
      </section>

      <section style={S.section}>
        <div style={S.subGroupLabel}>Storage</div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>This volume</div>
            <div style={ST.rowDesc}>
              {vol.entries} {vol.entries === 1 ? "entry" : "entries"}, {docKB} KB
              on this device
              {logRows !== null &&
                `, ${logRows} sync ${logRows === 1 ? "update" : "updates"}`}
              {usage && `, ${size(usage.bytes)} of ${size(usage.quota)} on the server`}
              . A rough gauge of how full this notebook is.
            </div>
            {nearlyFull && (
              <div style={{ ...ST.rowDesc, color: "var(--danger)" }}>
                Nearly full. Email hello@journlet.com to have your limit raised.
                Writing here keeps working either way; what stops is the copy
                reaching the server.
              </div>
            )}
          </div>
        </div>
      </section>

      <section style={S.section}>
        <div style={S.subGroupLabel}>Preferences</div>
        <div style={ST.row}>
          <div style={S.rowText}>
            <div style={S.rowLabel}>Theme</div>
            <div style={ST.rowDesc}>
              Light, dark, or follow your device.
            </div>
          </div>
          <div style={ST.segmented} role="group" aria-label="Theme">
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.value}
                className="miniBtn"
                aria-pressed={theme === o.value}
                onClick={() => onSetTheme(o.value)}
                style={
                  theme === o.value
                    ? {
                        background: "var(--surface)",
                        color: "var(--ink)",
                        borderColor: "var(--ink)",
                      }
                    : undefined
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </section>
      {/* Feedback used to be the last section on this screen, and it is not here
          any more. Not because it went: it is at the foot of every screen now
          (ui/FeedbackRow, rendered by App), the Menu among them, and it lands in
          the same place it always did because it was already last.

          Rendered from one place rather than two, and Gary asked for exactly that
          on 4 September 2026 once he had seen it in both. A screen that keeps its
          own copy of a thing every screen has is a second call site to forget: it
          would take the wording, the rule above it and the measurements out of
          step with everywhere else the first time one of them changed here. So
          this screen no longer takes an onOpenFeedback either. */}
    </div>
  );
}

const INK_SOFT = "var(--ink-soft)";
const LINE = "var(--line)";

// `as const satisfies` rather than a Record<string, CSSProperties> annotation.
// The annotation types the values and throws the keys away, so a mistyped key
// compiles and hands back undefined: an element with no styling and no error.
// This keeps the value checking and infers the key union, so a typo is a build
// failure (assessment Finding 15; ui/styles.ts:12 has the longer version).
const ST = {
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 4,
    marginBottom: GRID - 5,
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "4px 4px",
  },
  // Height matches the label's line box and buttons centre within it, so the
  // control lines up with the "Theme" label rather than floating above it
  segmented: {
    display: "flex",
    gap: 4,
    flexShrink: 0,
    height: GRID,
    alignItems: "center",
  },
  rowDesc: {
    fontSize: 11.5,
    lineHeight: "16px",
    color: INK_SOFT,
    paddingBottom: 4,
  },
  /** What the last restore said. Full ink, because it is an answer to a question
   *  the person just asked, not supporting detail. */
  rowNote: {
    fontSize: 12,
    lineHeight: "16px",
    paddingBottom: 4,
  },
  empty: {
    color: INK_SOFT,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: `${GRID}px`,
    padding: "0 4px",
  },
} as const satisfies Record<string, CSSProperties>;
