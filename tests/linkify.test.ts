// URL segmentation for entry details (src/lib/linkify.ts).

import { describe, expect, test } from "vitest";
import { hasLink, splitLinks } from "../src/lib/linkify";

describe("splitLinks", () => {
  test("plain text yields a single text segment", () => {
    expect(splitLinks("just a note")).toEqual([
      { kind: "text", value: "just a note" },
    ]);
  });

  test("extracts an https url and keeps surrounding text", () => {
    const segs = splitLinks("read https://example.com/x later");
    expect(segs).toEqual([
      { kind: "text", value: "read " },
      { kind: "url", value: "https://example.com/x", href: "https://example.com/x" },
      { kind: "text", value: " later" },
    ]);
  });

  test("prepends https:// to a bare www link", () => {
    const segs = splitLinks("www.example.com");
    expect(segs[0]).toEqual({
      kind: "url",
      value: "www.example.com",
      href: "https://www.example.com",
    });
  });

  test("trailing punctuation stays out of the link", () => {
    const segs = splitLinks("(see https://example.com).");
    const url = segs.find((s) => s.kind === "url");
    expect(url?.value).toBe("https://example.com");
    expect(segs[segs.length - 1]).toEqual({ kind: "text", value: ")." });
  });

  test("hasLink detects presence of a url", () => {
    expect(hasLink("no link here")).toBe(false);
    expect(hasLink("go to https://a.com")).toBe(true);
  });
});
