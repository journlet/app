// @vitest-environment jsdom
//
// The screen a device gets when its session has lapsed and the journal is still
// here.
//
// Two rules govern the assertions. It must not read as data loss, because the
// first question somebody asks at this screen is whether their journal is gone,
// and the answer is no. And erasing has to be hard to do by accident and honest
// about what it costs, because it is the only irreversible thing on the screen
// and the device cannot check what reached the server before doing it.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SignedOutView from "../../src/ui/SignedOutView";

const show = (
  props: Partial<React.ComponentProps<typeof SignedOutView>> = {}
) => {
  const onKeepWriting = props.onKeepWriting ?? vi.fn();
  const onErase = props.onErase ?? vi.fn(async () => {});
  render(
    <SignedOutView onKeepWriting={onKeepWriting} onErase={onErase}>
      <div>sign-in form</div>
    </SignedOutView>
  );
  return { onKeepWriting, onErase };
};

const reveal = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /erase this journal from this device/i })
  );

const eraseButton = () =>
  screen.getAllByRole("button", {
    name: /erase this journal from this device|erasing…/i,
  }).at(-1) as HTMLElement;

afterEach(cleanup);

describe("what it says before it asks anything", () => {
  test("that the journal is still here, and that nobody did this", () => {
    // Both halves matter. "Still here" is the answer to the question actually
    // being asked, and "sessions run out on their own" stops the screen reading
    // as an accusation or as a break-in.
    show();

    expect(screen.getByText(/still here on this device/i)).toBeTruthy();
    expect(screen.getByText(/run out on their own/i)).toBeTruthy();
  });

  test("that signing in loses nothing, which is the reason to lead with it", () => {
    show();

    expect(screen.getByText(/merges into your journal/i)).toBeTruthy();
  });

  test("and it hands the sign-in form through rather than rebuilding one", () => {
    // SyncView's, as OnboardingView takes it: the email and code flow, the
    // resend and the change-of-address escapes should not exist twice.
    show();

    expect(screen.getByText("sign-in form")).toBeTruthy();
  });
});

describe("carrying on, which is the §6.1b choice", () => {
  test("is offered, and says what happens to what is written", () => {
    const { onKeepWriting } = show();

    fireEvent.click(
      screen.getByRole("button", { name: /keep writing on this device only/i })
    );

    expect(onKeepWriting).toHaveBeenCalled();
    expect(screen.getByText(/merge into your journal/i)).toBeTruthy();
  });

  test("and says it will ask again, rather than pretending to remember", () => {
    // Deliberately not durable: a device whose entries reach nothing must not be
    // able to look ordinary for weeks. Saying so is what stops the reappearance
    // reading as a bug.
    show();

    expect(screen.getByText(/comes back the next time the app opens/i)).toBeTruthy();
  });
});

describe("erasing, which is the new choice and the irreversible one", () => {
  test("is behind a tap, and then behind a tick", () => {
    // Three deliberate acts before anything is destroyed. The button exists
    // before the tick so the cost can be read next to what it applies to,
    // rather than appearing once the box is ticked.
    show();

    expect(screen.queryByRole("checkbox")).toBeNull();

    reveal();

    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(eraseButton().hasAttribute("disabled")).toBe(true);
  });

  test("erases once the loss is acknowledged", () => {
    const { onErase } = show();
    reveal();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(eraseButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(eraseButton());
    expect(onErase).toHaveBeenCalled();
  });

  test("admits it cannot tell what reached the server", () => {
    // The honest version of a sentence that wants to be reassuring. A signed-out
    // device has no way to ask, so a count here would be invented.
    show();
    reveal();

    expect(screen.getByText(/cannot tell what reached the server/i)).toBeTruthy();
    expect(
      screen.getByText(/comes back on this\s+device with a passkey or your journal key/i)
    ).toBeTruthy();
  });

  test("and never claims this device has synced, or that it has not", () => {
    // This screen had a second wording for a device that had never synced, taken
    // from hasSyncedOnce(). That is module state in store/sync and starts false
    // on every launch, and this screen is only reached with no session — so the
    // sentence somebody would actually have read, while deciding whether to
    // destroy a journal they had kept for weeks, was that all of it existed
    // nowhere else. There is nothing durable to ask, so the wording says what is
    // true either way and this test pins the absence.
    show();
    reveal();

    expect(screen.queryByText(/never finished syncing/i)).toBeNull();
    expect(screen.queryByText(/everything in it is only here/i)).toBeNull();
    expect(screen.getByText(/Whatever reached the server is still there/i))
      .toBeTruthy();
  });

  test("a failure says so and leaves the button usable", async () => {
    // The wipe touches IndexedDB and the keystore, and a device left looking
    // like it is still erasing would be reported as a hang. Nothing here can be
    // half-done from the person's point of view: either the reload happens or
    // the copy is still there and they can try again.
    const onErase = vi.fn(async () => {
      throw new Error("Could not clear the keystore");
    });
    show({ onErase });
    reveal();
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(eraseButton());

    await waitFor(() =>
      expect(screen.getByText(/Could not clear the keystore/i)).toBeTruthy()
    );
    expect(eraseButton().hasAttribute("disabled")).toBe(false);
  });

  test("and cancelling puts the tick back where it was", () => {
    // So a half-taken decision cannot be left lying around armed.
    const { onErase } = show();
    reveal();
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    reveal();

    // The property rather than the attribute: React never writes `checked` into
    // the DOM for a controlled input, so an attribute check here would pass
    // whatever the state was, which is this project's recurring failure.
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(eraseButton().hasAttribute("disabled")).toBe(true);
    expect(onErase).not.toHaveBeenCalled();
  });
});
