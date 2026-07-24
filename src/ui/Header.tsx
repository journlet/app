// App header: brand, contextual back/menu button, transient save cue, and the
// always-visible sync status button (spec §4.5). Presentational — App decides
// which buttons apply and what each does; the sync label/attention tables live
// here since this is their only use.

import type { SyncStatus } from "../store/sync";
import { S } from "./styles";

// Always-visible sync state on the header button (spec §4.5); plain words,
// attention colour when something needs the user.
const SYNC_BADGE: Record<SyncStatus, string> = {
  disabled: "sync",
  "signed-out": "sync · signed out",
  connecting: "sync · connecting…",
  "needs-key": "sync · key needed",
  synced: "sync · synced",
  pending: "sync · waiting",
  offline: "sync · offline",
};

const SYNC_ATTENTION: SyncStatus[] = [
  "signed-out",
  "needs-key",
  "pending",
  "offline",
];

interface HeaderProps {
  showBack: boolean;
  showMenu: boolean;
  onBack: () => void;
  onMenu: () => void;
  saving: boolean;
  syncStatus: SyncStatus;
  onSyncClick: () => void;
}

export default function Header({
  showBack,
  showMenu,
  onBack,
  onMenu,
  saving,
  syncStatus,
  onSyncClick,
}: HeaderProps) {
  return (
    <header style={S.header}>
      <div style={S.brandRow}>
        <span style={S.brand}>Journlet</span>
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          {showBack && (
            <button className="miniBtn" onClick={onBack}>
              back
            </button>
          )}
          {/* Menu opens from home only; every sub-screen uses "back" */}
          {showMenu && (
            <button className="miniBtn" onClick={onMenu}>
              menu
            </button>
          )}
          {/* Transient cue while the local IndexedDB write is in
              flight; the sync badge is the persistent status */}
          {saving && <span style={S.saveDot}>saving…</span>}
          {/* Sync pinned to the far right — a persistent status present
              on every screen, so it lives in one consistent spot. On the
              sync screen it stays put as a status but doesn't re-navigate. */}
          <button
            className="miniBtn"
            style={
              SYNC_ATTENTION.includes(syncStatus)
                ? { color: "var(--danger)", borderColor: "var(--danger-line)" }
                : undefined
            }
            onClick={onSyncClick}
          >
            {SYNC_BADGE[syncStatus]}
          </button>
        </span>
      </div>
    </header>
  );
}
