// The three per-device key tables on the server, and the two things step 2 does
// with them: publish who this device is, and hand the data key to any device
// that has published a key but has not been given one.
//
// The Supabase client is passed in rather than imported. store/sync.ts owns the
// client and will import this module, so importing it back would make a cycle,
// and a cycle here would be resolved differently under Vite and under Vitest.
// Passing it also means every function below is testable with a stub and no
// module mocking.
//
// Nothing in here is allowed to stop sync. A device whose key-sharing fails is a
// device that syncs normally and shares next launch; callers catch and carry on.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureDeviceKeyPair } from "../lib/keystore";
import {
  exportDevicePublicKey,
  wrapDataKeyForDevice,
} from "../lib/deviceKeys";
import type { DeviceBinding, DeviceWrappedKeyJson } from "../lib/deviceKeys";

/**
 * Make sure the server knows this device's public key, and return it.
 *
 * Idempotent by comparison rather than by blind upsert, so the ordinary launch
 * writes nothing at all.
 *
 * The one case that does write is a device coming back after a sign-out: the
 * keypair went with the wiped keystore, so the key on the server belongs to an
 * identity this device can no longer prove. Publishing the new one has to be
 * paired with deleting this device's wrapped row, because that row is sealed to
 * the superseded key and can never be opened again. Leaving it would be worse
 * than useless: step 3 watches for a wrapped row appearing as the signal that
 * approval happened, and a stale row would fire that signal immediately and then
 * fail to unwrap.
 */
export const publishDeviceKey = async (
  client: SupabaseClient,
  binding: DeviceBinding
): Promise<string> => {
  const pair = await ensureDeviceKeyPair();
  const publicKey = await exportDevicePublicKey(pair.publicKey);

  const { data, error } = await client
    .from("device_keys")
    .select("public_key")
    .eq("device_id", binding.deviceId)
    .maybeSingle();
  if (error) throw new Error(`Could not read device keys: ${error.message}`);
  if (data?.public_key === publicKey) return publicKey;

  const { error: upsertError } = await client
    .from("device_keys")
    .upsert(
      {
        user_id: binding.userId,
        device_id: binding.deviceId,
        public_key: publicKey,
      },
      { onConflict: "user_id,device_id" }
    );
  if (upsertError)
    throw new Error(`Could not publish this device's key: ${upsertError.message}`);

  if (data) {
    // Only when a *different* key was already published. On a first publish
    // there is nothing stale to clear, and issuing the delete anyway would race
    // a wrapped row that another device may have just written for this one.
    const { error: deleteError } = await client
      .from("device_wrapped_keys")
      .delete()
      .eq("device_id", binding.deviceId);
    if (deleteError)
      throw new Error(
        `Could not clear this device's old key: ${deleteError.message}`
      );
  }

  return publicKey;
};

/**
 * Wrap the data key for every published device that has not been given one.
 *
 * This is the migration in step 2, and it is deliberately invisible. Every
 * device it reaches already holds the keeper key, so no new trust is being
 * granted and there is nobody new to authenticate — which is why no verification
 * code is compared here. It runs on whichever device happens to launch first
 * after the update, and is a no-op on every launch after that.
 *
 * Its own device is skipped. This device already has the data key, and after a
 * sign-out its keypair is gone, so a row wrapped to itself could never be opened
 * by anything. A row that nothing can use is a row that will eventually mislead
 * someone reading the table.
 *
 * Returns how many rows it wrote, which is what the tests assert on: "no
 * mistakes" and "did nothing" are not the same outcome and must not look alike.
 */
export const shareDataKeyWithDevices = async (
  client: SupabaseClient,
  dataKey: CryptoKey,
  binding: DeviceBinding
): Promise<number> => {
  const { data: keys, error: keysError } = await client
    .from("device_keys")
    .select("device_id, public_key");
  if (keysError)
    throw new Error(`Could not list device keys: ${keysError.message}`);
  if (!keys?.length) return 0;

  const { data: held, error: heldError } = await client
    .from("device_wrapped_keys")
    .select("device_id");
  if (heldError)
    throw new Error(`Could not list shared keys: ${heldError.message}`);

  const alreadyHeld = new Set(
    (held ?? []).map((row: { device_id: string }) => row.device_id)
  );

  let written = 0;
  for (const row of keys as { device_id: string; public_key: string }[]) {
    if (row.device_id === binding.deviceId) continue;
    if (alreadyHeld.has(row.device_id)) continue;
    // Bound to the recipient, not to us. The recipient rebuilds this binding
    // from its own ids and will refuse anything addressed elsewhere.
    const wrapped = await wrapDataKeyForDevice(dataKey, row.public_key, {
      userId: binding.userId,
      deviceId: row.device_id,
    });
    const { error } = await client.from("device_wrapped_keys").upsert(
      {
        user_id: binding.userId,
        device_id: row.device_id,
        wrapped: wrapped satisfies DeviceWrappedKeyJson,
      },
      { onConflict: "user_id,device_id" }
    );
    if (error)
      throw new Error(
        `Could not share the journal with ${row.device_id}: ${error.message}`
      );
    written += 1;
  }
  return written;
};
