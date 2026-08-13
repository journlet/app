// Unlocking a device from a passkey (spec §6.1e, §12.1 phase 4).
//
// This runs on a device with no journal on it, which is what makes the wording
// matter more here than anywhere else in the app: somebody has just signed in, been
// shown no journal, and is looking for a way in. So every failure names the two
// routes that already work rather than leaving them to be found, and the button is
// only rendered when the account actually has a passkey to try — a biometric prompt
// that ends in "none has been set up" is how this gets reported as broken.
//
// It sits above the journal key entry rather than below it because §6.1e makes it
// the quick route and the code the belt and braces. It renders nothing at all when
// there is nothing to offer.

import { useEffect, useState } from "react";
import {
  NoPasskeyRouteError,
  UnknownCredentialError,
  countPasskeyRoutes,
  unlockWithPasskey,
} from "../store/sync";
import {
  CredentialRefusedError,
  PrfUnsupportedError,
  probeCredentialSupport,
} from "../lib/prf";

/** The two routes that work on any device, named in every failure here. */
const OTHER_WAYS =
  "Enter your journal key below, or approve this device from one you are already using.";

interface PasskeyUnlockProps {
  textStyle: React.CSSProperties;
}

export default function PasskeyUnlock({ textStyle }: PasskeyUnlockProps) {
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    // Both questions before anything is offered: has this account got a passkey at
    // all, and can this browser use one. Either answer being no means the button
    // would fail at the tap, and a failure that could have been known beforehand is
    // the kind this project keeps having to apologise for.
    //
    // "Can use one" no longer means "has a fingerprint reader" (12 August 2026). A
    // Mac with no Touch ID was offered nothing here while the passkey that would have
    // opened it sat on the phone next to it, because the platform's own offer to scan
    // a QR code was never reached. That was the design's central case, refused by its
    // own capability check.
    void Promise.all([countPasskeyRoutes(), probeCredentialSupport()]).then(
      ([routes, capability]) => setOffer(Boolean(routes) && capability.usable),
      () => setOffer(false)
    );
  }, []);

  if (!offer) return null;

  const unlock = async () => {
    setProblem(null);
    setBusy(true);
    try {
      await unlockWithPasskey();
      // Nothing to say. The status changes, the journal opens, and this screen goes.
    } catch (e) {
      if (e instanceof UnknownCredentialError)
        setProblem(
          e.viaTunnel
            ? // Answered by another device over the platform's QR tunnel, where this
              // failure has a second cause that has nothing to do with which passkeys
              // are enrolled: some password managers produce a different secret over
              // that route than on the device holding the passkey (Gary, 13 August
              // 2026 — a Google-held credential opens its own wrap locally and not
              // through the phone, where an iCloud-held one works either way). Saying
              // "not set up here" would send somebody off to delete a working passkey.
              `That passkey was used from another device by scanning the code, and it did not open this journal. Two things do that. It may not be one of the ones set up here. Or the password manager holding it produces a different secret over that route than on the device it lives on, which is measured behaviour for at least one manager rather than a fault — a passkey in your phone's own manager, iCloud Keychain on an iPhone, is the one that works this way. ${OTHER_WAYS} If you come back to this computer often, unlock it with your journal key now and then set up a passkey from it, under Sync: the one it saves will open it by scanning next time.`
            : `That passkey is not one of the ones set up for this journal. Password managers do not share passkeys with each other, so one made in a different manager cannot open it. ${OTHER_WAYS}`
        );
      else if (e instanceof PrfUnsupportedError)
        setProblem(
          `That passkey works, but the password manager holding it cannot produce the secret Journlet needs. A limit of the manager rather than a fault, and retrying will not change it. ${OTHER_WAYS}`
        );
      else if (e instanceof CredentialRefusedError)
        setProblem(
          "No passkey was used, so nothing has changed. That is what you see if the prompt was cancelled or timed out — try again, or use one of the other ways in below."
        );
      else if (e instanceof NoPasskeyRouteError)
        setProblem(
          `No passkey has been set up for this journal yet. ${OTHER_WAYS} Once you are in, you can set one up from Sync on any device that holds the journal key.`
        );
      else
        setProblem(
          e instanceof Error ? e.message : "That passkey did not open the journal."
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <button className="addBtn" disabled={busy} onClick={unlock}>
        {busy ? "waiting for the passkey…" : "Unlock with a passkey"}
      </button>
      <p style={{ ...textStyle, marginTop: 6 }}>
        Quickest if you set one up on another device: this asks for Face ID, Touch ID
        or your device PIN. Nothing to type.
      </p>
      {/* Was one sentence promising that a device with no biometric can scan a code
          and use the passkey on your phone. Narrowed 13 August 2026 on evidence: that
          route works for a passkey in iCloud Keychain, and fails for one in Google
          Password Manager unless the device can reach Password Manager itself, because
          the code path that carries the secret over the tunnel is not the one the
          provider uses locally. Promising it flatly is how somebody ends up deciding
          their passkey is broken, so this says what it is instead. */}
      <p style={{ ...textStyle, marginTop: 6 }}>
        A device with none of those may offer to scan a code and use the passkey on
        your phone. Worth trying, and not certain: whether it works depends on the
        password manager holding it. Your journal key works everywhere.
      </p>
      {problem && <p style={{ ...textStyle, marginTop: 6 }}>{problem}</p>}
    </div>
  );
}
