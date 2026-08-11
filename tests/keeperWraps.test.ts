// Reading and writing keeper_wraps.
//
// The table is deliberately stupid (spec §6.5): an opaque id and ciphertext, so
// there is nothing to query on and nothing to filter by. That makes the
// interesting assertions negative ones — what this module refuses to do, and what
// it never sends.

import { beforeEach, describe, expect, test } from "vitest";
import {
  countKeeperWraps,
  listKeeperWraps,
  publishKeeperWrap,
} from "../src/store/keeperWraps";
import type { KeeperWrapJson } from "../src/lib/keeperWrap";

const USER = "11111111-1111-4111-8111-111111111111";

const aWrap = (n: number): KeeperWrapJson => ({
  v: 1,
  salt: `c2FsdA==${n}`,
  iv: "aXY=",
  blob: "YmxvYg==",
});

/* oxlint-disable unicorn/no-thenable */

type Row = Record<string, unknown>;
let rows: Row[] = [];
let writes: Row[] = [];
let selected: string | undefined;
let ordered: string | undefined;
let failing = false;

const client = {
  from(table: string) {
    if (table !== "keeper_wraps") throw new Error(`unexpected table ${table}`);
    return {
      insert(row: Row) {
        if (failing) return Promise.resolve({ error: { message: "refused" } });
        writes.push(row);
        rows.push(row);
        return Promise.resolve({ error: null });
      },
      select(cols: string, opts?: { count?: string; head?: boolean }) {
        selected = cols;
        const answer = failing
          ? { data: null, count: null, error: { message: "refused" } }
          : { data: rows, count: rows.length, error: null };
        if (opts?.head) return Promise.resolve(answer);
        return {
          order(col: string) {
            ordered = col;
            return Promise.resolve(answer);
          },
          then: (r: (v: unknown) => unknown) => Promise.resolve(answer).then(r),
        };
      },
    };
  },
} as unknown as Parameters<typeof listKeeperWraps>[0];

beforeEach(() => {
  rows = [];
  writes = [];
  selected = undefined;
  ordered = undefined;
  failing = false;
});

describe("adding a route in", () => {
  test("writes the id and the ciphertext, and nothing else", async () => {
    // §6.5 again, asserted at the boundary that actually talks to the server. A
    // credential id or a device label added here would be invisible to
    // schemaColumns.test.ts, since it checks the schema rather than the payload.
    await publishKeeperWrap(client, USER, "wrap-1", aWrap(1));

    expect(Object.keys(writes[0]).sort()).toEqual([
      "user_id",
      "wrap_id",
      "wrapped",
    ]);
  });

  test("two wraps of one key are two routes, not a conflict", async () => {
    // Insert rather than upsert. The table has no update policy, and merging two
    // routes into one would be the opposite of what §6.1e wants.
    await publishKeeperWrap(client, USER, "wrap-1", aWrap(1));
    await publishKeeperWrap(client, USER, "wrap-2", aWrap(2));

    expect(rows).toHaveLength(2);
  });

  test("a failure says what failed, in words that survive reaching a screen", async () => {
    failing = true;

    await expect(
      publishKeeperWrap(client, USER, "wrap-1", aWrap(1))
    ).rejects.toThrow(/passkey route/);
  });
});

describe("reading the routes", () => {
  test("oldest first, so the credential held longest is tried first", async () => {
    await publishKeeperWrap(client, USER, "wrap-1", aWrap(1));

    const out = await listKeeperWraps(client);

    expect(ordered).toBe("created_at");
    expect(out.map((r) => r.wrapId)).toEqual(["wrap-1"]);
  });

  test("asks for the id and the blob only", async () => {
    await listKeeperWraps(client);

    expect(selected).toBe("wrap_id, wrapped");
  });

  test("a malformed row is dropped rather than passed on", async () => {
    // A row missing its iv is a tampered or half-written row, not a credential
    // that failed to match. Left in the list it would be tried, fail to decrypt,
    // and be reported as an unrecognised passkey, which sends somebody looking at
    // the wrong problem entirely.
    rows.push({ wrap_id: "bad", wrapped: { v: 1, salt: "x", blob: "y" } });
    rows.push({ wrap_id: "worse", wrapped: null });
    await publishKeeperWrap(client, USER, "good", aWrap(1));

    const out = await listKeeperWraps(client);

    expect(out.map((r) => r.wrapId)).toEqual(["good"]);
  });

  test("an empty table is empty, not an error", async () => {
    await expect(listKeeperWraps(client)).resolves.toEqual([]);
  });
});

describe("counting them", () => {
  test("counts without fetching any ciphertext", async () => {
    // What a screen needs to decide whether to offer the biometric route at all.
    await publishKeeperWrap(client, USER, "wrap-1", aWrap(1));
    await publishKeeperWrap(client, USER, "wrap-2", aWrap(2));

    await expect(countKeeperWraps(client)).resolves.toBe(2);
  });

  test("zero on a fresh account", async () => {
    await expect(countKeeperWraps(client)).resolves.toBe(0);
  });
});
