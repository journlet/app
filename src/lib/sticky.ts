// Sticky capture state (spec §4.1): selected type, priority and scope
// persist after each entry — and across launches — so a run of similar
// entries needs no re-selection.

import type { EntryType } from "./types";
import type { Scope } from "./dates";

export type CaptureScope = Scope | "date";

export interface CaptureSticky {
  type: EntryType;
  priority: boolean;
  inspiration: boolean;
  scope: CaptureScope;
}

const KEY = "journlet-capture-v1";

const DEFAULTS: CaptureSticky = {
  type: "task",
  priority: false,
  inspiration: false,
  scope: "day",
};

export const loadSticky = (): CaptureSticky => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<CaptureSticky>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
};

export const saveSticky = (s: CaptureSticky): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode etc.) — sticky state simply
    // won't survive a relaunch
  }
};
