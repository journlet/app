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

  test("another device's row is kept, and marked as not this device", async () => {
    const d = await load();
    d.touchThisDevice();
    const other = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("other-id", other);
    other.set("id", "other-id");
    other.set("label", "iPhone");
    other.set("firstSeen", Date.now() + 1000); // added after this device
    other.set("lastSeen", Date.now() - 60_000);

    const list = d.listDevices();
    expect(list).toHaveLength(2);
    expect(list.filter((r) => r.isThisDevice)).toHaveLength(1);
    const row = list.find((r) => r.id === "other-id");
    expect(row?.name).toBe("iPhone");
    expect(row?.isThisDevice).toBe(false);
  });

  test("orders by when devices were added, not by which one you are on", async () => {
    // Every device sorted itself to the top, so one journal read differently
    // depending where you looked and the top row changed meaning with it. It
    // misled in practice: a phone showing its own row first was taken to be
    // claiming the Mac was syncing.
    const d = await load();
    const older = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("older", older);
    older.set("id", "older");
    older.set("firstSeen", 1000);
    d.touchThisDevice(); // added now, so it must come second

    const list = d.listDevices();
    expect(list[0].id).toBe("older");
    expect(list[1].isThisDevice).toBe(true);
  });

  test("the order is the same whichever device is reading", async () => {
    // The property that matters: two devices reading one journal see one list.
    const d = await load();
    const a = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("aaa", a);
    a.set("id", "aaa");
    a.set("firstSeen", 2000);
    const b = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("bbb", b);
    b.set("id", "bbb");
    b.set("firstSeen", 1000);

    const fromA = d.listDevices().map((r) => r.id);
    localStorage.setItem("journlet-device-id", "bbb"); // read as the other one
    const other = await load();
    const fromB = other.listDevices().map((r) => r.id);

    expect(fromB).toEqual(fromA);
    expect(fromA).toEqual(["bbb", "aaa"]);
  });

  test("rows with no added time still have one settled order", async () => {
    // Rows from the first version of the register have no firstSeen, so the id
    // has to break the tie or the list could shuffle between reads.
    const d = await load();
    for (const id of ["zzz", "aaa", "mmm"]) {
      const rec = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("devices").set(id, rec);
      rec.set("id", id);
    }

    expect(d.listDevices().map((r) => r.id)).toEqual(["aaa", "mmm", "zzz"]);
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

describe("a device that signs out", () => {
  test("says so in its own row, before it goes", async () => {
    // The register lives in the journal, so the departing device is the only one
    // that can report this: no other device can detect a sign-out. Without it a
    // row goes on claiming to hold a journal it has just erased.
    const d = await load();
    d.touchThisDevice();

    d.markThisDeviceSignedOut();

    expect(d.listDevices()[0].signedOutAt).toBeGreaterThan(0);
  });

  test("keeps its row, its name and its added date", async () => {
    // Marking rather than removing: the row's history is worth more than the
    // tidiness, and "a device deliberately left" is more useful than silence.
    const d = await load();
    d.touchThisDevice();
    const before = d.listDevices()[0];

    d.markThisDeviceSignedOut();

    const after = d.listDevices()[0];
    expect(after.id).toBe(before.id);
    expect(after.name).toBe(before.name);
    expect(after.firstSeen).toBe(before.firstSeen);
  });

  test("clears the mark when it comes back", async () => {
    const d = await load();
    d.touchThisDevice();
    d.markThisDeviceSignedOut();

    d.touchThisDevice(); // as the next connect would

    expect(d.listDevices()[0].signedOutAt).toBeUndefined();
  });

  test("clears the mark even when it returns within the hour", async () => {
    // The interval guard skips the last-seen write, so clearing has to happen
    // before it or a device back within the hour would keep claiming to have
    // left. Signing out and straight back in is the obvious way to hit this.
    const d = await load();
    d.touchThisDevice();
    d.markThisDeviceSignedOut();
    const rec = doc.getMap<Y.Map<unknown>>("devices").get(d.thisDeviceId());
    rec?.set("lastSeen", Date.now()); // recent, so the guard will return early

    d.touchThisDevice();

    expect(rec?.get("signedOutAt")).toBeUndefined();
  });

  test("marking an unregistered device does nothing rather than throwing", async () => {
    // Signing out of a device that never got as far as registering.
    const d = await load();

    expect(() => d.markThisDeviceSignedOut()).not.toThrow();
    expect(d.listDevices()).toHaveLength(0);
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

  test("marking a device removed notifies too, which is what refreshes the list", async () => {
    // Load-bearing for store/sync.ts: removeDevice() used to end with a sync
    // notification purely so the Sync screen re-read the register. That
    // notification carried nothing and nothing read it, and it went with the
    // link state moving into the snapshot. This is why deleting it is safe —
    // markDeviceRemoved sets a field on a nested map, and observeDeep is what
    // makes that reach the screen. A shallow observe would not see it.
    const d = await load();
    d.touchThisDevice();
    const id = d.listDevices()[0].id;

    let calls = 0;
    const off = d.onDevicesChange(() => (calls += 1));
    d.markDeviceRemoved(id);
    await Promise.resolve();

    expect(calls).toBeGreaterThan(0);
    expect(d.listDevices()[0].removedAt).toBeGreaterThan(0);
    off();
  });
});

describe("a device that was removed and then approved again", () => {
  test("clears the removed mark when it comes back", async () => {
    // Reported by Gary, 3 August: the phone was re-approved and working, and the
    // Mac still listed it as removed. The mark was written by the removing device
    // because the removed one could not speak for itself; once it can, and has
    // been let back in, the mark is simply out of date. Same argument as the
    // sign-out mark, which has been cleared here since 29 July.
    localStorage.setItem("journlet-device-id", "phone");
    const d = await load();
    d.touchThisDevice();
    const rec = doc.getMap<Y.Map<unknown>>("devices").get("phone") as Y.Map<unknown>;
    rec.set("removedAt", Date.now() - 60_000);

    d.touchThisDevice();

    expect(rec.get("removedAt")).toBeUndefined();
    expect(d.listDevices()[0].removedAt).toBeUndefined();
  });

  test("leaves another device's removed mark alone", async () => {
    // Only the device itself can say it is back. Clearing someone else's mark
    // would hide a removal from the person who performed it.
    localStorage.setItem("journlet-device-id", "phone");
    const d = await load();
    d.touchThisDevice();
    const other = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("devices").set("laptop", other);
    other.set("id", "laptop");
    other.set("removedAt", Date.now() - 60_000);

    d.touchThisDevice();

    expect(other.get("removedAt")).toBeGreaterThan(0);
  });
});

// Taking a row out altogether (12 August 2026). Marking rather than deleting was
// right while removal was rare — the row kept its name and its date, so the list
// could answer "what happened to that laptop" months later. Unlocking with a passkey
// changed the arithmetic: every fresh browser context that unlocks registers itself,
// so an afternoon of testing left six removed rows above the two devices in use, and
// a list that is mostly wreckage answers nothing at all.
//
// The rule is what these pin: only a row that has already gone, and never this
// device's own — that one is rewritten on the next sync, so forgetting it would be a
// control that undoes itself.
describe("forgetting a row", () => {
  const rowFor = (id: string, fields: Record<string, unknown>) => {
    const rec = new Y.Map<unknown>();
    doc.getMap("devices").set(id, rec);
    Object.entries(fields).forEach(([k, v]) => rec.set(k, v));
  };

  test("a removed device goes, and the list loses it", async () => {
    const devicesStore = await load();
    devicesStore.touchThisDevice();
    rowFor("gone", { name: "Chrome (macOS)", removedAt: Date.now() });

    expect(devicesStore.forgetDevice("gone")).toBe(true);

    expect(devicesStore.listDevices().map((d) => d.id)).not.toContain("gone");
  });

  test("so does one that signed out, which is the same kind of row", async () => {
    const devicesStore = await load();
    devicesStore.touchThisDevice();
    rowFor("left", { name: "Installed app (iOS)", signedOutAt: Date.now() });

    expect(devicesStore.forgetDevice("left")).toBe(true);
    expect(devicesStore.listDevices().map((d) => d.id)).not.toContain("left");
  });

  test("a device still in use stays, whatever it is asked", async () => {
    // The row would be rewritten by that device on its next sync, so this would be a
    // control that undoes itself within the hour — and looks broken while it does.
    const devicesStore = await load();
    devicesStore.touchThisDevice();
    rowFor("live", { name: "Chrome (macOS)", lastSeen: Date.now() });

    expect(devicesStore.forgetDevice("live")).toBe(false);
    expect(devicesStore.listDevices().map((d) => d.id)).toContain("live");
  });

  test("and this device cannot forget itself, even marked", async () => {
    // Reachable: a device marks itself signed out on the way out, and could be asked
    // to forget its own row before the teardown finishes.
    const devicesStore = await load();
    devicesStore.touchThisDevice();
    devicesStore.markThisDeviceSignedOut();
    const here = devicesStore.thisDeviceId();

    expect(devicesStore.forgetDevice(here)).toBe(false);
    expect(devicesStore.listDevices().map((d) => d.id)).toContain(here);
  });

  test("a row that is not there is not an error", async () => {
    const devicesStore = await load();

    expect(devicesStore.forgetDevice("never-existed")).toBe(false);
  });

  test("all the gone rows at once, and only those", async () => {
    const devicesStore = await load();
    devicesStore.touchThisDevice();
    rowFor("gone-1", { name: "Chrome (macOS)", removedAt: Date.now() });
    rowFor("gone-2", { name: "Safari (macOS)", removedAt: Date.now() });
    rowFor("left", { name: "Installed app (iOS)", signedOutAt: Date.now() });
    rowFor("live", { name: "Chrome (macOS)", lastSeen: Date.now() });

    expect(devicesStore.forgetGoneDevices()).toBe(3);

    const ids = devicesStore.listDevices().map((d) => d.id);
    expect(ids).toContain("live");
    expect(ids).toContain(devicesStore.thisDeviceId());
    expect(ids).toHaveLength(2);
  });
});
