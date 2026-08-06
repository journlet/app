// Sticky capture state (spec §4.1): selected type, priority and scope
// persist after each entry — and across launches — so a run of similar
// entries needs no re-selection.

import type { EntryType } from "./types";
import { SCOPES } from "./dates";
import type { Scope } from "./dates";

export interface CaptureSticky {
  type: EntryType;
  priority: boolean;
  inspiration: boolean;
  /** which kind of page capture last logged into (see ui/PagePicker) */
  scope: Scope;
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
    const merged = { ...DEFAULTS, ...parsed };
    // "date" was a fifth scope before the page picker was unified (5 August
    // 2026); a stored one would now select nothing, so it reads as "day" — the
    // date itself was never sticky, so nothing is lost
    if (!SCOPES.includes(merged.scope)) merged.scope = DEFAULTS.scope;
    return merged;
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
