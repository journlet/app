// @vitest-environment jsdom
//
// The device register (decision 28 Jul). Two properties matter more than the
// list itself: it must not become a source of churn in the append-only log —
// §6.1a is a long account of what that costs — and it must never quietly drop a
// row, because an unfamiliar entry is the only thing the register is for.

import { beforeEach, describe, expect, test, vi } from "vitest";
import * as Y from "yjs";

let doc = new Y.Doc();

vi.mock("../src/store/journal", () => ({
  get doc() {
    return doc;
  },
  get devices() {
    return doc.getMap("devices");
  },
  REMOTE_ORIGIN: "remote",
  wipeLocalJournal: async () => {},
}));

const load = async () => {
  vi.resetModules();
  return import("../src/store/devices");
};

beforeEach(() => {
  doc = new Y.Doc();
  localStorage.clear();
});

describe("registering a device", () => {
  test("adds one row for this device", async () => {
    const d = await load();
    d.touchThisDevice();

    const list = d.listDevices();
    expect(list).toHaveLength(1);
    expect(list[0].isThisDevice).toBe(true);
    expect(list[0].firstSeen).toBeGreaterThan(0);
  });

  test("names the row after the client and platform, not just the device", async () => {
    const d = await load();
    d.touchThisDevice();

    // jsdom matches no browser or platform, so both fall back, which still
    // proves the shape.
    expect(d.listDevices()[0].client).toBe("Browser (unknown platform)");
    expect(d.listDevices()[0].renamed).toBe(false);
  });

  test("a second client on the same copy is added, not substituted", async () => {
    // The reported bug: on macOS the installed app and the browser share one
    // storage container, so they are one row, and they took turns overwriting a
    // single client field. The row's description changed depending on which one
    // had been opened last, and every switch wrote to the append-only log.
    const d = await load();
    d.touchThisDevice();
    const rec = doc.getMap<Y.Map<unknown>>("devices").get(d.thisDeviceId());
    const clients = rec?.get("clients") as Y.Map<unknown>;
    // As the installed app opening the same container would.
    clients.set("Installed app", Date.now() + 1);

    const row = d.listDevices()[0];
    expect(row.client).toContain("Installed app");
    expect(row.client).toContain("Browser");
    expect(row.client).toContain("(unknown platform)");
  });

  test("lists the most recently used client first", async () => {
    // The one you are looking at should lead, or the row reads as though it
    // belongs to something else.
    const d = await load();
    d.touchThisDevice();
    const rec = doc.getMap<Y.Map<unknown>>("devices").get(d.thisDeviceId());
    const clients = rec?.get("clients") as Y.Map<unknown>;
    clients.set("Installed app", Date.now() + 5000);

    expect(d.listDevices()[0].client).toMatch(/^Installed app and Browser/);
  });

  test("re-opening a known client does not write again", async () => {
    // Switching between the app and the browser several times a day would
    // otherwise be a row in the log each time.
    const d = await load();
    d.touchThisDevice();
    const updates: number[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u.length));

    d.touchThisDevice();
    d.touchThisDevice();

    expect(updates).toEqual([]);
  });

  test("still reads sensibly with a single client", async () => {
    const d = await load();
    d.touchThisDevice();

    expect(d.listDevices()[0].client).toBe("Browser (unknown platform)");
  });

  test("a renamed row keeps the detected client alongside the name", async () => {
    const d = await load();
    d.touchThisDevice();

    d.renameDevice(d.thisDeviceId(), "work laptop");

    const row = d.listDevices()[0];
    expect(row.label).toBe("work laptop");
    expect(row.client).toBe("Browser (unknown platform)");
    expect(row.renamed).toBe(true);
  });

  test("a row written before clients were recorded still reads sensibly", async () => {
    // Rows from the first version of the register have only a label.
    const d = await load();
    const old = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("legacy", old);
    old.set("id", "legacy");
    old.set("label", "Mac");

    const row = d.listDevices().find((r) => r.id === "legacy");
    expect(row?.label).toBe("Mac");
    expect(row?.client).toBe("Mac");
  });

  test("a row from the single-client version keeps working", async () => {
    // The intermediate format: one `client` string rather than a set.
    const d = await load();
    const mid = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("mid", mid);
    mid.set("id", "mid");
    mid.set("client", "Chrome (macOS)");

    const row = d.listDevices().find((r) => r.id === "mid");
    expect(row?.client).toBe("Chrome (macOS)");
    expect(row?.label).toBe("Chrome (macOS)");
  });

  test("repeated connects do not write again", async () => {
    // Every write here becomes a row in the append-only log. A device syncing
    // several times an hour would otherwise generate more register traffic than
    // journal content — the exact failure §6.1a documents.
    const d = await load();
    d.touchThisDevice();
    const updates: number[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u.length));

    d.touchThisDevice();
    d.touchThisDevice();
    d.touchThisDevice();

    expect(updates).toEqual([]);
  });

  test("refreshes last-seen once the interval has passed", async () => {
    const d = await load();
    d.touchThisDevice();
    const id = d.thisDeviceId();
    const rec = doc.getMap<Y.Map<unknown>>("devices").get(id);
    // Backdate beyond the hour rather than waiting for it.
    rec?.set("lastSeen", Date.now() - 2 * 60 * 60 * 1000);

    d.touchThisDevice();

    const seen = d.listDevices()[0].lastSeen;
    expect(Date.now() - seen).toBeLessThan(5000);
  });

  test("the id survives a reload, so one device stays one row", async () => {
    const first = await load();
    first.touchThisDevice();
    const id = first.thisDeviceId();

    const second = await load(); // fresh module, same localStorage
    second.touchThisDevice();

    expect(second.thisDeviceId()).toBe(id);
    expect(second.listDevices()).toHaveLength(1);
  });

  test("another device's row is kept, and shown as not this device", async () => {
    const d = await load();
    d.touchThisDevice();
    const other = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("other-id", other);
    other.set("id", "other-id");
    other.set("label", "iPhone");
    other.set("lastSeen", Date.now() - 60_000);

    const list = d.listDevices();
    expect(list).toHaveLength(2);
    expect(list[0].isThisDevice).toBe(true); // this device sorts first
    expect(list[1].label).toBe("iPhone");
    expect(list[1].isThisDevice).toBe(false);
  });

  test("nothing removes a stale row on its own", async () => {
    // A device that stopped syncing months ago is precisely what someone wants
    // to see. Ageing rows out would erase the signal the list exists to give.
    const d = await load();
    const old = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("ancient", old);
    old.set("id", "ancient");
    old.set("label", "Old laptop");
    old.set("lastSeen", Date.now() - 400 * 24 * 60 * 60 * 1000);

    d.touchThisDevice();

    expect(d.listDevices().map((r) => r.id)).toContain("ancient");
  });
});

