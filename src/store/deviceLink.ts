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
  unwrapDataKeyForDevice,
  verificationCode,
  wrapDataKeyForDevice,
} from "../lib/deviceKeys";
import type { DeviceBinding, DeviceWrappedKeyJson } from "../lib/deviceKeys";

/**
 * How long a pending request stays valid.
 *
 * Enforced by the client rather than the database: nothing here runs on a
 * schedule (no pg_cron), so a request expires by being ignored and deleted by
 * whichever device next looks at it. Thirty minutes is long enough to walk to
 * another room and short enough that the plaintext client string is not sitting
 * on the server for any length of time.
 */
export const LINK_REQUEST_TTL_MS = 30 * 60 * 1000;

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

// ---------- step 3: asking, and being asked ----------

/** A device waiting to be let in, as the approving device sees it. */
export interface LinkRequest {
  deviceId: string;
  publicKey: string;
  /** What it calls itself. Plaintext, and null if it declined to say. */
  client: string | null;
  requestedAt: number;
  /** Computed here from the public key that actually arrived. */
  code: string;
}

/**
 * Ask to be let in, and return the code to display.
 *
 * The code is derived from this device's own public key, and the approving
 * device derives its copy from the key it received. Comparing the two screens is
 * therefore comparing what was sent against what arrived, which is the whole
 * mechanism: a server that substituted a key of its own would have to show a
 * matching code, and it cannot.
 */
export const publishLinkRequest = async (
  client: SupabaseClient,
  binding: DeviceBinding,
  clientLabel: string
): Promise<string> => {
  const pair = await ensureDeviceKeyPair();
  const publicKey = await exportDevicePublicKey(pair.publicKey);
  const { error } = await client.from("device_link_requests").upsert(
    {
      user_id: binding.userId,
      device_id: binding.deviceId,
      public_key: publicKey,
      client: clientLabel,
      // Reset on every ask, so a device that has been sitting on a stale request
      // gets a fresh half hour rather than expiring mid-approval.
      requested_at: new Date().toISOString(),
    },
    { onConflict: "user_id,device_id" }
  );
  if (error) throw new Error(`Could not ask to be added: ${error.message}`);
  return verificationCode(publicKey);
};

/**
 * Requests worth showing someone, newest first.
 *
 * Expired rows are deleted rather than merely filtered. Nothing in this app runs
 * on a timer server-side, so if the device that notices a stale request does not
 * clear it, the plaintext client string stays on the server indefinitely — which
 * is precisely the thing the thirty-minute window is supposed to bound.
 *
 * This device's own request is excluded. A device cannot vouch for itself, and
 * showing it its own prompt would be an invitation to approve it.
 */
export const listLinkRequests = async (
  client: SupabaseClient,
  binding: DeviceBinding
): Promise<LinkRequest[]> => {
  const { data, error } = await client
    .from("device_link_requests")
    .select("device_id, public_key, client, requested_at");
  if (error) throw new Error(`Could not read link requests: ${error.message}`);

  const rows = (data ?? []) as {
    device_id: string;
    public_key: string;
    client: string | null;
    requested_at: string;
  }[];

  const fresh: LinkRequest[] = [];
  const stale: string[] = [];
  for (const row of rows) {
    if (row.device_id === binding.deviceId) continue;
    const requestedAt = Date.parse(row.requested_at);
    // An unparseable timestamp counts as expired. Treating it as fresh would
    // mean a malformed row could be shown for approval forever.
    if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > LINK_REQUEST_TTL_MS) {
      stale.push(row.device_id);
      continue;
    }
    fresh.push({
      deviceId: row.device_id,
      publicKey: row.public_key,
      client: row.client,
      requestedAt,
      code: await verificationCode(row.public_key),
    });
  }

  for (const deviceId of stale) {
    // Failure here is not worth reporting: the request is expired either way and
    // will be retried by whoever looks next.
    await client
      .from("device_link_requests")
      .delete()
      .eq("device_id", deviceId)
      .then(() => undefined, () => undefined);
  }

  return fresh.sort((a, b) => b.requestedAt - a.requestedAt);
};

/**
 * Grant a request: wrap the data key for it, publish, then withdraw the request.
 *
 * The order is load-bearing. Publishing before deleting means a failure between
 * the two leaves a linked device with a lingering request, which is untidy and
 * self-corrects when the new device claims its key. The reverse order would
 * leave a device that has been told nothing and has nothing to wait for.
 *
 * `request.publicKey` is used rather than a fresh read of the row. The user
 * approved a specific code, and that code was computed from this exact key; going
 * back to the server would create a window in which the row could change between
 * the comparison and the grant.
 */
export const approveLinkRequest = async (
  client: SupabaseClient,
  dataKey: CryptoKey,
  request: LinkRequest,
  binding: DeviceBinding
): Promise<void> => {
  const wrapped = await wrapDataKeyForDevice(dataKey, request.publicKey, {
    userId: binding.userId,
    deviceId: request.deviceId,
  });
  const { error } = await client.from("device_wrapped_keys").upsert(
    {
      user_id: binding.userId,
      device_id: request.deviceId,
      wrapped: wrapped satisfies DeviceWrappedKeyJson,
    },
    { onConflict: "user_id,device_id" }
  );
  if (error) throw new Error(`Could not add the device: ${error.message}`);

  // Also publish its public key, so the device appears in the ordinary key
  // table and future data-key changes reach it without another approval.
  const { error: keyError } = await client.from("device_keys").upsert(
    {
      user_id: binding.userId,
      device_id: request.deviceId,
      public_key: request.publicKey,
    },
    { onConflict: "user_id,device_id" }
  );
  if (keyError)
    throw new Error(`Could not record the device's key: ${keyError.message}`);

  await rejectLinkRequest(client, request.deviceId);
};

/**
 * Withdraw a request without granting it.
 *
 * Used both for "codes are different" and as the last step of an approval. A
 * rejection deletes rather than marking, because the asking device is watching
 * for its own request to disappear and a tombstone would need a meaning of its
 * own; the device can simply ask again.
 */
export const rejectLinkRequest = async (
  client: SupabaseClient,
  deviceId: string
): Promise<void> => {
  const { error } = await client
    .from("device_link_requests")
    .delete()
    .eq("device_id", deviceId);
  if (error)
    throw new Error(`Could not clear the request: ${error.message}`);
};

/**
 * Take the data key if one has been left for this device.
 *
 * Null means "not yet", which is the ordinary state of a device that is waiting,
 * and is deliberately not an error.
 *
 * A row that will not open is deleted. Only this device could ever unwrap it, so
 * a row that fails is unusable by definition — the realistic cause is a row
 * sealed to a keypair this device lost in a wipe. Leaving it would mean every
 * later check finds the same broken row and reports the same failure.
 */
export const claimWrappedDataKey = async (
  client: SupabaseClient,
  binding: DeviceBinding
): Promise<CryptoKey | null> => {
  const { data, error } = await client
    .from("device_wrapped_keys")
    .select("wrapped")
    .eq("device_id", binding.deviceId)
    .maybeSingle();
  if (error) throw new Error(`Could not check for a key: ${error.message}`);
  if (!data) return null;

  const pair = await ensureDeviceKeyPair();
  try {
    return await unwrapDataKeyForDevice(
      data.wrapped as DeviceWrappedKeyJson,
      pair.privateKey,
      binding
    );
  } catch {
    await client
      .from("device_wrapped_keys")
      .delete()
      .eq("device_id", binding.deviceId)
      .then(() => undefined, () => undefined);
    return null;
  }
};
