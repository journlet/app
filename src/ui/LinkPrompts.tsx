// Everything shown in the page flow about devices being added: the prompt on the
// approving device, what happened after answering it, the reminder that something
// is still waiting, and — the one that is about *this* device rather than another
// — the code to compare while this device waits to be approved.
//
// That last one exists because a device can need approving while still holding a
// readable journal. A brand new device shows its code on the unlock screen, but a
// device that already has entries never reaches that screen, and asking someone to
// compare two codes while showing them only one is not a comparison.
//
// One component so App.tsx gains a single line, and so the states cannot drift out
// of step with each other.

import { useEffect, useState } from "react";
import { LINK_REQUEST_TTL_MS } from "../store/deviceLink";
import type { LinkRequest } from "../store/deviceLink";
import {
  approveDevice,
  getLinkCode,
  getLinkRequests,
  getLinkStage,
  subscribeSync,
  rejectDevice,
} from "../store/sync";
import ApprovalCard from "./ApprovalCard";

/**
 * How long the confirmation stays before clearing itself.
 *
 * It only reports that the thing just asked for happened, so it should not need
 * an action to get rid of. A refusal is not treated this way: it is the one
 * outcome that might mean something is wrong, and auto-hiding that is how nobody
 * reads it. It stays until dismissed even though most refusals are simply "not
 * that device", because the app cannot tell the two apart.
 */
const CONFIRMATION_MS = 7_000;

interface Outcome {
  kind: "added" | "rejected";
}

// Same panel geometry as the approval card and the Sync screen's sections, so a
// request and its outcome occupy the same footprint and nothing jumps when one
// replaces the other.
const line: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "9px 12px",
  margin: "10px 0 16px",
  maxWidth: 480,
  fontSize: 13.5,
  lineHeight: 1.55,
  color: "var(--ink)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

export default function LinkPrompts() {
  // readonly, because the requests now come out of the sync snapshot, which
  // hands out the same array identity until the list actually changes. That
  // identity is what stops the expiry countdown below restarting on a publish
  // that had nothing to do with these requests.
  const [requests, setRequests] = useState<readonly LinkRequest[]>(
    getLinkRequests()
  );
  const [deferred, setDeferred] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [ownCode, setOwnCode] = useState<string | null>(getLinkCode());
  const [ownStage, setOwnStage] = useState(getLinkStage());

  useEffect(
    () =>
      // subscribeSync rather than onSyncStatus: this reads three values the
      // notification does not carry, so the status it would be handed is of no
      // use, and the initial read is already done by the useState above.
      subscribeSync(() => {
        setRequests(getLinkRequests());
        setOwnCode(getLinkCode());
        setOwnStage(getLinkStage());
      }),
    []
  );

  useEffect(() => {
    if (outcome?.kind !== "added") return;
    const t = setTimeout(() => setOutcome(null), CONFIRMATION_MS);
    return () => clearTimeout(t);
  }, [outcome]);

  // A request that has gone (approved elsewhere, withdrawn, expired) should not
  // leave its device id behind in the deferred list, or deferring the same device
  // twice would silently do nothing the second time.
  useEffect(() => {
    setDeferred((ids) => ids.filter((id) => requests.some((r) => r.deviceId === id)));
  }, [requests]);

  const showing = requests.filter((r) => !deferred.includes(r.deviceId));
  const waiting = requests.filter((r) => deferred.includes(r.deviceId));

  // Nothing here names the device. Requests carry no label since §6.5, and the
  // code is the only true way to tell two of them apart, so it is what the
  // deferred line shows.
  const approve = async (request: LinkRequest) => {
    await approveDevice(request);
    setOutcome({ kind: "added" });
  };

  const reject = async (deviceId: string) => {
    await rejectDevice(deviceId);
    setOutcome({ kind: "rejected" });
  };

  const minutesLeft = (r: LinkRequest) =>
    Math.max(0, Math.round((r.requestedAt + LINK_REQUEST_TTL_MS - Date.now()) / 60_000));

  return (
    <>
      {outcome?.kind === "added" && (
        <div style={line}>
          <span style={{ flex: 1 }}>
            That device was added. Your journal is on its way to it.
          </span>
          <button className="miniBtn" onClick={() => setOutcome(null)}>
            dismiss
          </button>
        </div>
      )}

      {outcome?.kind === "rejected" && (
        <div
          style={{
            ...line,
            borderColor: "var(--danger-line)",
            alignItems: "flex-start",
          }}
        >
          {/* Neutral about the reason, because the app does not know it. It used
              to explain a code mismatch, which was wrong whenever the refusal was
              simply "I did not want that device". */}
          <span style={{ flex: 1 }}>
            Not added, and nothing was shared. That device can ask again if you
            change your mind.
          </span>
          {/* Manual only. See CONFIRMATION_MS above. */}
          <button className="miniBtn" onClick={() => setOutcome(null)}>
            dismiss
          </button>
        </div>
      )}

      {showing.map((r) => (
        <ApprovalCard
          key={r.deviceId}
          request={r}
          onApprove={approve}
          onReject={reject}
          onDefer={(id) => setDeferred((ids) => [...ids, id])}
        />
      ))}

      {/* Deferring must not make the request unfindable: the asking device is
          sitting there waiting and cannot rescue itself. The remaining time is
          shown because the request is perishable. */}
      {waiting.map((r) => (
        <div key={r.deviceId} style={line}>
          <span style={{ flex: 1 }}>
            A device showing{" "}
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {r.code}
            </strong>{" "}
            is waiting to be added. It expires in {minutesLeft(r)} minutes.
          </span>
          <button
            className="miniBtn"
            onClick={() =>
              setDeferred((ids) => ids.filter((id) => id !== r.deviceId))
            }
          >
            look at it
          </button>
        </div>
      ))}

      {/* This device, waiting on someone else. Only when it has a journal to show
          behind this: a device with nothing gets the unlock screen instead, which
          says the same thing with more room. */}
      {ownStage === "waiting" && ownCode && (
        <div style={line}>
          <span style={{ flex: 1 }}>
            This device is waiting to be approved. Open Journlet on a device you
            already use, and check the code it shows you matches{" "}
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {ownCode}
            </strong>
            . What you can already read here is unaffected.
          </span>
        </div>
      )}
    </>
  );
}
