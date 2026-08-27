// The credential register (13 August 2026, Gary): which saved passkey route is
// which, held inside the encrypted journal beside the device register (§6.1c).
//
// §6.1e always said the correspondence between a wrap and a device belonged "in
// the encrypted device register, where every other human-readable device label
// already lives", and store/keeperWraps.ts repeats it. Nothing wrote it, so the
// interface could only ever count rows, and §6.1h concluded from the count that
// per-credential removal could not honestly be offered at all. That conclusion was
// about the *column*: §6.5 keeps credential ids off `keeper_wraps` because a row
// naming its credential would tell the operator which password manager somebody
// uses. In ciphertext the same fact is ordinary content, exactly as a device label
// is, and `wrap_id` is already on the row and already opaque. So a register keyed
// by wrap id can name every route the account has without adding a column
// anywhere.
//
// What it is for, in Gary's words: marrying up what the app thinks exists against
// what is actually in the password managers. That is reconciliation rather than
// naming, so nothing here asks anybody to type a label. Every field is either
// measured (the fingerprint, the credential id) or observed at the moment it
// happened (the client, the route, the times), which is also why the list is worth
// trusting when it disagrees with what you expected.
//
// Two rules carried over from the device register, for the same reasons. It is
// informational: any device holding the data key can edit this map, so a row is a
// record and not a lock. And it may never hide a route — the list is built from the
// rows the *server* returns, with these notes attached where one matches, so a note
// that has been deleted or was never written leaves an unlabelled route on screen
// rather than a route missing from it. Removal acts on the server's wrap id.

import * as Y from "yjs";
import { credentials, doc } from "./journal";
import { describeThisClient } from "./devices";
import { readNumber, readOneOf, readString } from "./decode";

/**
 * Where a secret came from, in the only two flavours that matter here.
 *
 * WebAuthn reports "platform" or "cross-platform" attachment; §6.1k established by
 * measurement that the cross-device tunnel does not carry PRF faithfully for every
 * password manager, so one credential can derive one secret locally and a different
 * one through the phone. A wrap therefore belongs to a credential *and* a route, and
 * a list that recorded only the credential would mislead in precisely the way that
 * took five wrong explanations to find.
 *
 * An unreported attachment counts as another device, matching store/sync.ts: the
 * cautious reading in every other place this value is used.
 */
export const ENROL_ROUTES = ["this device", "another device"] as const;
export type EnrolRoute = (typeof ENROL_ROUTES)[number];

export const routeOf = (attachment: string | null): EnrolRoute =>
  attachment === "platform" ? "this device" : "another device";

/** What the register knows about one saved route. */
export interface CredentialNote {
  wrapId: string;
  /**
   * The credential that this wrap was written for, base64url.
   *
   * Held here and nowhere the server can see it. Shown truncated, in the same form
   * §6.1k uses when it names `36b1d31fe3a6`, because the full handle is long and
   * the first characters are already enough to tell two rows apart by eye.
   */
  credentialId?: string;
  /**
   * Eight hex characters of the derived secret (§6.1k, IDR-017).
   *
   * The discriminator that survives when nothing else matches: a credential reached
   * over a different route derives a different secret, so two rows sharing a
   * credential id and differing here are the same passkey enrolled twice by two
   * routes, which is a thing that has actually happened on this account.
   */
  fingerprint?: string;
  /** "Chrome (macOS)": the client this route was enrolled from. */
  enrolledOn?: string;
  /**
   * The password manager holding the credential, where the platform named it.
   *
   * The field that answers "which of my passkeys is this", and a browser name cannot:
   * Chrome on a Mac may hold a Google credential, an iCloud one or its own, and they
   * behave differently over the tunnel (§6.1k). Read from the AAGUID at enrolment and
   * absent whenever the client anonymises it, which is common and not an error.
   */
  provider?: string;
  enrolledRoute?: EnrolRoute;
  enrolledAt: number;
  /**
   * Every client that has opened the journal with this route, most recent first.
   *
   * Collected rather than replaced, for the reason the device register collects
   * clients: last-opened alone is overwritten by whichever device used it most
   * recently, so a phone's unlock disappeared from the screen the next time the Mac
   * unlocked, and "it does not acknowledge that I used it on my phone" is the fair
   * reading of that (Gary, 13 August 2026).
   */
  openedBy?: string[];
  /** When this route last opened the journal, which is the evidence it still works. */
  lastOpenedAt?: number;
  lastOpenedOn?: string;
  lastOpenedRoute?: EnrolRoute;
}

