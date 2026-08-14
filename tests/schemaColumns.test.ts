// Every column in the database has to be one of four things, and somebody has to
// say which in a diff.
//
// Spec §6.5, stated by Gary on 11 August 2026 as a hard rule: a column holds
// either ciphertext the server cannot decrypt, or operational metadata the server
// itself needs in order to run. Nothing else. Anything describing the person,
// their devices, their habits or their journal belongs inside the encrypted
// document.
//
// A rule stated in a specification is not enforced by anything, and this project
// has written three of those (see §6.1a for what it costs). What makes this one
// real is that adding a column to schema.sql fails the build until it appears
// below with a class against it. The same shape as cssTokens.test.ts: the
// toolchain cannot otherwise see the mistake, because to TypeScript and to
// Postgres a plaintext label is just a column that works.
//
// The one plaintext string in the schema today, device_link_requests.client,
// arrived with a good reason attached and survived a fortnight of review with that
// reason repeated in three documents. It is quarantined below rather than
// classified, because a rule with an exception list is a rule that grows one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const SCHEMA = join(import.meta.dirname, "..", "supabase", "schema.sql");

/**
 * The four classes of §6.5. Anything that is none of them does not get a column,
 * however convenient and however small.
 *
 * - `A` Ciphertext. Opaque to the server, authenticated against what the client
 *   expects rather than against what arrived with the row (§6.1).
 * - `B` A public key. Public by construction, useless without a private half held
 *   non-extractably on a device.
 * - `C` An opaque identifier. Random or sequential, carrying no meaning of its
 *   own, never derived from anything about the person or the device.
 * - `D` An operational counter or timestamp the server maintains to function.
 */
type ColumnClass = "A" | "B" | "C" | "D";

/**
 * Every column, classified. Keyed `table.column`, and deliberately not grouped by
 * class: reading it table by table is how you check it against the schema.
 *
 * Two entries are worth their comments because they are the ones where class `D`
 * is doing more work than it looks:
 *
 * `journal_updates.created_at` and its siblings are timestamps, and an
 * append-only log of timestamped rows says when somebody journals and roughly how
 * much without a byte being decrypted. §6.4 claims activity times are not held
 * while the log holds them structurally. Classified `D` rather than defended as
 * revealing nothing.
 *
 * `epoch` counts rotations, and rotation happens only when a device is removed,
 * so it says how many times that has happened. Kept because it selects a key and
 * cannot be inferred client-side.
 */
const CLASSES: Record<string, ColumnClass> = {
  // The account id everywhere. Links every row to the email held in auth.users,
  // which is the limit §6.5 names first and cannot remove.
  "journals.user_id": "C",
  "journals.wrapped_key": "A", // data key for epoch 0, under the keeper key
  "journals.created_at": "D",

  "journal_updates.id": "D", // identity column, and the log order
  "journal_updates.user_id": "C",
  // v1, v2, shared. Sequential and opaque; the notebook's human label stays on
  // the device and never reaches the server (volume-schema-design.md).
  "journal_updates.volume": "C",
  "journal_updates.payload": "A", // encrypted CRDT update, base64
  "journal_updates.created_at": "D",

  "user_usage.user_id": "C",
  // The quota trigger cannot work without these two, and they are the metadata
  // the rule was stated to permit.
  "user_usage.bytes": "D",
  "user_usage.quota_bytes": "D",
  "user_usage.updated_at": "D",

  // Random id generated on the device and kept in localStorage, not derived from
  // anything about it (store/devices.ts, thisDeviceId).


  "journal_keys.user_id": "C",
  "journal_keys.epoch": "D",
  "journal_keys.wrapped_key": "A",
  "journal_keys.created_at": "D",

  // §6.1e. wrap_id is client-generated because it is inside the AAD; see the
  // comment on the table. The row holds nothing else, which is why unlocking
  // tries every row rather than looking one up.
  "keeper_wraps.user_id": "C",
  "keeper_wraps.wrap_id": "C",
  "keeper_wraps.wrapped": "A",
  "keeper_wraps.created_at": "D",

};

/**
 * Columns that exist and are breaches, with the phase that removes them.
 *
 * Empty as of 14 August 2026, and kept rather than deleted: it is the mechanism that
 * made the one breach visible in the code rather than only in the specification, and
 * the next one wants somewhere to go that is not a quiet exception.
 *
 * What was here: `device_link_requests.client`, a plaintext label like "Safari (iOS)"
 * published over realtime, which §6.5 classifies as none of its four kinds. §12.1
 * phase 1 stopped the client writing it; phase 1b dropped the column once every
 * device had been quit and reopened on a build that no longer sends it, since an old
 * build inserting into a column that has gone presents as linking being broken on
 * that device with no visible cause.
 */
const PENDING_REMOVAL: Record<string, string> = {};

/**
 * Every column the schema actually creates, as `table.column`.
 *
 * Three things make this more than one regex. Dollar-quoted blocks hold a trigger
 * function and a `do` block that both mention columns and create none, so they go
 * first. Columns arrive by `alter table ... add column` as well as in the create:
 * `volume` and `epoch` both do, so a parser reading only create statements would
 * pass while missing two. And `delete_code` is dropped further down the same file,
 * so drop statements have to be applied in order rather than ignored.
 */
