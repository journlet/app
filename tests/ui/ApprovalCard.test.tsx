// @vitest-environment jsdom
//
// The approval prompt's three answers (spec device-identity-design.md).
//
// The wording is the feature here. Approving hands another device the ability to
// read everything, so the prompt has to make the check unmissable and has to let
// someone refuse without claiming a reason they do not mean.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ApprovalCard from "../../src/ui/ApprovalCard";
import type { LinkRequest } from "../../src/store/deviceLink";

const request: LinkRequest = {
  deviceId: "phone",
  publicKey: "irrelevant-here",
  client: "Installed app (iOS)",
  requestedAt: Date.now() - 30_000,
  code: "2MHY HMQ3 W1HB PM11",
};

afterEach(cleanup);

const renderCard = () => {
  const onApprove = vi.fn(async () => {});
  const onReject = vi.fn(async () => {});
  const onDefer = vi.fn();
  render(
    <ApprovalCard
      request={request}
      onApprove={onApprove}
      onReject={onReject}
      onDefer={onDefer}
    />
  );
  return { onApprove, onReject, onDefer };
};

describe("what the prompt says", () => {
  test("names what is asking, and shows the code to compare", () => {
    renderCard();

    expect(screen.getByText(/Installed app \(iOS\)/)).toBeTruthy();
    expect(screen.getByText("2MHY HMQ3 W1HB PM11")).toBeTruthy();
  });

  test("warns about a mismatch before the decision, not after it", () => {
    // It used to be said only in the message that followed a refusal, which is a
    // warning about a choice already made.
    renderCard();

    expect(
      screen.getByText(/does not match, do not add it/i)
    ).toBeTruthy();
  });

  test("makes approval assert the check", () => {
    // "add it" alone would let someone approve without ever comparing.
    renderCard();

    expect(screen.getByText(/codes match, add it/i)).toBeTruthy();
  });
});

describe("refusing", () => {
  test("can be done without claiming the codes differed", () => {
    // Gary, 3 August: he wanted to decline a request he simply did not want, and
    // the only refusal available said "codes are different", which was untrue.
    renderCard();

    // Anchored: the phrase also appears in the warning above the buttons, which
    // is deliberate — the guidance and the action are worded the same way.
    expect(screen.getByText(/^do not add it$/i)).toBeTruthy();
    expect(screen.queryByText(/codes are different/i)).toBeNull();
  });

  test("destroys the request rather than deferring it", () => {
    const { onReject, onDefer } = renderCard();

    fireEvent.click(screen.getByText(/^do not add it$/i));

    expect(onReject).toHaveBeenCalledWith("phone");
    expect(onDefer).not.toHaveBeenCalled();
  });

  test("deferring leaves the request alone", () => {
    // The distinction that has to survive: "not now" must never destroy a request
    // and "do not add it" must never leave one alive.
    const { onReject, onDefer } = renderCard();

    fireEvent.click(screen.getByText(/not now/i));

    expect(onDefer).toHaveBeenCalledWith("phone");
    expect(onReject).not.toHaveBeenCalled();
  });
});