/** A saved route as the screen needs it: the server's row, plus what is known of it. */
export interface RouteListing {
  wrapId: string;
  note: CredentialNote | null;
}

/** The clients that have opened a route, most recently used first. */
const clientsOf = (rec: Y.Map<unknown>): string[] | undefined => {
  const map = rec.get("openedBy");
  if (!(map instanceof Y.Map) || map.size === 0) return undefined;
  const seen: { name: string; at: number }[] = [];
  map.forEach((at, name) =>
    seen.push({ name, at: typeof at === "number" && Number.isFinite(at) ? at : 0 })
  );
  return seen.sort((a, b) => b.at - a.at).map((s) => s.name);
};

/**
 * A note about one route into the journal.
 *
 * Nothing here is rejected. Every field is descriptive by design (§6.5 forbids
 * the row from holding anything that could identify the credential), so the note
 * exists to say what it can and stay silent about the rest, which is what an
 * absent field already meant. A route that could not be described is still a
 * route, and hiding it would understate how many ways into the journal there are.
 */
const toNote = (wrapId: string, rec: Y.Map<unknown>): CredentialNote => ({
  wrapId,
  credentialId: readString(rec, "credentialId"),
  fingerprint: readString(rec, "fingerprint"),
  enrolledOn: readString(rec, "enrolledOn"),
  provider: readString(rec, "provider"),
  openedBy: clientsOf(rec),
  enrolledRoute: readOneOf(rec, "enrolledRoute", ENROL_ROUTES),
  enrolledAt: readNumber(rec, "enrolledAt") ?? 0,
  lastOpenedAt: readNumber(rec, "lastOpenedAt"),
  lastOpenedOn: readString(rec, "lastOpenedOn"),
  lastOpenedRoute: readOneOf(rec, "lastOpenedRoute", ENROL_ROUTES),
});

/**
 * Record a route as it is created.
 *
 * Called after the wrap is published rather than before, so a failed publish leaves
 * no note describing a route that does not exist. The reverse order is the mistake
 * §6.1c had to correct in the device register.
 */
export const noteEnrolment = (n: {
  wrapId: string;
  credentialId?: string;
  fingerprint?: string;
  provider?: string | null;
  attachment: string | null;
}): void => {
  doc.transact(() => {
    const rec = new Y.Map<unknown>();
    credentials.set(n.wrapId, rec);
    rec.set("enrolledAt", Date.now());
    rec.set("enrolledOn", describeThisClient());
    rec.set("enrolledRoute", routeOf(n.attachment));
    if (n.credentialId) rec.set("credentialId", n.credentialId);
    if (n.fingerprint) rec.set("fingerprint", n.fingerprint);
    // Only when the platform said so. An anonymised AAGUID is the common case and
    // must leave the field empty rather than write "unknown", which would read as a
    // fact about the credential rather than about what the browser would tell us.
    if (n.provider) rec.set("provider", n.provider);
  });
};

/**
 * Record that a route opened the journal, and fill in what an older row never held.
 *
 * This is what makes the list answer the question on an account whose wraps predate
 * the register: unlock over each route once, and every row that stays blank is a
 * route no credential you have can open. The wrap that opened is known because
 * `unwrapKeeperKeyFromAny` reports which row authenticated, so nothing here is
 * inferred.
 *
 * Creates a row where there was none, which is the migration: no copying pass, no
 * version flag, and an account that never unlocks anything simply keeps a shorter
 * list. Fields already present are overwritten only where the newer observation is
 * strictly better information — the credential id and fingerprint are the same
 * measurement either way, and enrolment details are not re-derivable, so they are
 * left alone once written.
 */
