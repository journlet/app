// The two onboarding credentials get mistaken for each other, so these pin the
// recognition in both directions — and, more importantly, pin that it never
// refuses something real. A false positive here rejects a credential that would
// have worked, which is worse than saying nothing at all.

import { describe, expect, test } from "vitest";
import {
  isJournalKeyCode,
  looksLikeJournalKey,
  looksLikeSignInCode,
} from "../src/lib/credentialShape";

describe("recognising a journal key in the sign-in code box", () => {
  test("the prefix is enough, in any case or spacing", () => {
    expect(looksLikeJournalKey("J1-ABCD-EFGH-JKMN")).toBe(true);
    expect(looksLikeJournalKey("j1-abcd-efgh-jkmn")).toBe(true);
    expect(looksLikeJournalKey("  J1-ABCD-EFGH  ")).toBe(true);
    expect(looksLikeJournalKey("J1 ABCD EFGH")).toBe(true);
  });

  test("a key pasted without its prefix is still caught by length", () => {
    // Someone copying out of a note can easily lose the J1-, and the result is
    // still nothing like a sign-in code.
    expect(looksLikeJournalKey("ABCD-EFGH-JKMN-PQRS")).toBe(true);
  });

  test("a sign-in code is never mistaken for a key", () => {
    // The whole point. Six digits must pass through untouched, including ones
    // that happen to start with a 1.
    expect(looksLikeJournalKey("123456")).toBe(false);
    expect(looksLikeJournalKey("000000")).toBe(false);
    expect(looksLikeJournalKey("100000")).toBe(false);
    expect(looksLikeJournalKey(" 123456 ")).toBe(false);
  });

  test("a longer numeric code still passes, in case the length is raised", () => {
    // Supabase's code length is configurable above the default six. A ten-digit
    // code must not be read as a key, which is why the fallback starts at twelve.
    expect(looksLikeJournalKey("1234567890")).toBe(false);
  });

  test("an empty or partial entry says nothing", () => {
    // Correcting someone mid-keystroke would flash an accusation at every
    // person typing normally.
    expect(looksLikeJournalKey("")).toBe(false);
    expect(looksLikeJournalKey("   ")).toBe(false);
    expect(looksLikeJournalKey("1")).toBe(false);
    expect(looksLikeJournalKey("J")).toBe(false);
  });
});

describe("recognising a sign-in code in the journal key box", () => {
  test("exactly six digits, and nothing else", () => {
    expect(looksLikeSignInCode("123456")).toBe(true);
    expect(looksLikeSignInCode(" 123456 ")).toBe(true);
    expect(looksLikeSignInCode("123 456")).toBe(true);
  });

  test("a real journal key is never called a sign-in code", () => {
    expect(looksLikeSignInCode("J1-ABCD-EFGH-JKMN")).toBe(false);
    // Base32 includes the digits, so a key can open with six of them. Anything
    // looser than an exact match would refuse this.
    expect(looksLikeSignInCode("123456-ABCD-EFGH")).toBe(false);
    expect(looksLikeSignInCode("1234567890ABCD")).toBe(false);
  });

  test("the wrong number of digits is left alone", () => {
    // Five digits is someone still typing; seven is a typo they can see.
    // Neither is the mix-up this exists to name.
    expect(looksLikeSignInCode("12345")).toBe(false);
    expect(looksLikeSignInCode("1234567")).toBe(false);
    expect(looksLikeSignInCode("")).toBe(false);
  });
});

// isJournalKeyCode decides whether a field is read as a key at all, so it has to
// be narrow where looksLikeJournalKey is generous (assessment Finding 24). The
// delete confirmation box takes either an email address or a code, and reading
// one as the other is the failure that matters here.
describe("isJournalKeyCode", () => {
  test("accepts a real code, formatted or not", () => {
    expect(isJournalKeyCode("J1-ABCD-EFGH-JKMN-PQRS")).toBe(true);
    expect(isJournalKeyCode("j1abcdefghjkmnpqrs")).toBe(true);
    expect(isJournalKeyCode("  J1-ABCD-EFGH  ")).toBe(true);
  });

  test("refuses an email address, which looksLikeJournalKey does not", () => {
    // The whole reason for a second predicate. Any address is longer than the
    // twelve characters that satisfies the generous one.
    expect(isJournalKeyCode("gary@example.com")).toBe(false);
    expect(looksLikeJournalKey("gary@example.com")).toBe(true);
  });

  test("refuses a sign-in code and an empty field", () => {
    expect(isJournalKeyCode("123456")).toBe(false);
    expect(isJournalKeyCode("")).toBe(false);
    expect(isJournalKeyCode("   ")).toBe(false);
  });

  test("agrees with importJournalKeyCode about the prefix", () => {
    // A field armed by this must not then fail to parse for want of a prefix.
    expect(isJournalKeyCode("ABCD-EFGH-JKMN-PQRS")).toBe(false);
  });
});