describe("editing the register", () => {
  test("renaming keeps the same row", async () => {
    const d = await load();
    d.touchThisDevice();
    d.renameDevice(d.thisDeviceId(), "work phone");

    expect(d.listDevices()).toHaveLength(1);
    expect(d.listDevices()[0].label).toBe("work phone");
  });

  test("an empty name is ignored rather than blanking the row", async () => {
    const d = await load();
    d.touchThisDevice();
    const before = d.listDevices()[0].label;

    d.renameDevice(d.thisDeviceId(), "   ");

    expect(d.listDevices()[0].label).toBe(before);
  });

  test("removing another row tidies the list", async () => {
    const d = await load();
    d.touchThisDevice();
    const other = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("other-id", other);
    other.set("id", "other-id");
    other.set("label", "iPad");

    d.forgetDevice("other-id");

    expect(d.listDevices().map((r) => r.id)).not.toContain("other-id");
  });

  test("removing your own row is refused", async () => {
    // It is never what someone means, and this device would re-add itself on
    // the next connect anyway — so it would read as a bug.
    const d = await load();
    d.touchThisDevice();

    d.forgetDevice(d.thisDeviceId());

    expect(d.listDevices()).toHaveLength(1);
  });

  test("removal is tidying, not revocation: a live device comes back", async () => {
    const d = await load();
    d.touchThisDevice();
    const id = d.thisDeviceId();
    doc.getMap("devices").delete(id);

    d.touchThisDevice(); // as the next connect would

    expect(d.listDevices().map((r) => r.id)).toContain(id);
  });
});

describe("observing", () => {
  test("a change notifies listeners, so the screen tracks other devices", async () => {
    const d = await load();
    let calls = 0;
    const off = d.onDevicesChange(() => (calls += 1));

    d.touchThisDevice();
    await Promise.resolve();
    expect(calls).toBeGreaterThan(0);

    off();
    const after = calls;
    d.renameDevice(d.thisDeviceId(), "renamed after unsubscribe");
    expect(calls).toBe(after);
  });
});
