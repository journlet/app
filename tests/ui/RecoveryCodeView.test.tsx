// @vitest-environment jsdom
//
// The recovery code screen, shown once on the device that created the journal.
//
// The wording carries the weight here. Nobody can reissue this code, so the
// screen has to say so without hedging, and the gate has to be a gate: there is
// no better moment to interrupt someone later, and the gap between installing
// and saving it is exactly when a new user is most likely to lose a device.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RecoveryCodeView from "../../src/ui/RecoveryCodeView";

const CODE = "J1-ABCD-EFGH-IJKL";

afterEach(cleanup);

const renderView = (onContinue = vi.fn()) => {
  render(<RecoveryCodeView code={CODE} onContinue={onContinue} />);
  return onContinue;
};

describe("what it says", () => {
  test("shows the code itself", () => {
    renderView();

    expect(screen.getByText(CODE)).toBeTruthy();
  });

  test("says nobody can send it again, operator included", () => {
    // The server holds ciphertext only, so there is no "forgot my key" path.
    // Implying one would be the most costly kind of dishonesty here.
    renderView();

    expect(screen.getByText(/Nobody can send it to you again/i)).toBeTruthy();
    expect(screen.getByText(/runs Journlet/i)).toBeTruthy();
  });

  test("says what it is for, including losing every device", () => {
    renderView();

    expect(screen.getByText(/only way to open your\s+journal on a new device/i))
      .toBeTruthy();
    expect(screen.getByText(/lose the devices/i)).toBeTruthy();
  });

  test("suggests somewhere to put it", () => {
    renderView();

    expect(screen.getByText(/password manager/i)).toBeTruthy();
  });
});

describe("getting it somewhere safe", () => {
  test("offers copy and download", () => {
    renderView();

    expect(screen.getByText(/copy to clipboard/i)).toBeTruthy();
    expect(screen.getByText(/download as file/i)).toBeTruthy();
  });

  test("confirms a copy so it is clear it worked", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderView();

    fireEvent.click(screen.getByText(/copy to clipboard/i));

    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(await screen.findByText(/^copied$/)).toBeTruthy();
  });

  test("a blocked clipboard does not break the screen", async () => {
    // The code is on screen to be read either way, so a rejected clipboard
    // must not strand someone on the one screen they cannot get past.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    renderView();

    fireEvent.click(screen.getByText(/copy to clipboard/i));

    expect(await screen.findByText(/copy to clipboard/i)).toBeTruthy();
    expect(screen.getByText(CODE)).toBeTruthy();
  });
});

describe("the gate", () => {
  test("will not continue until you say you have saved it", () => {
    const onContinue = renderView();
    const go = screen.getByText(/Start journalling/i) as HTMLButtonElement;

    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    expect(onContinue).not.toHaveBeenCalled();
  });

  test("continues once acknowledged", () => {
    const onContinue = renderView();

    fireEvent.click(screen.getByRole("checkbox"));
    const go = screen.getByText(/Start journalling/i) as HTMLButtonElement;
    expect(go.disabled).toBe(false);

    fireEvent.click(go);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  test("the acknowledgement is about having saved it, not having seen it", () => {
    // "I have saved my journal key somewhere safe" is a different claim from
    // "I have read this", and it is the one that matters.
    renderView();

    expect(screen.getByText(/saved my journal key somewhere safe/i))
      .toBeTruthy();
  });
});
