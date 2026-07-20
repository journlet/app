// Client-side Markdown export (spec §11 Q3, resolved 20 July 2026).
// E2EE means backup must be client-driven; this renders the whole journal
// in purist Ryder Carroll notation. Weekly download = belt-and-braces
// backup against the free tier's lack of server backups (spec §8).

import { SCOPES, keyScope, pageLabel } from "./dates";
import type { Scope } from "./dates";
import { GLYPH, colPageKey } from "./types";
import type { Collection, Entry, Habit } from "./types";

const SCOPE_HEADING: Record<Scope, string> = {
  day: "Days",
  week: "Weeks",
  month: "Months",
  year: "Years",
};

const fmtStamp = (ts: number): string =>
  new Date(ts).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const entryLine = (e: Entry): string => {
  const glyph =
    e.state === "done" ? "×" : e.state === "migrated" ? ">" : GLYPH[e.type];
  const signifiers = `${e.priority ? "\\* " : ""}${e.inspiration ? "! " : ""}`;
  let text = `${signifiers}${glyph} ${e.text}`;
  if (e.state === "struck") text = `~~${text}~~`;
  if (e.remindAt) text += ` _(remind ${fmtStamp(e.remindAt)})_`;
  return `${e.parentId ? "  " : ""}- ${text}`;
};

export const buildMarkdown = (
  days: Record<string, Entry[]>,
  collections: Collection[],
  habits: Habit[]
): string => {
  const lines: string[] = [
    "# Journlet journal export",
    "",
    `_Exported ${fmtStamp(Date.now())}_`,
    "",
    "Notation: • task, ○ event, — note, × complete, > migrated,",
    "\\* priority, ~~struck through~~ no longer relevant.",
    "",
  ];

  const groups: Record<Scope, string[]> = {
    day: [],
    week: [],
    month: [],
    year: [],
  };
  Object.keys(days).forEach((k) => {
    const sc = keyScope(k);
    if (sc && days[k].length > 0) groups[sc].push(k);
  });

  for (const sc of SCOPES) {
    if (groups[sc].length === 0) continue;
    lines.push(`## ${SCOPE_HEADING[sc]}`, "");
    for (const k of groups[sc].sort()) {
      lines.push(`### ${pageLabel(k)} (${k})`, "");
      days[k].forEach((e) => lines.push(entryLine(e)));
      lines.push("");
    }
  }

  if (collections.length > 0) {
    lines.push("## Collections", "");
    for (const c of collections) {
      lines.push(
        `### ${c.name} (${c.kind === "habits" ? "habit tracker" : "list"})`,
        ""
      );
      if (c.kind === "list") {
        const entries = days[colPageKey(c.id)] ?? [];
        if (entries.length === 0) lines.push("_(empty)_");
        else entries.forEach((e) => lines.push(entryLine(e)));
      } else {
        const hs = habits.filter((h) => h.collectionId === c.id);
        if (hs.length === 0) lines.push("_(no habits)_");
        for (const h of hs) {
          const marks = Object.keys(h.marks).sort();
          lines.push(
            `- ${h.name} — ${marks.length} day${marks.length === 1 ? "" : "s"} marked` +
              (marks.length > 0 ? `: ${marks.join(", ")}` : "")
          );
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
};
