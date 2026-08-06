// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NotSyncingBanner, {
  isNotSyncing,
  notSyncingReason,
} from "../../src/ui/NotSyncingBanner";

afterEach(cleanup);

describe("which states warn that writing reaches nothing", () => {
  test("a signed-out device warns", () => {
    // Including one signed out because another device pressed "lost a device":
    // entries keep saving locally and reaching nothing, which is exactly the
    // silent state this banner exists to break.
    expect(isNotSyncing("signed-out")).toBe(true);
  });

  test("working states stay quiet", () => {
    expect(isNotSyncing("synced")).toBe(false);
    expect(isNotSyncing("connecting")).toBe(false);
    expect(isNotSyncing("pending")).toBe(false);
  });

  test("states that explain themselves elsewhere stay quiet", () => {
    // offline is temporary and expected; needs-key and disabled each have their
    // own account on the Sync screen, and disabled would nag on every launch.
    expect(isNotSyncing("offline")).toBe(false);
    expect(isNotSyncing("needs-key")).toBe(false);
    expect(isNotSyncing("disabled")).toBe(false);
  });
});

test("warns that entries are device-only and offers a sign-in route", () => {
  const onOpenSync = vi.fn();
  render(<NotSyncingBanner reason="signed-out" onOpenSync={onOpenSync} />);
  expect(screen.getByText("Not syncing.")).toBeTruthy();
  expect(screen.getByText(/saved on this device only/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  expect(onOpenSync).toHaveBeenCalledTimes(1);
});

describe("a refusal is not a sign-out", () => {
  // The storage quota is what made this necessary. A device at its cap is
  // "pending" with an error, which used to warn nowhere on the journal itself:
  // the header said "changes waiting to sync", which reads as temporary, and the
  // only account of what happened was on a screen nobody had a reason to open.
  test("pending with a server error is a refusal", () => {
    expect(notSyncingReason("pending", "Journal storage limit reached")).toBe(
      "refused",
    );
  });

  test("pending with nothing wrong stays quiet", () => {
    expect(notSyncingReason("pending", null)).toBeNull();
  });

  test("offline stays quiet even with an error, because it is temporary", () => {
    expect(notSyncingReason("offline", "some server complaint")).toBeNull();
  });

  test("signed out is still a sign-out, error or not", () => {
    expect(notSyncingReason("signed-out", null)).toBe("signed-out");
    expect(notSyncingReason("signed-out", "anything")).toBe("signed-out");
  });

  test("a working state stays quiet", () => {
    expect(notSyncingReason("synced", null)).toBeNull();
    expect(notSyncingReason("connecting", null)).toBeNull();
  });

  test("the refusal says it will not clear, and does not say sign in", () => {
    const onOpenSync = vi.fn();
    render(<NotSyncingBanner reason="refused" onOpenSync={onOpenSync} />);
    expect(screen.getByText(/will not clear by itself/i)).toBeTruthy();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /what happened/i }));
    expect(onOpenSync).toHaveBeenCalledTimes(1);
  });
});
