// Date helpers ported from journlet-prototype-v17

export type Scope = "day" | "week" | "month" | "year";

export const SCOPES: Scope[] = ["day", "week", "month", "year"];

export const SCOPE_LABEL: Record<Scope, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
};

export const dkey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const todayKey = (): string => dkey(new Date());

export const toDate = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const mondayOf = (key: string): Date => {
  const dt = toDate(key);
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  return dt;
};

export const isoWeekKey = (key: string): string => {
  const dt = mondayOf(key);
  const thu = new Date(dt);
  thu.setDate(dt.getDate() + 3);
  const isoYear = thu.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const week1Mon = new Date(jan4);
  week1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const week =
    Math.round((dt.getTime() - week1Mon.getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
};

export const periodKey = (scope: Scope, anchor: string): string => {
  if (scope === "day") return anchor;
  if (scope === "week") return isoWeekKey(anchor);
  if (scope === "month") return anchor.slice(0, 7);
  return anchor.slice(0, 4);
};

// Classify a storage key back to its scope by shape
export const keyScope = (k: string): Scope | null => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return "day";
  if (/^\d{4}-W\d{2}$/.test(k)) return "week";
  if (/^\d{4}-\d{2}$/.test(k)) return "month";
  if (/^\d{4}$/.test(k)) return "year";
  return null;
};

/** Is this period key ahead of the current period of its own scope? */
export const isFutureKey = (pk: string): boolean => {
  const sc = keyScope(pk);
  return sc ? pk > periodKey(sc, todayKey()) : false;
};

export const fmt = (dt: Date, opts: Intl.DateTimeFormatOptions): string =>
  dt.toLocaleDateString("en-GB", opts);

export const periodSub = (scope: Scope, anchorKey: string): string => {
  const anchor = toDate(anchorKey);
  if (scope === "day")
    return fmt(anchor, { weekday: "long", day: "numeric", month: "long" });
  if (scope === "week") {
    const mon = mondayOf(anchorKey);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return `${fmt(mon, { day: "numeric", month: "short" })} – ${fmt(sun, {
      day: "numeric",
      month: "short",
    })}`;
  }
  if (scope === "month") return fmt(anchor, { month: "long", year: "numeric" });
  return anchorKey.slice(0, 4);
};

/**
 * The six Monday-first rows of a month grid: every day of the month the anchor
 * falls in, plus the neighbouring days that fill the corners. Always 42 cells,
 * so the grid never changes height as you step through the months.
 */
export const monthGrid = (anchor: string): string[] => {
  const start = mondayOf(`${anchor.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return dkey(d);
  });
};

/**
 * The Monday of every ISO week that overlaps the anchor's month. A week
 * straddling two months is listed under both, because it belongs to both on
 * paper — its page is the same page either way.
 */
export const weeksOfMonth = (anchor: string): string[] => {
  const month = anchor.slice(0, 7);
  const out: string[] = [];
  let mon = dkey(mondayOf(`${month}-01`));
  for (let i = 0; i < 6; i++) {
    const sun = shiftAnchor("day", mon, 6);
    if (mon.slice(0, 7) === month || sun.slice(0, 7) === month) out.push(mon);
    mon = shiftAnchor("week", mon, 1);
  }
  return out;
};

/** The current period of each scope, in words. A picker sitting on the page
 *  you are already living in should say so, not imply it with a highlight. */
export const SCOPE_NOW_WORD: Record<Scope, string> = {
  day: "today",
  week: "this week",
  month: "this month",
  year: "this year",
};

/**
 * The full name of the page an anchor day falls in, at a given scope. Spelled
 * out rather than abbreviated — pageLabel's job is to fit a header, this one's
 * is to leave no doubt which page has been chosen, so a week names its dates
 * as well as its number.
 */
export const periodName = (scope: Scope, anchor: string): string => {
  if (scope === "day")
    return fmt(toDate(anchor), {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (scope === "week")
    return `Week ${isoWeekKey(anchor).slice(6)} · ${periodSub("week", anchor)}`;
  if (scope === "month") return periodSub("month", anchor);
  return anchor.slice(0, 4);
};

// Step a per-scope anchor day backwards/forwards by one period
export const shiftAnchor = (
  scope: Scope,
  anchorKey: string,
  delta: number
): string => {
  const dt = toDate(anchorKey);
  if (scope === "day") dt.setDate(dt.getDate() + delta);
  else if (scope === "week") dt.setDate(dt.getDate() + 7 * delta);
  else if (scope === "month") {
    dt.setDate(1);
    dt.setMonth(dt.getMonth() + delta);
  } else dt.setFullYear(dt.getFullYear() + delta);
  return dkey(dt);
};

// Monday of an ISO week key like 2026-W29
export const isoWeekToMonday = (wk: string): Date => {
  const year = Number(wk.slice(0, 4));
  const week = Number(wk.slice(6));
  const jan4 = new Date(year, 0, 4);
  const week1Mon = new Date(jan4);
  week1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const mon = new Date(week1Mon);
  mon.setDate(week1Mon.getDate() + (week - 1) * 7);
  return mon;
};

// An anchor day key that lands inside the page a key refers to
export const keyToAnchor = (pk: string): string => {
  const sc = keyScope(pk);
  if (sc === "day") return pk;
  if (sc === "week") return dkey(isoWeekToMonday(pk));
  if (sc === "month") return `${pk}-01`;
  return `${pk}-01-01`;
};

/**
 * Default reminder instant for an entry, derived from the page it lives on.
 * A reminder belongs to the day the entry is written for, not the day you
 * happened to open the sheet — an entry on a future page prefilled "today"
 * fires while the task is still days off, and lands in the Due section early.
 *
 * Page date at 09:00. If that instant has already passed (today's page opened
 * after 09:00, or an older page) there is no sensible past prefill, so fall
 * back to an hour from now — the same behaviour as before for those pages.
 * Week/month/year pages have no single clock time, so they anchor to the first
 * day of the period (keyToAnchor) and take the same 09:00.
 */
export const DEFAULT_REMIND_HOUR = 9;

export const defaultRemindAt = (pageKey: string, now = Date.now()): number => {
  const anchor = keyScope(pageKey) ? keyToAnchor(pageKey) : null;
  if (anchor) {
    const d = toDate(anchor);
    d.setHours(DEFAULT_REMIND_HOUR, 0, 0, 0);
    if (d.getTime() > now) return d.getTime();
  }
  return now + 3600_000;
};

// Human label for a page key (used for past/future references)
export const pageLabel = (pk: string): string => {
  const sc = keyScope(pk);
  if (sc === "day")
    return fmt(toDate(pk), { weekday: "short", day: "numeric", month: "short" });
  if (sc === "week") return `Week ${pk.slice(6)}`;
  // Short month ("Sept 2026") — headers must fit one line on a phone
  if (sc === "month")
    return fmt(toDate(pk + "-01"), { month: "short", year: "numeric" });
  return pk;
};
