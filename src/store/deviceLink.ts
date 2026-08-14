// The journal's per-epoch data keys, wrapped under the keeper key (spec §6.1e).
//
// What is left of a much larger module. Until 14 August 2026 this file also held the
// approval path — per-device ECDH keys, a wrapped data key per device, link requests,
// the standing check, and the rotation that removal used — and §12.1 phase 7 deleted
// all of it once a passkey and the journal key were the only two ways in. Three tables
// went with it: `device_keys`, `device_wrapped_keys` and `device_link_requests`.
//
// These functions survive because they have nothing to do with devices. An epoch's
// data key wrapped under the keeper key is readable by anything holding that key,
// which after phase 7 is every device that can read the journal at all — so the
// distribution problem the rest of this file existed to solve no longer exists.
//
// The Supabase client is passed in rather than imported: store/sync.ts owns it and
// imports this module, so importing it back would make a cycle.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Publish a new epoch's key, wrapped under the keeper key.
 *
 * Written before anything encrypts under the new epoch, so the journal key covers it
 * from the moment it exists. The reverse order would leave a window of content the
 * recovery route could not reach, and that window would become permanent if the
 * writing device were then lost.
 *
 * Only a device holding the keeper key can rotate, which after §12.1 phase 7 is every
 * device that can read the journal. Takes the user id rather than a device binding: the
 * row is per account and per epoch, and the device it came from was never recorded.
 */
export const publishEpochKey = async (
  client: SupabaseClient,
  userId: string,
  epoch: number,
  wrappedKey: unknown
): Promise<void> => {
  const { error } = await client.from("journal_keys").insert({
    user_id: userId,
    epoch,
    wrapped_key: wrappedKey,
  });
  if (error)
    throw new Error(`Could not publish the new journal key: ${error.message}`);
};

/**
 * The epoch the account is currently writing under.
 *
 * Zero when `journal_keys` is empty, which is every account that has never
 * rotated: epoch 0's key lives in `journals.wrapped_key` where it always did, so
 * a fresh account has nothing here at all.
 *
 * Read on every connect rather than cached. A device that believes the epoch is
 * lower than it is would encrypt under a superseded key, and no other device
 * would ever write beside those rows.
 */
export const readCurrentEpoch = async (
  client: SupabaseClient
): Promise<number> => {
  const { data, error } = await client
    .from("journal_keys")
    .select("epoch")
    .order("epoch", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read the key epoch: ${error.message}`);
  const rows = (data ?? []) as { epoch: number }[];
  return rows[0]?.epoch ?? 0;
};

/** Every keeper-wrapped epoch key, for a device that holds the keeper key. */
export const readKeeperWrappedEpochs = async (
  client: SupabaseClient
): Promise<Map<number, unknown>> => {
  const { data, error } = await client
    .from("journal_keys")
    .select("epoch, wrapped_key");
  if (error) throw new Error(`Could not read the journal keys: ${error.message}`);
  return new Map(
    ((data ?? []) as { epoch: number; wrapped_key: unknown }[]).map((r) => [
      r.epoch,
      r.wrapped_key,
    ])
  );
};
