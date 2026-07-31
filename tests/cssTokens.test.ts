// Every custom property referenced in the app has to actually exist.
//
// Written after shipping a card styled with var(--rule) and var(--warn), neither
// of which is defined anywhere. An unknown custom property makes the whole
// declaration invalid at computed-value time, so `border: 1px solid var(--rule)`
// does not fall back to a default border — it produces no border at all. The
// result compiled, linted, type-checked and passed every test, and was only
// caught by looking at a screenshot.
//
// Nothing else in the toolchain can catch this: TypeScript sees a string, oxlint
// sees a string, and the browser fails silently by design.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const files = walk(SRC).filter((f) => /\.(ts|tsx|css)$/.test(f));

/**
 * Names declared anywhere: the stylesheets, in any theme block, plus the ones set
 * as inline styles from React. `--grid` is only ever assigned in App.tsx, so
 * reading the CSS alone would report the app's own grid rhythm as undefined.
 */
const declared = new Set<string>(
  files.flatMap((f) => {
    const text = readFileSync(f, "utf8");
    const inCss = f.endsWith(".css")
      ? [...text.matchAll(/(--[\w-]+)\s*:/g)]
      : [];
    // ["--grid" as string]: `${GRID}px`
    const inTs = [...text.matchAll(/\[\s*"(--[\w-]+)"/g)];
    return [...inCss, ...inTs].map((m) => m[1]);
  })
);

/** Every name referenced through var(), with the file that reached for it. */
const referenced = files.flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => ({
    name: m[1],
    file: file.slice(SRC.length + 1),
  }))
);

describe("CSS custom properties", () => {
  test("the stylesheet declares some, so this test is looking at the right files", () => {
    // Guards the test itself. If the walk or the regex broke, `declared` would be
    // empty and every assertion below would pass by vacuum.
    expect(declared.size).toBeGreaterThan(10);
    expect(declared.has("--ink")).toBe(true);
  });

  test("references are found, in components as well as stylesheets", () => {
    expect(referenced.length).toBeGreaterThan(20);
    expect(referenced.some((r) => r.file.endsWith(".tsx"))).toBe(true);
  });

  test("every referenced property is declared", () => {
    const missing = referenced
      .filter((r) => !declared.has(r.name))
      .map((r) => `${r.name} in ${r.file}`);

    // Listed rather than counted: the point of failing is to name the file.
    expect([...new Set(missing)]).toEqual([]);
  });
});