export const schemaColumns = (sql: string): string[] => {
  const clean = sql
    .replace(/\$\$[\s\S]*?\$\$/g, "") // function bodies and do blocks
    .replace(/--[^\n]*/g, ""); // line comments, which discuss columns freely

  const found: string[] = [];
  const add = (key: string) => {
    if (!found.includes(key)) found.push(key);
  };

  const CONSTRAINT = /^(primary|unique|foreign|constraint|check|exclude)\b/i;
  const creates = clean.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(([\s\S]*?)\n\s*\);/gi
  );
  for (const [, table, body] of creates) {
    for (const line of body.split("\n")) {
      const text = line.trim();
      if (!text || CONSTRAINT.test(text)) continue;
      const name = /^(\w+)\s/.exec(text);
      if (name) add(`${table}.${name[1]}`);
    }
  }

  // Applied in file order against the set above, so a column that is added and
  // later dropped does not have to be classified.
  const alters = clean.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+(add|drop)\s+column\s+(?:if\s+(?:not\s+)?exists\s+)?(\w+)/gi
  );
  for (const [, table, verb, column] of alters) {
    const key = `${table}.${column}`;
    if (verb.toLowerCase() === "add") add(key);
    else {
      const at = found.indexOf(key);
      if (at >= 0) found.splice(at, 1);
    }
  }

  return found;
};

const sql = readFileSync(SCHEMA, "utf8");
const columns = schemaColumns(sql);
const declared = { ...CLASSES, ...PENDING_REMOVAL };

describe("every column is classified (spec §6.5)", () => {
  test("the schema is read at all", () => {
    // A parser that silently matches nothing would make every test below pass.
    expect(columns.length).toBeGreaterThan(12);
    expect(columns).toContain("journals.wrapped_key");
  });

  test("no column is unclassified", () => {
    const missing = columns.filter((c) => !(c in declared));
    expect(missing).toEqual([]);
  });

  test("no classification is stale", () => {
    const gone = Object.keys(declared).filter((c) => !columns.includes(c));
    expect(gone).toEqual([]);
  });

  test("every class is one of the four", () => {
    const wrong = Object.entries(CLASSES).filter(
      ([, k]) => !["A", "B", "C", "D"].includes(k)
    );
    expect(wrong).toEqual([]);
  });

  test("a quarantined column is never also classified", () => {
    const both = Object.keys(PENDING_REMOVAL).filter((c) => c in CLASSES);
    expect(both).toEqual([]);
  });

  test("the tables §12.1 phase 7 dropped are not classified either", () => {
    // Deleted 14 August 2026 with approval: device_keys, device_wrapped_keys and
    // device_link_requests were §6.1d's grants. The register has to lose them at the
    // same time, and the stale-classification test above is what enforces it — this
    // one states the intent so a reader knows the absence is deliberate.
    for (const t of ["device_keys", "device_wrapped_keys", "device_link_requests"])
      expect(columns.filter((c) => c.startsWith(`${t}.`))).toEqual([]);
  });

  test("the quarantine is empty, and the last breach really is gone", () => {
    // Both halves. The register being empty is only meaningful if the column it used
    // to hold has actually left the schema, and the parser applies drop statements in
    // order, so this reads the file rather than the intention.
    //
    // The limit, since this test could be read as proving more than it does: it proves
    // the schema no longer declares the column. Whether the live project has dropped
    // it depends on somebody applying the file, which is manual and unverifiable from
    // here. Reintroducing the column in the create *and* deleting the drop fails this;
    // doing either alone does not, because either alone still leaves it gone.
    expect(Object.keys(PENDING_REMOVAL)).toEqual([]);
    expect(columns).not.toContain("device_link_requests.client");
  });

  test("and anything quarantined in future has to name the phase that removes it", () => {
    // The rule the register exists for, kept alive while it is empty: a breach may be
    // recorded here rather than classified, and only with the phase that ends it.
    for (const reason of Object.values(PENDING_REMOVAL)) {
      expect(reason).toMatch(/phase/i);
    }
  });

  test("dropped columns are not required to be classified", () => {
    // delete_code was created before 4 August and is dropped in this same file.
    expect(columns).not.toContain("journals.delete_code");
  });
});

// The parser is the part that can fail silently, so it is tested against SQL
// written to defeat it rather than only against the file it is pointed at.
describe("the parser", () => {
  test("finds a column added by alter table", () => {
    const out = schemaColumns(`
create table if not exists public.t (
  id bigint generated always as identity primary key,
  primary key (id)
);
alter table public.t
  add column if not exists volume text not null default 'v1';
`);
    expect(out).toEqual(["t.id", "t.volume"]);
  });

  test("forgets a column dropped later in the file", () => {
    const out = schemaColumns(`
create table if not exists public.t (
  keep text not null,
  gone text
);
alter table public.t
  drop column if exists gone;
`);
    expect(out).toEqual(["t.keep"]);
  });

  test("ignores columns named inside a function body or a do block", () => {
    const out = schemaColumns(`
create table if not exists public.t (
  real_one text not null
);
create or replace function public.f() returns trigger language plpgsql as $$
begin
  insert into public.t (imaginary_one text) values (1);
  create table public.not_a_table (
    also_imaginary text
  );
end;
$$;
do $$
begin
  alter table public.t add column if not exists smuggled text;
end $$;
`);
    expect(out).toEqual(["t.real_one"]);
  });

  test("ignores a column named only in a comment", () => {
    const out = schemaColumns(`
create table if not exists public.t (
  real_one text not null
  -- discussed_only text, and why it was rejected
);
`);
    expect(out).toEqual(["t.real_one"]);
  });

  test("reports an unclassified column, which is the whole point", () => {
    // The mutation this file exists to catch, kept as a test rather than as an
    // instruction to try it by hand once.
    const out = schemaColumns(`
create table if not exists public.journals (
  user_id uuid primary key,
  notes text
);
`);
    expect(out.filter((c) => !(c in declared))).toEqual(["journals.notes"]);
  });
});
