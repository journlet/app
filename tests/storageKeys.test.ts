// @vitest-environment jsdom
//
// The erase has to enumerate what this device wrote, not remember it.
//
// `wipeThisDevice` removed one localStorage key by hand while eighteen others
// accumulated around it, one of them the keeper key in plaintext. These tests
// pin the two properties that stop that recurring: every key is declared in one
// registry, and the erase takes every key the registry says it should.
//
// The third test is the load-bearing one. It fails on a `localStorage` call
// anywhere in src/ that passes a string literal, which is how a nineteenth key
// would arrive undeclared, and it is the only assertion here that a new key
// cannot pass without somebody having made the erase decision.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import {
  STORAGE_KEYS,
  PENDING_JOURNAL_KEY,
  DEVICE_ID_KEY,
  THEME_KEY,
  wipeDeviceStorage,
} from "../src/lib/storageKeys";

// Same shape as tests/cssTokens.test.ts, which scans src/ for the same reason:
// nothing else in the toolchain can see a string literal going astray.
const SRC = join(import.meta.dirname, "..", "src");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : []
  );

beforeEach(() => localStorage.clear());

describe("the storage key registry", () => {
  test("classifies every key with a reason", () => {
    // An entry with no `why` is an entry whose erase decision was never taken,
    // which is the state the whole file exists to make impossible.
    for (const entry of STORAGE_KEYS) {
      expect(entry.why.length, entry.key).toBeGreaterThan(20);
      expect(["remove", "keep"]).toContain(entry.erase);
    }
  });

  test("holds no duplicate key", () => {
    const keys = STORAGE_KEYS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("names only keys the application actually uses", () => {
    // A stale entry is worse than no entry: it makes the inventory look complete
    // while describing a key nothing writes. Each key's exported constant is read
    // out of the registry itself rather than derived from the key, so renaming a
    // constant cannot quietly orphan its entry.
    const registry = readFileSync(join(SRC, "lib", "storageKeys.ts"), "utf8");
    const constFor = new Map<string, string>(
      [...registry.matchAll(/export const (\w+) = "(journlet-[^"]+)";/g)].map(
        (m) => [m[2], m[1]]
      )
    );
    const elsewhere = sourceFiles(SRC)
      .filter((f) => !f.endsWith("storageKeys.ts"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const entry of STORAGE_KEYS) {
      const name = constFor.get(entry.key);
      expect(name, `${entry.key} has no exported constant`).toBeTruthy();
      expect(
        new RegExp(`\\b${name}\\b`).test(elsewhere),
        `${name} (${entry.key}) is imported by nothing in src/`
      ).toBe(true);
    }
  });
});

describe("no undeclared storage key", () => {
  test("no localStorage call in src passes a string literal", () => {
    // The enforcement. Every key must arrive as an identifier imported from the
    // registry, because a literal is a key nobody classified and the erase
    // cannot enumerate what it was never told about.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith("storageKeys.ts")) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/localStorage\.(get|set|remove)Item\(\s*["'`]/.test(line))
            offenders.push(`${file.slice(SRC.length + 1)}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("erasing this device", () => {
  test("removes the pending keeper key", () => {
    // The leak. A scanned QR link leaves the master key that opens the journal
    // in localStorage for thirty minutes, and signing out inside that window
    // used to leave it there on a device meant to hold nothing.
    localStorage.setItem(PENDING_JOURNAL_KEY, JSON.stringify({ k: "J1-…", t: 1 }));

    wipeDeviceStorage();

    expect(localStorage.getItem(PENDING_JOURNAL_KEY)).toBeNull();
  });

  test("removes every key classified `remove`", () => {
    for (const entry of STORAGE_KEYS) localStorage.setItem(entry.key, "x");

    wipeDeviceStorage();

    const left = STORAGE_KEYS.filter(
      (e) => e.erase === "remove" && localStorage.getItem(e.key) !== null
    ).map((e) => e.key);
    expect(left).toEqual([]);
  });

  test("keeps every key classified `keep`", () => {
    // The other half of the contract. "Wiped" cannot come to mean two things
    // (spec §6.1j), and losing the theme on a borrowed laptop is the second one.
    for (const entry of STORAGE_KEYS) localStorage.setItem(entry.key, "x");

    wipeDeviceStorage();

    const gone = STORAGE_KEYS.filter(
      (e) => e.erase === "keep" && localStorage.getItem(e.key) === null
    ).map((e) => e.key);
    expect(gone).toEqual([]);
  });

  test("keeps this device's register handle", () => {
    // Named rather than left to the loop above, because it is the one `keep`
    // that is required rather than merely harmless: a device that forgot its
    // handle would create a second register row on signing back in and leave
    // its own signed-out row standing (see tests/signOutMark.test.ts).
    localStorage.setItem(DEVICE_ID_KEY, "phone");

    wipeDeviceStorage();

    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe("phone");
  });

  test("survives storage that throws", () => {
    // A wipe must not fail on storage quirks, and one key throwing must not
    // stop the credential material from going, which is why the loop catches
    // per key rather than around itself.
    localStorage.setItem(PENDING_JOURNAL_KEY, "secret");
    const real = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (key === THEME_KEY) throw new Error("quota");
      return real.call(this, key);
    };
    try {
      expect(() => wipeDeviceStorage()).not.toThrow();
      expect(localStorage.getItem(PENDING_JOURNAL_KEY)).toBeNull();
    } finally {
      Storage.prototype.removeItem = real;
    }
  });
});
