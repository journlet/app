// The keeper_wraps table: the routes into this account that are not the journal
// key code (spec §6.1e).
//
// The Supabase client is passed in rather than imported, for the same reason as
// store/deviceLink.ts: store/sync.ts owns the client and will import this, so
// importing it back would make a cycle that Vite and Vitest resolve differently.
//
// There is nothing clever here, and that is the point. §6.5 leaves the row as an
// opaque id and ciphertext, so this file cannot filter, cannot look a credential
// up, and cannot report how many credentials a person has beyond counting rows.
// The trying-each-in-turn that follows from that lives in lib/keeperWrap.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeeperWrapJson, KeeperWrapRow } from "../lib/keeperWrap";

/**
 * Add a route in.
 *
 * Insert rather than upsert: a wrap is write-once, the table has no update policy,
 * and a colliding wrap id would mean a repeated uuid rather than something worth
 * merging. Two wraps of the same keeper key are two routes, which is exactly what
 * the design wants, so nothing here tries to deduplicate them.
 */
export const publishKeeperWrap = async (
  client: SupabaseClient,
  userId: string,
  wrapId: string,
  wrapped: KeeperWrapJson
): Promise<void> => {
  const { error } = await client
    .from("keeper_wraps")
    .insert({ user_id: userId, wrap_id: wrapId, wrapped });
  if (error)
    throw new Error(`Could not save the passkey route: ${error.message}`);
};

/**
 * Every route in, oldest first.
 *
 * Oldest first so trying them in order tends to hit the credential a person has
 * had longest, which is the one most likely to be in front of them. It is a guess
 * and it costs nothing when wrong: the rows are tried until one opens.
 *
 * Rows whose shape is wrong are dropped here rather than at the point of
 * decryption. A malformed row is not a credential that failed to match, and
 * leaving it in the list would report a tampered table as an unrecognised passkey.
 */
export const listKeeperWraps = async (
  client: SupabaseClient
): Promise<KeeperWrapRow[]> => {
  const { data, error } = await client
    .from("keeper_wraps")
    .select("wrap_id, wrapped")
    .order("created_at", { ascending: true });
  if (error)
    throw new Error(`Could not read the passkey routes: ${error.message}`);

  const rows = (data ?? []) as { wrap_id: string; wrapped: unknown }[];
  return rows.flatMap((row) => {
    const w = row.wrapped as Partial<KeeperWrapJson> | null;
    if (
      !w ||
      typeof w.v !== "number" ||
      typeof w.salt !== "string" ||
      typeof w.iv !== "string" ||
      typeof w.blob !== "string"
    )
      return [];
    return [{ wrapId: row.wrap_id, wrapped: w as KeeperWrapJson }];
  });
};

/**
 * How many routes exist, without opening any of them.
 *
 * A count is all the server can answer and all any screen needs: whether to offer
 * the biometric route at all, and whether this account has one credential or
 * several. Which row belongs to which device is recorded in the encrypted device
 * register, never here.
 */
export const countKeeperWraps = async (
  client: SupabaseClient
): Promise<number> => {
  const { count, error } = await client
    .from("keeper_wraps")
    .select("wrap_id", { count: "exact", head: true });
  if (error)
    throw new Error(`Could not count the passkey routes: ${error.message}`);
  return count ?? 0;
};
