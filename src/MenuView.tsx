// Menu (remediation item 13): one plainly labelled home for the controls
// that were scattered across the app — sync, export and notifications —
// plus the future home for preferences (item 12). Kept deliberately lean:
// a notebook has no settings, so every row here earns its place.

import { useState } from "react";
import type { CSSProperties } from "react";
import type { SyncStatus } from "./store/sync";
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
} from "./store/reminders";
import { GRID } from "./lib/grid";
import type { ThemePref } from "./lib/theme";

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const SYNC_LABEL: Record<SyncStatus, string> = {
  disabled: "not configured in this build",
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
  onOpenIndex: () => void;
  onOpenSync: () => void;
  onExport: () => void;
}

export default function MenuView({
  syncStatus,
  theme,
  onSetTheme,
  onOpenIndex,
  onOpenSync,
  onExport,
}: Props) {
  const [perm, setPerm] = useState<NotificationPermission>(
    notificationPermission()
  );
  const supported = notificationsSupported();

  const enableNotifications = async () => {
    const result = await requestNotificationPermission();
    setPerm(result);
  };

  const notifState =
    !supported
      ? "not available in this browser"
      : perm === "granted"
        ? "on — reminders will notify you"
        : perm === "denied"
          ? "blocked in your browser settings"
          : "off";

  return (
    <div>
      <div style={ST.head}>
        <h2 style={ST.title}>Menu</h2>
        <span style={ST.sub}>go to a page, or manage your journal</span>
      </div>

      <section style={ST.group}>
        <div style={ST.groupLabel}>Go to</div>
        <div style={ST.row}>
          <div style={ST.rowText}>
            <div style={ST.rowLabel}>Index</div>
            <div style={ST.rowDesc}>
              Every page with entries, plus collections and the future log.
            </div>
          </div>
          <div style={ST.rowBtn}>
            <button className="miniBtn" onClick={onOpenIndex}>
              open index
            </button>
          </div>
        </div>
      </section>

      <section style={ST.group}>
        <div style={ST.groupLabel}>Sync</div>
        <div style={ST.row}>
          <div style={ST.rowText}>
            <div style={ST.rowLabel}>Sync and account</div>
            <div style={ST.rowDesc}>{SYNC_LABEL[syncStatus]}</div>
          </div>
          <div style={ST.rowBtn}>
            <button className="miniBtn" onClick={onOpenSync}>
              open sync
            </button>
          </div>
        </div>
      </section>

      <section style={ST.group}>
        <div style={ST.groupLabel}>Export</div>
        <div style={ST.row}>
          <div style={ST.rowText}>
            <div style={ST.rowLabel}>Export journal</div>
            <div style={ST.rowDesc}>
              Download the whole journal as a Markdown file, in purist notation.
              Runs on this device — nothing leaves unencrypted.
            </div>
          </div>
          <div style={ST.rowBtn}>
            <button className="miniBtn" onClick={onExport}>
              export journal
            </button>
          </div>
        </div>
      </section>

      <section style={ST.group}>
        <div style={ST.groupLabel}>Notifications</div>
        <div style={ST.row}>
          <div style={ST.rowText}>
            <div style={ST.rowLabel}>Reminders</div>
            <div style={ST.rowDesc}>
              Local reminders for timed entries. {notifState}.
              {perm === "denied" &&
                " Re-enable them in your browser or system settings."}
            </div>
          </div>
          {supported && perm === "default" && (
            <div style={ST.rowBtn}>
              <button className="miniBtn" onClick={enableNotifications}>
                turn on
              </button>
            </div>
          )}
        </div>
      </section>

      <section style={ST.group}>
        <div style={ST.groupLabel}>Preferences</div>
        <div style={ST.row}>
          <div style={ST.rowText}>
            <div style={ST.rowLabel}>Theme</div>
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
    </div>
  );
}

const INK_SOFT = "var(--ink-soft)";
const LINE = "var(--line)";

const ST: Record<string, CSSProperties> = {
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    borderBottom: `1px solid ${LINE}`,
    paddingBottom: 4,
    marginBottom: GRID - 5,
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: 20,
    margin: 0,
    lineHeight: `${GRID}px`,
  },
  sub: { fontSize: 11.5, color: INK_SOFT, lineHeight: "13px" },
  group: { marginBottom: GRID },
  groupLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: INK_SOFT,
    lineHeight: `${GRID}px`,
    margin: "0 4px",
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "4px 4px",
  },
  rowText: { flex: 1, minWidth: 0 },
  // Height matches the label's line box and buttons centre within it, so the
  // control lines up with the "Theme" label rather than floating above it
  segmented: {
    display: "flex",
    gap: 4,
    flexShrink: 0,
    height: GRID,
    alignItems: "center",
  },
  // Match the row label's line box (GRID tall) and centre the pill in it,
  // so the button lines up with the label text and stays put when the
  // description wraps to a second line.
  rowBtn: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    height: GRID,
  },
  rowLabel: { fontSize: 14, lineHeight: `${GRID}px` },
  rowDesc: {
    fontSize: 11.5,
    lineHeight: "16px",
    color: INK_SOFT,
    paddingBottom: 4,
  },
  empty: {
    color: INK_SOFT,
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: `${GRID}px`,
    padding: "0 4px",
  },
};
