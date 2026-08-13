// @vitest-environment jsdom
//
// The credential register (§6.1l, 13 August 2026). Two properties matter more than
// the fields: the list may never hide a saved route, because a route the screen does
// not draw is a route nobody can remove, and it must not claim to know things it does
// not — a row invented by an unlock has no enrolment date, and saying "set up today"
// of a passkey saved last week is the kind of plausible falsehood §6.1b is about.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";

let doc = new Y.Doc();

vi.mock("../src/store/journal", () => ({
  get doc() {
    return doc;
  },
  get credentials() {
    return doc.getMap("credentials");
  },
  REMOTE_ORIGIN: "remote",
}));

vi.mock("../src/store/devices", () => ({
  describeThisClient: () => "Chrome (macOS)",
}));

const load = async () => {
  vi.resetModules();
  return import("../src/store/credentials");
};

beforeEach(() => {
  doc = new Y.Doc();
});

describe("recording an enrolment", () => {
  test("keeps the client, the route and both measurements", async () => {
    const c = await load();
    c.noteEnrolment({
      wrapId: "w1",
      credentialId: "36b1d31fe3a6xyz",
      fingerprint: "D9C7D9C5",
      attachment: "platform",
    });

    const [note] = c.listCredentialNotes();
    expect(note.wrapId).toBe("w1");
    expect(note.enrolledOn).toBe("Chrome (macOS)");
    expect(note.enrolledRoute).toBe("this device");
    expect(note.credentialId).toBe("36b1d31fe3a6xyz");
    expect(note.fingerprint).toBe("D9C7D9C5");
    expect(note.enrolledAt).toBeGreaterThan(0);
  });

  test("an answer from another device is recorded as one", async () => {
    const c = await load();
    // §6.1k: the tunnel does not carry PRF faithfully for every password manager, so
    // the route a wrap was written over is part of what the wrap is.
    c.noteEnrolment({ wrapId: "w1", attachment: "cross-platform" });
    expect(c.listCredentialNotes()[0].enrolledRoute).toBe("another device");
  });

  test("an unreported attachment counts as another device", async () => {
    const c = await load();
    // Matches store/sync.ts, where guessing the other way would delete a working
    // passkey from somebody's password manager.
    c.noteEnrolment({ wrapId: "w1", attachment: null });
    expect(c.listCredentialNotes()[0].enrolledRoute).toBe("another device");
  });
});

describe("recording an unlock", () => {
  test("fills in a route the register never saw, without inventing a setup date", async () => {
    const c = await load();
    c.noteUnlock({
      wrapId: "old",
      credentialId: "abc",
      fingerprint: "D1B3CB5C",
      attachment: "cross-platform",
    });

    const [note] = c.listCredentialNotes();
    expect(note.wrapId).toBe("old");
    expect(note.enrolledAt).toBe(0);
    expect(note.lastOpenedAt).toBeGreaterThan(0);
    expect(note.lastOpenedRoute).toBe("another device");
    expect(note.credentialId).toBe("abc");
  });

  test("does not overwrite what the enrolment recorded", async () => {
    const c = await load();
    c.noteEnrolment({
      wrapId: "w1",
      credentialId: "enrolled-id",
      fingerprint: "AAAAAAAA",
      attachment: "platform",
    });
    const enrolledAt = c.listCredentialNotes()[0].enrolledAt;

    // The same credential reached over the tunnel derives a different secret, so an
    // unlock elsewhere must not overwrite the fingerprint the wrap was written with.
    c.noteUnlock({
      wrapId: "w1",
      credentialId: "other-id",
      fingerprint: "BBBBBBBB",
      attachment: "cross-platform",
    });

    const [note] = c.listCredentialNotes();
    expect(note.credentialId).toBe("enrolled-id");
    expect(note.fingerprint).toBe("AAAAAAAA");
    expect(note.enrolledAt).toBe(enrolledAt);
    expect(note.lastOpenedRoute).toBe("another device");
  });
});

describe("joining the register to the server's rows", () => {
  test("a route with no note is still listed", async () => {
    const c = await load();
    c.noteEnrolment({ wrapId: "known", attachment: "platform" });

    const { routes, strays } = c.reconcileRoutes(
      ["known", "unknown"],
      c.listCredentialNotes()
    );
    expect(routes.map((r) => r.wrapId)).toEqual(["known", "unknown"]);
    expect(routes[1].note).toBeNull();
    expect(strays).toHaveLength(0);
  });

  test("a note whose route has gone is reported rather than dropped", async () => {
    const c = await load();
    c.noteEnrolment({ wrapId: "gone", attachment: "platform" });

    const { routes, strays } = c.reconcileRoutes([], c.listCredentialNotes());
    expect(routes).toHaveLength(0);
    expect(strays.map((s) => s.wrapId)).toEqual(["gone"]);
  });

  test("the server's order is the list's order", async () => {
    const c = await load();
    // The rows arrive oldest first from keeper_wraps, and the screen offers removal
    // against them, so the order must come from the rows rather than from the notes.
    const { routes } = c.reconcileRoutes(["c", "a", "b"], []);
    expect(routes.map((r) => r.wrapId)).toEqual(["c", "a", "b"]);
  });
});

describe("forgetting a note", () => {
  test("drops the note and nothing else", async () => {
    const c = await load();
    c.noteEnrolment({ wrapId: "w1", attachment: "platform" });

    expect(c.forgetCredentialNote("w1")).toBe(true);
    expect(c.listCredentialNotes()).toHaveLength(0);
    // The route itself is a row in keeper_wraps, which this cannot reach: a wrap with
    // no note reappears as an unlabelled route, which is the safe direction.
    expect(c.reconcileRoutes(["w1"], c.listCredentialNotes()).routes).toEqual([
      { wrapId: "w1", note: null },
    ]);
  });

  test("forgetting something that is not there says so", async () => {
    const c = await load();
    expect(c.forgetCredentialNote("nope")).toBe(false);
  });
});

describe("how a row describes itself", () => {
  test("an enrolled row names where it was set up", async () => {
    const c = await load();
    c.noteEnrolment({ wrapId: "w1", attachment: "platform" });
    expect(c.describeRoute(c.listCredentialNotes()[0])).toBe(
      "Set up on Chrome (macOS)"
    );
  });

  test("a row enrolled over the tunnel says which way", async () => {
    const c = await load();
    c.noteEnrolment({ wrapId: "w1", attachment: "cross-platform" });
    expect(c.describeRoute(c.listCredentialNotes()[0])).toBe(
      "Set up from Chrome (macOS), using another device"
    );
  });

  test("a row known only from an unlock says that instead", async () => {
    const c = await load();
    c.noteUnlock({ wrapId: "old", attachment: "platform" });
    expect(c.describeRoute(c.listCredentialNotes()[0])).toBe(
      "Last used on Chrome (macOS)"
    );
  });

  test("a route with no note is not recognised, and is not called dead", async () => {
    const c = await load();
    // The wording is the point. "Not recognised" is true; anything stronger would
    // claim the route does not work, which nothing here can know (§6.1f).
    expect(c.describeRoute(null)).toBe("Not recognised");
  });
});
