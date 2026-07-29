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
    expect(d.listDevices()[0].name).toBe("Browser (unknown platform)");
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
    expect(row.name).toContain("Installed app");
    expect(row.name).toContain("Browser");
    expect(row.name).toContain("(unknown platform)");
  });

  test("lists the most recently used client first", async () => {
    // The one you are looking at should lead, or the row reads as though it
    // belongs to something else.
    const d = await load();
    d.touchThisDevice();
    const rec = doc.getMap<Y.Map<unknown>>("devices").get(d.thisDeviceId());
    const clients = rec?.get("clients") as Y.Map<unknown>;
    clients.set("Installed app", Date.now() + 5000);

    expect(d.listDevices()[0].name).toMatch(/^Installed app and Browser/);
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

    expect(d.listDevices()[0].name).toBe("Browser (unknown platform)");
  });

  test("a row written before clients were recorded still reads sensibly", async () => {
    // Rows from the first version of the register have only a label.
    const d = await load();
    const old = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("legacy", old);
    old.set("id", "legacy");
    old.set("label", "Mac");

    const row = d.listDevices().find((r) => r.id === "legacy");
    expect(row?.name).toBe("Mac");
  });

  test("a row missing the platform gains it on the next connect", async () => {
    // The bug this fixes: `platform` was only written when a row was created, so
    // rows from earlier versions rendered as "Installed app and Chrome" with an
    // empty bracket. Only the device itself can say what it runs on.
    const d = await load();
    const id = d.thisDeviceId();
    const rec = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set(id, rec);
    rec.set("id", id);
    rec.set("client", "Chrome (macOS)"); // old single-string field, no platform

    d.touchThisDevice();

    expect(rec.get("platform")).toBe("unknown platform");
    expect(d.listDevices()[0].name).toBe("Browser (unknown platform)");
  });

  test("another device's row shows its platform before it reconnects", async () => {
    // Only that device can fill the field in, and it may not open the app for
    // days. Reading the platform out of its old description beats a bare
    // "Installed app" with nothing in brackets.
    const d = await load();
    const other = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("phone", other);
    other.set("id", "phone");
    other.set("client", "Installed app (iOS)");
    const clients = new Y.Map<unknown>();
    other.set("clients", clients);
    clients.set("Installed app", Date.now());

    const row = d.listDevices().find((r) => r.id === "phone");
    expect(row?.name).toBe("Installed app (iOS)");
  });

  test("a row from the single-client version keeps working", async () => {
    // The intermediate format: one `client` string rather than a set.
    const d = await load();
    const mid = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("mid", mid);
    mid.set("id", "mid");
    mid.set("client", "Chrome (macOS)");

    const row = d.listDevices().find((r) => r.id === "mid");
    expect(row?.name).toBe("Chrome (macOS)");
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
    expect(list[1].name).toBe("iPhone");
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
    d.touchThisDevice();
    expect(calls).toBe(after);
  });
});
