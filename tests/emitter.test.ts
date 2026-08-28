// The subscribe/notify pair, and the property that makes it usable as a store.
//
// Written on 28 August 2026 with the two modules that had grown their own copies,
// store/appUpdate.ts and lib/install.ts, neither of which had a test of any kind
// before this. The interesting assertion is the last group: a notification that
// does not move the version is one useSyncExternalStore is entitled to ignore, so
// anything that wants a re-render has to emit rather than call a subscriber.

import { describe, expect, test, vi } from "vitest";
import { createEmitter } from "../src/lib/emitter";

describe("subscribing", () => {
  test("notifies every subscriber", () => {
    const e = createEmitter();
    const a = vi.fn();
    const b = vi.fn();
    e.subscribe(a);
    e.subscribe(b);

    e.emit();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test("stops notifying once unsubscribed", () => {
    const e = createEmitter();
    const fn = vi.fn();
    const off = e.subscribe(fn);

    off();
    e.emit();

    expect(fn).not.toHaveBeenCalled();
  });

  test("survives a listener that unsubscribes itself mid-notification", () => {
    // A Set copes with this on its own, so it is the cheap half of the guarantee.
    const e = createEmitter();
    const seen: string[] = [];
    const offA = e.subscribe(() => {
      seen.push("a");
      offA();
    });
    e.subscribe(() => seen.push("b"));

    expect(() => e.emit()).not.toThrow();
    expect(seen).toEqual(["a", "b"]);

    e.emit();
    expect(seen).toEqual(["a", "b", "b"]);
  });

  test("still notifies a listener that an earlier one has just removed", () => {
    // The case the copy in emit() is actually for, and the one a Set does not
    // cover: iterating live, a listener not yet reached and then deleted is
    // skipped, so it never hears about a change it was subscribed for. In React
    // that is two components unmounting together, the first one's notification
    // unmounting the second, and the second left holding stale state.
    const e = createEmitter();
    const seen: string[] = [];
    let offB = () => {};
    e.subscribe(() => {
      seen.push("a");
      offB();
    });
    offB = e.subscribe(() => seen.push("b"));

    e.emit();

    expect(seen).toEqual(["a", "b"]);
    // And it really is gone for the next one.
    e.emit();
    expect(seen).toEqual(["a", "b", "a"]);
  });

  test("keeps each emitter's subscribers to itself", () => {
    const one = createEmitter();
    const two = createEmitter();
    const fn = vi.fn();
    one.subscribe(fn);

    two.emit();

    expect(fn).not.toHaveBeenCalled();
  });
});

describe("the version", () => {
  test("starts at zero and moves on every emit", () => {
    const e = createEmitter();
    expect(e.version()).toBe(0);
    e.emit();
    e.emit();
    expect(e.version()).toBe(2);
  });

  test("moves even with nobody listening", () => {
    // The window this exists to close: something happens before a component has
    // subscribed, and the snapshot it reads afterwards has to differ from the one
    // it read during the render.
    const e = createEmitter();
    e.emit();
    const before = e.version();
    e.subscribe(() => {});
    expect(e.version()).toBe(before);
    e.emit();
    expect(e.version()).toBe(before + 1);
  });

  test("only ever increases, so a stale read can never compare equal", () => {
    const e = createEmitter();
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      e.emit();
      seen.push(e.version());
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });
});
