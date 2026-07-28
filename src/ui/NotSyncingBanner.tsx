// Prominent "not syncing" warning shown on the journal itself, not just the
// small header badge (remediation item 11). When a session expires or the user
// is otherwise signed out, sync stops silently; entries keep saving to this
// device only and never reach the server. This banner makes that state
// impossible to miss and offers a plainly labelled route to sign back in.

import type { SyncStatus } from "../store/sync";

/**
 * Which sync states mean "writing here reaches nothing".
 *
 * A Record rather than a list of the states that warn, so adding a SyncStatus
 * fails the build until someone decides which side it falls on. That is not
 * hypothetical: "revoked" was added and the banner's condition was left as a
 * bare `=== "signed-out"`, so a device locked out by a lost-device report kept
 * saving locally and said so nowhere on the journal.
 *
 * The states that do NOT warn divide into two kinds, both deliberate. Sync is
 * working ("synced", "connecting", "pending"), or the user has already been
 * told in a way this banner would only repeat: "offline" is temporary and
 * expected, "needs-key" and "disabled" have their own explanations on the Sync
 * screen, and "disabled" is a build without sync at all, where a warning would
 * be noise on every launch forever.
 */
const WARNS: Record<SyncStatus, boolean> = {
  disabled: false,
  "signed-out": true,
  revoked: true,
  connecting: false,
  "needs-key": false,
  synced: false,
  pending: false,
  offline: false,
};

export const isNotSyncing = (s: SyncStatus): boolean => WARNS[s];

interface NotSyncingBannerProps {
  onSignIn: () => void;
}

export default function NotSyncingBanner({ onSignIn }: NotSyncingBannerProps) {
  return (
    <button className="syncBanner" onClick={onSignIn}>
      <span>
        <span style={{ fontWeight: 600, color: "var(--danger)" }}>
          Not syncing.
        </span>{" "}
        New entries are saved on this device only.
      </span>
      <span style={{ fontSize: 12.5, lineHeight: "13px", whiteSpace: "nowrap" }}>
        Sign in ›
      </span>
    </button>
  );
}
