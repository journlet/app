// The build-time CSP substitution (build/csp.ts) and the policy it edits
// (index.html). Assessment Finding 20: the Supabase host was written out both
// in the policy and in src/lib/supabaseConfig.ts, and changing one without the
// other broke sync silently, because the policy refuses the request before
// Supabase sees it and there is no server error for the banner to report.
//
// Two different things are checked here. That the substitution behaves, and
// that the policy in the repository still has something to substitute — the
// second is the one that fails if somebody writes a host back into the markup.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  ORIGINS_PLACEHOLDER,
  injectSupabaseOrigins,
  supabaseOrigins,
} from "../build/csp.ts";
import { SUPABASE_URL } from "../src/lib/supabaseConfig.ts";

const indexHtml = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8"
);

/** The connect-src directive as it stands in the shipped markup. */
const connectSrc = (html: string): string => {
  const meta = /content="([^"]*Content-Security|[^"]*default-src[^"]*)"/.exec(
    html
  );
  const policy = meta?.[1] ?? "";
  const found = policy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("connect-src"));
  return found ?? "";
};

describe("the policy in index.html", () => {
  test("names no host of its own: the origins are a placeholder", () => {
    // This is the regression test for Finding 20. Writing the project host
    // back into the markup fails here, and it fails with the reason attached.
    expect(connectSrc(indexHtml)).toBe(`connect-src 'self' ${ORIGINS_PLACEHOLDER}`);
  });

  test("carries the placeholder exactly once", () => {
    expect(indexHtml.split(ORIGINS_PLACEHOLDER)).toHaveLength(2);
  });

  test("substituting it yields the configured project, over both protocols", () => {
    const { host } = new URL(SUPABASE_URL);
    expect(connectSrc(injectSupabaseOrigins(indexHtml, SUPABASE_URL))).toBe(
      `connect-src 'self' https://${host} wss://${host}`
    );
  });

  test("nothing else in the policy moves", () => {
    const before = indexHtml.replace(ORIGINS_PLACEHOLDER, "X");
    const after = injectSupabaseOrigins(indexHtml, "https://x.example.co")
      .replace("https://x.example.co wss://x.example.co", "X");
    expect(after).toBe(before);
  });
});

describe("supabaseOrigins", () => {
  test("derives the REST and realtime origins from one URL", () => {
    expect(supabaseOrigins("https://abc.supabase.co")).toEqual([
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
    ]);
  });

  test("keeps a non-default port, which a self-hosted project needs", () => {
    expect(supabaseOrigins("https://sb.example.com:8443")).toEqual([
      "https://sb.example.com:8443",
      "wss://sb.example.com:8443",
    ]);
  });

  test("ignores a path, because a CSP source is an origin", () => {
    expect(supabaseOrigins("https://abc.supabase.co/rest/v1/")).toEqual([
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
    ]);
  });

  test("no URL means no external origin at all", () => {
    // supabaseConfig.ts documents empty as local-only with sync disabled. The
    // right policy then is 'self' and nothing else, not a broken one.
    expect(supabaseOrigins("")).toEqual([]);
    expect(supabaseOrigins("   ")).toEqual([]);
  });

  test("refuses http, which would let the ciphertext travel in clear", () => {
    expect(() => supabaseOrigins("http://abc.supabase.co")).toThrow(/https/);
  });

  test("refuses something that is not a URL", () => {
    expect(() => supabaseOrigins("abc.supabase.co")).toThrow(/not a URL/);
  });
});

describe("injectSupabaseOrigins", () => {
  test("throws when the placeholder has gone, rather than passing html through", () => {
    // A silent no-op would ship 'self' alone and reproduce the finding while
    // looking like the fix, which is exactly how the original was invisible.
    expect(() =>
      injectSupabaseOrigins(`<meta content="connect-src 'self'" />`, SUPABASE_URL)
    ).toThrow(/not found in index.html/);
  });

  test("leaves a readable policy when sync is switched off", () => {
    const out = injectSupabaseOrigins(indexHtml, "");
    expect(connectSrc(out)).toBe("connect-src 'self'");
    expect(out).not.toContain("'self' ;");
  });
});
