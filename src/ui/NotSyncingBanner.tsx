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
 * hypothetical: a state was once added and this condition left as a bare
 * `=== "signed-out"`, so a device that had stopped syncing said so nowhere on
 * the journal itself.
 *
 * The states that do NOT warn divide into two kinds, both deliberate. Sync is
 * working ("synced", "connecting", "pending"), or the user has already been
 * told in a way this banner would only repeat: "offline" is temporary and
 * expected, "needs-key" and "disabled" have their own explanations on the Sync
 * screen, and "disabled" is a build without sync at all, where a warning would
 * be noise on every launch forever.
 *
 * "signed-out" stays true and is, as of 13 August 2026, unreachable from the
 * journal: a signed-out device holding content now gets ui/SignedOutView instead
 * of the journal, and one holding nothing gets onboarding, so this banner has no
 * journal to sit on in that state. Kept rather than flipped to false, because it
 * is true — writing there would reach nothing — and because if that gate is ever
 * relaxed the warning should come back with it rather than having to be
 * remembered.
 */
const WARNS: Record<SyncStatus, boolean> = {
  disabled: false,
  "signed-out": true,
  connecting: false,
  "needs-key": false,
  synced: false,
  pending: false,
  offline: false,
};

export const isNotSyncing = (s: SyncStatus): boolean => WARNS[s];

export type NotSyncingReason = "signed-out" | "refused";

/**
 * Why the journal in front of you is not reaching the server, or null.
 *
 * "pending" is absent from WARNS because being behind is normally temporary and
 * self-healing. Being behind *with a server error* is not: the server said no,
 * and saying no again in a minute is what it will keep doing. The storage quota
 * is the case that made this necessary, and before it the only account of a
 * refusal was on the Sync screen, which a user has no reason to visit because the
 * journal screen says something reassuring.
 *
 * "offline" is deliberately excluded even with an error attached, since that is
 * the temporary case this distinction exists to separate out.
 */
export const notSyncingReason = (
  s: SyncStatus,
  error: string | null
): NotSyncingReason | null => {
  if (WARNS[s]) return "signed-out";
  if (s === "pending" && error) return "refused";
  return null;
};

interface NotSyncingBannerProps {
  reason: NotSyncingReason;
  onOpenSync: () => void;
}

export default function NotSyncingBanner({
  reason,
  onOpenSync,
}: NotSyncingBannerProps) {
  return (
    <button className="syncBanner" onClick={onOpenSync}>
      <span>
        <span style={{ fontWeight: 600, color: "var(--danger)" }}>
          Not syncing.
        </span>{" "}
        {reason === "refused"
          ? "The server refused the last change, and it will not clear by itself."
          : null}{" "}
        New entries are saved on this device only.
      </span>
      <span style={{ fontSize: 12.5, lineHeight: "13px", whiteSpace: "nowrap" }}>
        {reason === "refused" ? "What happened ›" : "Sign in ›"}
      </span>
    </button>
  );
}
