// How much of the server-side storage cap this account has used.
//
// public.user_usage is readable by its owner and writable by nobody, which is
// what makes this possible: the running total the quota trigger maintains is the
// same number the Menu shows. Nothing else reads it.

import { supabase } from "./supabaseClient";

export interface ServerUsage {
  readonly bytes: number;
  readonly quota: number;
}

/**
 * The account's server usage, or null.
 *
 * Null covers four cases and they all mean the same thing, which is say nothing:
 * sync is not configured, nobody is signed in, the table does not exist because
 * schema.sql has not been applied to the project yet, or the read failed. A
 * storage readout is the least important thing on the Menu and must never be the
 * reason it fails to render, so every one of those is swallowed on purpose.
 */
export const serverUsage = async (): Promise<ServerUsage | null> => {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("user_usage")
      .select("bytes,quota_bytes")
      .maybeSingle();
    if (error || !data) return null;
    // bigint arrives as a number or a string depending on the driver, and a
    // journal would have to be 9 petabytes for the precision to matter.
    const bytes = Number(data.bytes);
    const quota = Number(data.quota_bytes);
    if (!Number.isFinite(bytes) || !Number.isFinite(quota) || quota <= 0)
      return null;
    return { bytes, quota };
  } catch {
    return null;
  }
};
