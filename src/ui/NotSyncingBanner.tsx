// Prominent "not syncing" warning shown on the journal itself, not just the
// small header badge (remediation item 11). When a session expires or the user
// is otherwise signed out, sync stops silently; entries keep saving to this
// device only and never reach the server. This banner makes that state
// impossible to miss and offers a plainly labelled route to sign back in.

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
