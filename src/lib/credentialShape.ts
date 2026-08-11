// Telling the two credentials apart, so a box can say which one it was given.
//
// Onboarding hands out two things a few minutes apart and asks for both in a
// text field: the 6-digit sign-in code from the email, and the journal key
// (J1-XXXX-XXXX-…, see lib/crypto.ts). Gary's wife used the journal key to sign
// in, which is the obvious mistake to make — the journal key is the one she had
// just been made to save behind a gate, so it is the credential in her head,
// while the sign-in code is off in an email she has to go and find.
//
// Naming was not the problem and better labels will not fix it. The fields
// already say "Sign-in code from the email" and "Journal key", with 123456 and
// J1-XXXX-XXXX-… as placeholders. What was missing was any response at the
// moment of the mistake: pasting a journal key into the sign-in box cleared the
// only guard there (length >= 6), went to the server and came back with a
// generic rejection, while typing a sign-in code into the journal key box left
// its button greyed out with nothing said at all — a disabled control with no
// stated reason, which is the §4.1 no-guessing rule broken from the other side.
//
// So: recognise the shape, name what it is, and say where the right one lives.
// Both checks are deliberately narrow. A false positive here is worse than a
// false negative, because it refuses a credential that would have worked.

/** Everything the two formats have in common: spaces and hyphens are noise. */
const strip = (value: string): string =>
  value.trim().replace(/[\s-]/g, "").toUpperCase();

/**
 * Does this look like a journal key rather than a sign-in code?
 *
 * The J1 prefix is the reliable signal and is checked first. The length
 * fallback catches a key pasted without its prefix: Crockford base32 in groups
 * of four is never as short as twelve characters' worth of sign-in code, and
 * Supabase codes are numeric and at most ten digits even if the length is
 * raised from the default six. So twelve is clear of both.
 */
/**
 * Unambiguously a journal key code, rather than merely resembling one.
 *
 * The J1 prefix and nothing looser, because this one decides whether a field is
 * read as a key at all. looksLikeJournalKey below is deliberately generous, since
 * its job is to notice a likely mistake and say something; anything that generous
 * here would read an email address as a key, an email address being comfortably
 * longer than twelve characters.
 *
 * Agrees with importJournalKeyCode, which refuses anything without the prefix, so
 * a field armed by this cannot then fail to parse for want of one.
 */
export const isJournalKeyCode = (value: string): boolean =>
  strip(value).startsWith("J1");

export const looksLikeJournalKey = (value: string): boolean => {
  const s = strip(value);
  if (!s) return false;
  if (s.startsWith("J1")) return true;
  return s.length >= 12;
};

/**
 * Does this look like the emailed sign-in code rather than a journal key?
 *
 * Exactly six digits and nothing else. Not "starts with digits" and not a
 * length range: a journal key can begin with digits (base32 includes 0-9), so
 * anything looser would refuse real keys, and refusing a real key is the one
 * outcome worth avoiding here.
 */
export const looksLikeSignInCode = (value: string): boolean =>
  /^\d{6}$/.test(value.trim().replace(/\s/g, ""));
