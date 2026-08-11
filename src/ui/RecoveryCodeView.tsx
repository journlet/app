// Second stage of first run: the recovery code, shown once (decision 4, spec
// device-identity-design.md).
//
// Presentational, and deliberately a gate. This is the only way back into a
// journal once every device is gone, and there is no better moment to interrupt
// someone later: the gap between installing and saving it is exactly when a new
// user is most likely to lose a device.

import { useState } from "react";
import type { CSSProperties } from "react";
import { S } from "./styles";

interface RecoveryCodeViewProps {
  code: string;
  onContinue: () => void;
}

export default function RecoveryCodeView({
  code,
  onContinue,
}: RecoveryCodeViewProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard blocked or unavailable: the code is on screen to be read.
    }
  };

  const download = () => {
    const blob = new Blob(
      [
        "Journlet journal key\n\n" +
          code +
          "\n\nKeep this safe. It unlocks your journal on a new device.\n" +
          "If you lose every device you are signed in on and this key, your journal cannot be recovered.\n",
      ],
      { type: "text/plain" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "journlet-journal-key.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section style={{ maxWidth: 480 }}>
      <h2 style={ST.title}>Save your journal key</h2>
      <p style={S.onboardLede}>
        Your journal is encrypted with this key. It is the only way to open your
        journal on a new device, and the only way back if you lose the devices
        you are signed in on.
      </p>
      {/* Said plainly and once. Nobody can send it to you later: the server
          holds ciphertext only, so there is no "forgot my key" to fall back on
          and it would be dishonest to imply otherwise. */}
      <p style={S.onboardLede}>
        Nobody can send it to you again, including whoever runs Journlet. Put it
        in a password manager, or write it down.
      </p>
      <div style={ST.codeBox}>
        <code style={ST.code}>{code}</code>
        <div style={ST.row}>
          <button className="miniBtn" onClick={() => void copy()}>
            {copied ? "copied" : "copy to clipboard"}
          </button>
          <button className="miniBtn" onClick={download}>
            download as file
          </button>
        </div>
      </div>
      <label style={ST.ack}>
        <input
          type="checkbox"
          checked={saved}
          onChange={(ev) => setSaved(ev.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>I have saved my journal key somewhere safe.</span>
      </label>
      <button
        className="addBtn"
        style={{ width: "auto" }}
        disabled={!saved}
        onClick={onContinue}
      >
        Start journalling
      </button>
    </section>
  );
}

// `as const satisfies` rather than a Record<string, CSSProperties> annotation.
// The annotation types the values and throws the keys away, so a mistyped key
// compiles and hands back undefined: an element with no styling and no error.
// This keeps the value checking and infers the key union, so a typo is a build
// failure (assessment Finding 15; ui/styles.ts:12 has the longer version).
const ST = {
  title: {
    fontFamily: "'Fraunces', serif",
    fontSize: 24,
    fontWeight: 600,
    margin: "8px 0 10px",
    color: "var(--ink)",
  },
  codeBox: {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 10,
    padding: "10px 14px",
    margin: "4px 0 12px",
    maxWidth: 480,
  },
  code: {
    display: "block",
    fontSize: 13,
    wordBreak: "break-all",
    lineHeight: 1.6,
    color: "var(--ink)",
    marginBottom: 8,
  },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  ack: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--ink)",
    maxWidth: 480,
    margin: "6px 0 12px",
  },
} as const satisfies Record<string, CSSProperties>;
