// Everything the approving device shows about devices asking to be added: the
// prompt, what happened after answering it, and the reminder that something is
// still waiting.
//
// One component so App.tsx gains a single line, and so the three states cannot
// drift out of step with each other.

import { useEffect, useState } from "react";
import { LINK_REQUEST_TTL_MS } from "../store/deviceLink";
import type { LinkRequest } from "../store/deviceLink";
import {
  approveDevice,
  getLinkRequests,
  onSyncStatus,
  rejectDevice,
} from "../store/sync";
import ApprovalCard from "./ApprovalCard";

/**
 * How long the confirmation stays before clearing itself.
 *
 * It only reports that the thing just asked for happened, so it should not need
 * an action to get rid of. The rejection is not treated this way: it is the one
 * message that might mean something is wrong, and auto-hiding a warning is how
 * nobody reads it.
 */
const CONFIRMATION_MS = 7_000;

interface Outcome {
  kind: "added" | "rejected";
  what: string;
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
  const [requests, setRequests] = useState<LinkRequest[]>(getLinkRequests());
  const [deferred, setDeferred] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => onSyncStatus(() => setRequests(getLinkRequests())), []);

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

  const describe = (r: LinkRequest) => r.client ?? "The device";

  const approve = async (request: LinkRequest) => {
    await approveDevice(request);
    setOutcome({ kind: "added", what: describe(request) });
  };

  const reject = async (deviceId: string) => {
    const request = requests.find((r) => r.deviceId === deviceId);
    await rejectDevice(deviceId);
    setOutcome({ kind: "rejected", what: request ? describe(request) : "It" });
  };

  const minutesLeft = (r: LinkRequest) =>
    Math.max(0, Math.round((r.requestedAt + LINK_REQUEST_TTL_MS - Date.now()) / 60_000));

  return (
    <>
      {outcome?.kind === "added" && (
        <div style={line}>
          <span style={{ flex: 1 }}>
            {outcome.what} was added. Your journal is on its way to it.
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
          <span style={{ flex: 1 }}>
            Rejected, and nothing was shared. Codes that do not match mean either
            the wrong request or something pretending to be your device. If you
            meant to add one, start again on that device and check the code
            carefully.
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
            {describe(r)} is waiting to be added. It expires in{" "}
            {minutesLeft(r)} minutes.
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
    </>
  );
}
