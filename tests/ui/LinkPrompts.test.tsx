// @vitest-environment jsdom
//
// The link prompts in the page flow, and specifically the one about this device.
//
// A device that needs approving while still holding a readable journal never
// reaches the unlock screen, because the onboarding gates only fire for devices
// with nothing local. So without the block tested here, such a device asks for
// approval and shows no code, and the person is asked to compare two codes having
// been given one. That is not a comparison, and the comparison is the entire
// defence against a substituted public key.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

let linkCode: string | null = null;
let linkStage: string | null = null;
let requests: unknown[] = [];

vi.mock("../../src/store/sync", () => ({
  approveDevice: vi.fn(),
  rejectDevice: vi.fn(),
  getLinkRequests: () => requests,
  getLinkCode: () => linkCode,
  getLinkStage: () => linkStage,
  subscribeSync: () => () => {},
}));

const LinkPrompts = (await import("../../src/ui/LinkPrompts")).default;

afterEach(() => {
  cleanup();
  linkCode = null;
  linkStage = null;
  requests = [];
});

describe("while this device waits to be approved", () => {
  test("it shows the code to compare", () => {
    linkCode = "4T9K-2WQ7-BX30-M1PZ";
    linkStage = "waiting";

    render(<LinkPrompts />);

    expect(screen.getByText("4T9K-2WQ7-BX30-M1PZ")).toBeTruthy();
  });

  test("it says what to do, on which device", () => {
    linkCode = "4T9K-2WQ7-BX30-M1PZ";
    linkStage = "waiting";

    render(<LinkPrompts />);

    expect(screen.getByText(/waiting to be approved/i)).toBeTruthy();
    expect(screen.getByText(/on a device you\s+already use/i)).toBeTruthy();
  });

  test("it says the journal already here is unaffected", () => {
    // Because the device is showing that journal behind this prompt, and a prompt
    // that looks like a warning about the content would read as data loss.
    linkCode = "4T9K-2WQ7-BX30-M1PZ";
    linkStage = "waiting";

    render(<LinkPrompts />);

    expect(screen.getByText(/already read here is unaffected/i)).toBeTruthy();
  });
});

describe("when it does not apply", () => {
  test("nothing is shown with no code", () => {
    linkStage = "waiting";
    linkCode = null;

    render(<LinkPrompts />);

    expect(screen.queryByText(/waiting to be approved/i)).toBeNull();
  });

  test("nothing is shown once the stage has moved on", () => {
    // A refused request has its own message elsewhere, and a granted one has no
    // message at all: the journal simply works.
    linkCode = "4T9K-2WQ7-BX30-M1PZ";
    linkStage = "declined";

    render(<LinkPrompts />);

    expect(screen.queryByText(/waiting to be approved/i)).toBeNull();
  });

  test("nothing is shown on a device that is not asking", () => {
    render(<LinkPrompts />);

    expect(screen.queryByText(/waiting to be approved/i)).toBeNull();
  });
});
