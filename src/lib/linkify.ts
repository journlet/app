// Split free-form text into plain and URL segments so details can render
// read-later links as tappable anchors (spec §9 details field). Pure and
// framework-free so it stays unit-testable; the UI maps url segments to
// <a> elements. No HTML is produced here, so nothing is injected as markup.

export interface LinkSegment {
  kind: "text" | "url";
  value: string;
  /** for url segments: the fully-qualified href (https:// prepended if bare) */
  href?: string;
}

// http(s) links, or bare www.… — kept deliberately simple; trailing
// punctuation is trimmed off so "(see https://x.com)." links cleanly.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

export const splitLinks = (text: string): LinkSegment[] => {
  const out: LinkSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[0];
    // pull any trailing punctuation back into the surrounding text
    const trail = raw.match(TRAILING)?.[0] ?? "";
    if (trail) raw = raw.slice(0, raw.length - trail.length);
    if (start > last) out.push({ kind: "text", value: text.slice(last, start) });
    out.push({
      kind: "url",
      value: raw,
      href: raw.startsWith("http") ? raw : `https://${raw}`,
    });
    if (trail) out.push({ kind: "text", value: trail });
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
};

/** True if the text contains at least one linkable URL. */
export const hasLink = (text: string): boolean => {
  URL_RE.lastIndex = 0;
  return URL_RE.test(text);
};
