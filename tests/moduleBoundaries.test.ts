// What may import the sync engine, and what may not.
//
// Importing a name from a module evaluates the whole module. store/sync.ts is
// eighteen hundred lines that, on evaluation, construct a Supabase client and
// register the live-edit listener that pushes local writes to the server. So an
// import of it is not a reference to a type or a client: it is a decision to start
// the engine, and every module that made that decision by accident paid for it.
//
// store/usage.ts did. Thirty lines reading one row to say how full an account is,
// importing `supabase` from the engine, so tests/usage.test.ts had to stub the
// whole engine to ask a question about a storage readout. Four modules type-imported
// `SyncStatus` from there as well, when store/syncStatus.ts is where that type lives
// and the value it describes is owned.
//
// These tests are static on purpose. The property worth keeping is a shape of the
// import graph, and a runtime check would have to reach into Yjs's observer
// internals to see the listener that proves it. Same approach as
// tests/storageKeys.test.ts and tests/cssTokens.test.ts: read the source, because
// nothing else in the toolchain can see this going wrong.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : []
  );

const files = sourceFiles(SRC).map((path) => ({
  name: path.slice(SRC.length + 1),
  text: readFileSync(path, "utf8"),
}));

/** Every module this one imports from, by its specifier. */
const importsOf = (text: string): string[] =>
  [...text.matchAll(/^import[^"']*from\s+["']([^"']+)["'];/gm)].map((m) => m[1]);

describe("the Supabase client", () => {
  test("is constructed in exactly one place", () => {
    const constructors = files.filter((f) => /\bcreateClient\s*\(/.test(f.text));
    expect(constructors.map((f) => f.name)).toEqual(["store/supabaseClient.ts"]);
  });

  test("is reached without evaluating the sync engine", () => {
    // store/supabaseClient.ts must stay inert: it constructs a client and does
    // nothing else, so importing it cannot start anything.
    const client = files.find((f) => f.name === "store/supabaseClient.ts")!;
    expect(importsOf(client.text)).not.toContain("./sync");
  });

  test("is not read from the sync engine by anything but the engine itself", () => {
    // store/sync.ts re-exports it for the callers and tests that already read it
    // from there, which is compatibility rather than an invitation. A new caller
    // should import store/supabaseClient.ts and start nothing.
    const offenders = files.filter(
      (f) =>
        f.name !== "store/sync.ts" &&
        /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*["'][^"']*\/sync["']/.test(
          f.text
        )
    );
    expect(offenders.map((f) => f.name)).toEqual([]);
  });
});

describe("the sync status type", () => {
  test("is imported from the module that owns it, not from the engine", () => {
    // A type import costs nothing at runtime, but it is the line a reader follows
    // to find out where a thing lives, and it pointed at the wrong file.
    const offenders = files.filter(
      (f) =>
        /import\s+type\s*\{[^}]*\bSyncStatus\b[^}]*\}\s*from\s*["'][^"']*\/sync["']/.test(
          f.text
        )
    );
    expect(offenders.map((f) => f.name)).toEqual([]);
  });
});

describe("the storage readout", () => {
  test("does not import the sync engine at all", () => {
    // The module this whole file was written for.
    const usage = files.find((f) => f.name === "store/usage.ts")!;
    expect(importsOf(usage.text)).not.toContain("./sync");
  });
});
