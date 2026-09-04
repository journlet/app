// The way to Send feedback, on every screen (Gary, 4 September 2026).
//
// It began as the Menu's own section and stayed there, which §13.1 had already
// recorded as the hole in the route: "the screen sits behind the Menu, so it
// cannot report the states where there is no journal on screen: sign-in, unlock,
// cannot-load and a removed device". Those are the four states somebody would
// most want to write in from, and the site footer was the whole of the answer for
// them — a footer on a different domain, reachable only by somebody who thinks to
// look for it.
//
// So the section is lifted out of MenuView unchanged and rendered at the foot of
// every screen instead. Unchanged is the point: same label, same sentence, same
// button, same measurements, and the Menu now renders this component rather than
// its own copy, so there is one of them and not two to keep in step.
//
// Prototyped in spec/journlet-prototype-v27-feedback-row.html before any of this
// was written, which is where the two things that are not verbatim were settled.
//
// The hairline above it is new, and it is the reason the section could not simply
// be dropped in. In the Menu this row follows other rows, so the uppercase label
// is enough to separate it. On a gate screen it follows prose, and on the day page
// it follows the entries and the capture field, where a label alone reads as one
// more paragraph of the screen above rather than as a section of its own (Gary,
// 4 September 2026, choosing the rule over verbatim). It is the app's ordinary
// rule, the same one under the erase and sign-out blocks, and the Menu gets it
// too rather than a variant nobody asked for.
//
// The sentence is left exactly as the Menu had it, which was also Gary's choice
// and is worth recording with its cost, measured at 375px in the prototype: the
// text column is about 223px once the button and the page padding are taken out,
// so the sentence that reads as three lines on a laptop is seven on a phone and
// the section is 190px, near enough six of the page's 33px rows. That is what the
// Menu already costs on a phone; it is now what every screen costs. The trade was
// made deliberately — one wording, in one place, saying the whole truth about
// where the message goes — and the alternative, a short sentence off the Menu and
// the full one inside it, is two wordings to keep in step.
//
// Nothing here knows anything about feedback. It takes one callback, so a screen
// with no journal behind it can open the same screen the Menu opens.

import type { CSSProperties } from "react";
import { S } from "./styles";
import { GRID } from "../lib/grid";

interface FeedbackRowProps {
  /** Open the Send feedback screen. */
  onOpen: () => void;
}

export default function FeedbackRow({ onOpen }: FeedbackRowProps) {
  return (
    <section style={ST.section}>
      <div style={S.subGroupLabel}>Feedback</div>
      <div style={ST.row}>
        <div style={S.rowText}>
          <div style={S.rowLabel}>Send feedback</div>
          <div style={ST.rowDesc}>
            Report something broken, or say what you would change. Composed here
            and sent to hello@journlet.com from wherever you write email, in a
            browser or in a mail app, so you read it before it leaves. Nothing
            from your journal is attached.
          </div>
        </div>
        <div style={S.rowBtn}>
          <button className="miniBtn" onClick={onOpen}>
            send feedback
          </button>
        </div>
      </div>
    </section>
  );
}

const ST = {
  // S.section's bottom margin, plus the rule and the 18px of air the app's other
  // divided blocks use above one (ui/SignedOutView, ui/UnlockView). paddingTop is
  // 5px rather than a round number because S.subGroupLabel's line box is a full
  // GRID row: 5 + 33 keeps the label's baseline where the dot rows expect it.
  section: {
    marginBottom: GRID,
    marginTop: 18,
    paddingTop: 5,
    borderTop: "1px solid var(--line)",
  },
  // Both copied value for value from MenuView, where they were and still are the
  // shape every row on that screen uses.
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "4px 4px",
  },
  // Stays private to this file for the reason ui/styles.ts gives: its 16px line
  // box is neither a full row nor the 13px short box, and the grid contract in
  // tests/grid.test.ts allows only those two inside that file.
  rowDesc: {
    fontSize: 11.5,
    lineHeight: "16px",
    color: "var(--ink-soft)",
    paddingBottom: 4,
  },
} as const satisfies Record<string, CSSProperties>;
