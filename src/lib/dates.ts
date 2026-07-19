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

export const fmt = (dt: Date, opts: Intl.DateTimeFormatOptions): string =>
  dt.toLocaleDateString("en-GB", opts);

export const scopeSub = (scope: Scope): string => {
  const now = new Date();
  if (scope === "day")
    return fmt(now, { weekday: "long", day: "numeric", month: "long" });
  if (scope === "week") {
    const mon = mondayOf(todayKey());
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return `${fmt(mon, { day: "numeric", month: "short" })} – ${fmt(sun, {
      day: "numeric",
      month: "short",
    })}`;
  }
  if (scope === "month") return fmt(now, { month: "long", year: "numeric" });
  return String(now.getFullYear());
};

// Human label for a page key (used for past/future references)
export const pageLabel = (pk: string): string => {
  const sc = keyScope(pk);
  if (sc === "day")
    return fmt(toDate(pk), { weekday: "short", day: "numeric", month: "short" });
  if (sc === "week") return `Week ${pk.slice(6)}`;
  if (sc === "month")
    return fmt(toDate(pk + "-01"), { month: "long", year: "numeric" });
  return pk;
};
