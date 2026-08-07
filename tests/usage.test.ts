// Reading the server's own record of how full an account is.
//
// Every failure here has to be silent and produce null, because the only caller
// is a readout on the Menu and a missing number must never be the reason the
// Menu fails to render. The case that matters most is a project where
// schema.sql has not been applied: public.user_usage does not exist, the read
// errors, and the app has to carry on as it did before the table was invented.

import { beforeEach, describe, expect, test, vi } from "vitest";

let response: { data: unknown; error: unknown } = { data: null, error: null };
let selected = "";

vi.mock("../src/store/sync", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        selected = cols;
        return { maybeSingle: async () => response };
      },
    }),
  },
}));

const { serverUsage } = await import("../src/store/usage");

beforeEach(() => {
  response = { data: null, error: null };
  selected = "";
});

describe("what it reads", () => {
  test("both columns, and nothing else", async () => {
    response = { data: { bytes: 1, quota_bytes: 2 }, error: null };
    await serverUsage();
    expect(selected).toBe("bytes,quota_bytes");
  });

  test("numbers come back as numbers", async () => {
    response = { data: { bytes: 125780, quota_bytes: 20971520 }, error: null };
    expect(await serverUsage()).toEqual({ bytes: 125780, quota: 20971520 });
  });

  test("a bigint arriving as a string is still a number", async () => {
    // PostgREST may hand back bigint as text depending on the driver, and a
    // string here would render as "125780 of 20971520 on the server" with the
    // formatting silently skipped.
    response = { data: { bytes: "125780", quota_bytes: "20971520" }, error: null };
    expect(await serverUsage()).toEqual({ bytes: 125780, quota: 20971520 });
  });
});

describe("everything that must produce null instead of throwing", () => {
  test("the table does not exist, because schema.sql has not been applied", async () => {
    response = {
      data: null,
      error: { message: 'relation "public.user_usage" does not exist' },
    };
    expect(await serverUsage()).toBeNull();
  });

  test("no row yet, because nothing has been pushed", async () => {
    response = { data: null, error: null };
    expect(await serverUsage()).toBeNull();
  });

  test("unparseable values", async () => {
    response = { data: { bytes: "nonsense", quota_bytes: 1 }, error: null };
    expect(await serverUsage()).toBeNull();
  });

  test("a zero or negative quota, which would divide badly downstream", async () => {
    response = { data: { bytes: 10, quota_bytes: 0 }, error: null };
    expect(await serverUsage()).toBeNull();
  });
});
