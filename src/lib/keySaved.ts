// Whether the journal key has been saved anywhere, as far as this device can tell
// (spec §6.1e, §12.1 phase 5).
//
// The code is nagged rather than forced. Forcing it at first run was rejected as
// the hardest possible ask at the moment of least investment, which is what the
// build before phase 5 got wrong: it gated the journal behind a checkbox on a
// screen somebody had not yet earned a reason to care about. So first run offers
// the passkey as the default and the code as belt and braces, and whoever skips it
// meets a line on the Sync screen that stays until this is set.
//
// Three places this could live, and two of them are wrong.
//
//   The server. Forbidden by §6.5, and rightly: "has this person written their
//   recovery code down" describes the person rather than the journal, and would be
//   class none.
//
//   The encrypted journal, which is §6.5's default answer for a new field, and the
//   one that would silence the reminder on every device at once. It is wrong here
//   for a duller reason: the doc is per volume (store/journal.ts), so the flag
//   would come back the day somebody starts a new notebook, and the key has not
//   changed. A reminder that returns for no reason is one people learn to ignore.
//
//   So: local, per device. The cost is that saving the code on one device does not
//   silence the line on another, and the interface says as much rather than
//   pretending the app can see where a code has been put. Nothing anywhere can:
//   the honest version of this flag is a self-report, and the screen is written
//   that way.
import { JOURNAL_KEY_SAVED_KEY } from "./storageKeys";


const SAVED_KEY = JOURNAL_KEY_SAVED_KEY;

/**
 * Note that the key is somewhere safe.
 *
 * Called for a copy or a download, which are the closest thing to evidence
 * available, and for the explicit "I have saved it" — and by the sync engine when
 * a journal key code is typed in, since somebody entering it plainly has it.
 */
export const markKeySaved = (): void => {
  try {
    localStorage.setItem(SAVED_KEY, "1");
  } catch {
    // Storage blocked. The reminder stays, which is the safe direction for the one
    // credential nobody can reissue.
  }
};

export const keySaved = (): boolean => {
  try {
    return localStorage.getItem(SAVED_KEY) === "1";
  } catch {
    // Unknowable rather than false: a device that cannot read storage cannot read
    // the flag it wrote either, so nagging for ever would be the only outcome.
    return true;
  }
};