export const noteUnlock = (n: {
  wrapId: string;
  credentialId?: string;
  fingerprint?: string;
  attachment: string | null;
}): void => {
  doc.transact(() => {
    let rec = credentials.get(n.wrapId);
    if (!(rec instanceof Y.Map)) {
      rec = new Y.Map<unknown>();
      credentials.set(n.wrapId, rec);
      // Not an enrolment date: this route existed before this register did, and
      // saying "enrolled today" of a passkey set up last week would be a
      // plausible-looking falsehood of exactly the kind §6.1b is about.
      rec.set("enrolledAt", 0);
    }
    const map = rec as Y.Map<unknown>;
    const now = Date.now();
    map.set("lastOpenedAt", now);
    map.set("lastOpenedOn", describeThisClient());
    map.set("lastOpenedRoute", routeOf(n.attachment));
    // And kept, so the phone's use survives the Mac's next unlock.
    let openedBy = map.get("openedBy");
    if (!(openedBy instanceof Y.Map)) {
      openedBy = new Y.Map<unknown>();
      map.set("openedBy", openedBy);
    }
    (openedBy as Y.Map<unknown>).set(describeThisClient(), now);
    if (n.credentialId && !map.get("credentialId"))
      map.set("credentialId", n.credentialId);
    if (n.fingerprint && !map.get("fingerprint"))
      map.set("fingerprint", n.fingerprint);
  });
};

/**
 * How one saved route describes itself.
 *
 * Three states, and the middle one is why this list is worth having on an account
 * that predates it. A row the register saw enrolled. A row it knows only because that
 * route opened the journal, which is every route saved before 13 August 2026. And a
 * row it knows nothing about, which is the candidate for a passkey deleted from a
 * password manager with its wrap left behind (§6.1f).
 *
 * Exported for the tests, which are about the wording as much as the logic: the
 * difference between "not recognised" and "no longer works" is the difference between
 * this screen being useful and it being the half-truth §6.1b is the account of.
 */
export const describeRoute = (note: CredentialNote | null): string => {
  if (!note) return "Not recognised";
  // The provider, where the platform named it, because that is the half a person can
  // check against a password manager: the client says which app asked, and the
  // provider says where the passkey actually lives.
  const held = note.provider ? `, in ${note.provider}` : "";
  if (note.enrolledAt && note.enrolledOn)
    return note.enrolledRoute === "another device"
      ? `Set up from ${note.enrolledOn}, using another device${held}`
      : `Set up on ${note.enrolledOn}${held}`;
  if (note.lastOpenedOn) return `Last used on ${note.lastOpenedOn}${held}`;
  return "Not recognised";
};

/** Every note the register holds, newest enrolment last. */
export const listCredentialNotes = (): CredentialNote[] => {
  const out: CredentialNote[] = [];
  credentials.forEach((rec, wrapId) => {
    if (!(rec instanceof Y.Map)) return;
    out.push(toNote(wrapId, rec));
  });
  return out.sort(
    (a, b) => a.enrolledAt - b.enrolledAt || a.wrapId.localeCompare(b.wrapId)
  );
};

/**
 * Join the server's routes to what is known about them.
 *
 * The one-way-ness is the safety of it, and it is the same discipline as §6.1's
 * decrypt-against-what-you-expect: the rows come from `keeper_wraps`, and the notes
 * only decorate them. A note whose wrap is gone cannot hide anything, so it is
 * returned separately as a stray rather than dropped silently — usually the trace of
 * a route removed from another device, occasionally the first sign that something is
 * editing the register.
 */
export const reconcileRoutes = (
  wrapIds: readonly string[],
  notes: readonly CredentialNote[]
): { routes: RouteListing[]; strays: CredentialNote[] } => {
  const byId = new Map(notes.map((n) => [n.wrapId, n]));
  const routes = wrapIds.map((wrapId) => ({
    wrapId,
    note: byId.get(wrapId) ?? null,
  }));
  const live = new Set(wrapIds);
  const strays = notes.filter((n) => !live.has(n.wrapId));
  return { routes, strays };
};

/**
 * Drop a note, without touching any route.
 *
 * Only ever tidying, as `forgetDevice` is: the route is the row in `keeper_wraps`,
 * and removing one is a separate action in the store that goes to the server. A
 * screen must not let the two read as the same thing.
 */
export const forgetCredentialNote = (wrapId: string): boolean => {
  if (!credentials.has(wrapId)) return false;
  credentials.delete(wrapId);
  return true;
};

export const onCredentialsChange = (fn: () => void): (() => void) => {
  credentials.observeDeep(fn);
  return () => credentials.unobserveDeep(fn);
};
